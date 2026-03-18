// GUID: SCRIPT_INGEST_REPLAY-000-v01
// [Intent] One-time ingest script: downloads Chinese GP 2026 GPS location data
//          from OpenF1, downsamples to 500ms per driver, builds HistoricalReplayData
//          JSON, uploads to Firebase Storage (public), and writes metadata to
//          Firestore replay_sessions collection.
// [Run] node scripts/ingest-chinese-gp-replay.js [--force]
// [Downstream Impact] Creates /replay-data/11245.json in Firebase Storage (public).
//                     Creates/overwrites Firestore doc replay_sessions/11245.

'use strict';

const admin = require('firebase-admin');
const https  = require('https');
const zlib   = require('zlib');
const path   = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SESSION_KEY       = 11245;
const CIRCUIT_KEY       = 17;          // Shanghai
const DATE_START_UTC    = '2026-03-15T07:00:00';
const DATE_END_UTC      = '2026-03-15T09:01:00'; // slight overrun to capture straggler data
const CHUNK_MINUTES     = 10;          // fetch in 10-minute windows
const DOWNSAMPLE_MS     = 500;         // keep 1 record per 500ms per driver (2Hz)
const FRAME_GROUPING_MS = 250;         // group positions within 250ms into one frame
const STORAGE_BUCKET    = 'studio-6033436327-281b1.firebasestorage.app';
const STORAGE_PATH      = `replay-data/${SESSION_KEY}.json`;
const FIRESTORE_COLL    = 'replay_sessions';

const SA_PATH = path.resolve(__dirname, '../service-account.json');

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert(require(SA_PATH)),
  storageBucket: STORAGE_BUCKET,
});

const db      = admin.firestore();
const bucket  = admin.storage().bucket();
const FORCE   = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function fetchJson(url, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message} — body: ${text.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

// ---------------------------------------------------------------------------
// OpenF1 helpers
// ---------------------------------------------------------------------------
const OPENF1 = 'https://api.openf1.org/v1';

async function fetchLocationChunk(from, to, attempt = 1) {
  const f = encodeURIComponent(from);
  const t = encodeURIComponent(to);
  const url = `${OPENF1}/location?session_key=${SESSION_KEY}&date%3E=${f}&date%3C=${t}`;
  console.log(`  Fetching chunk ${from} → ${to} … (attempt ${attempt})`);
  const data = await fetchJson(url, 90_000);
  // OpenF1 returns {"detail":"No results found."} when there's no data in this window
  if (!Array.isArray(data)) {
    if (data && data.detail && data.detail.includes('No results')) return [];
    // Rate limit — retry with exponential backoff
    if (data && data.error && data.error.includes('Too Many Requests') && attempt <= 5) {
      const waitMs = attempt * 3000;
      console.log(`  ⚠ Rate limited — waiting ${waitMs/1000}s before retry …`);
      await new Promise(r => setTimeout(r, waitMs));
      return fetchLocationChunk(from, to, attempt + 1);
    }
    throw new Error(`Expected array from /location, got: ${JSON.stringify(data).slice(0, 100)}`);
  }
  return data;
}

async function fetchAllLocation() {
  const start = new Date(DATE_START_UTC + 'Z');
  const end   = new Date(DATE_END_UTC   + 'Z');
  const all   = [];

  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + CHUNK_MINUTES * 60_000);
    const from = cursor.toISOString().replace('.000Z', '').replace('Z', '');
    const to   = next.toISOString().replace('.000Z', '').replace('Z', '');
    const chunk = await fetchLocationChunk(from, to);
    all.push(...chunk);
    console.log(`    → ${chunk.length} records (total so far: ${all.length})`);
    cursor = next;
    // Polite delay between chunks — stay under OpenF1's 3 req/sec limit
    await new Promise(r => setTimeout(r, 2000));
  }

  return all;
}

async function fetchRaceOrder() {
  console.log('Fetching race order (/position) …');
  const url  = `${OPENF1}/position?session_key=${SESSION_KEY}`;
  const data = await fetchJson(url, 60_000);
  if (!Array.isArray(data)) throw new Error(`Expected array from /position`);
  console.log(`  → ${data.length} race order records`);
  return data;
}

async function fetchDrivers() {
  console.log('Fetching driver metadata …');
  const url  = `${OPENF1}/drivers?session_key=${SESSION_KEY}`;
  const data = await fetchJson(url, 30_000);
  if (!Array.isArray(data)) throw new Error(`Expected array from /drivers`);
  console.log(`  → ${data.length} drivers`);
  return data;
}

async function fetchSession() {
  console.log('Fetching session metadata …');
  const url  = `${OPENF1}/sessions?session_key=${SESSION_KEY}`;
  const data = await fetchJson(url, 30_000);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`No session metadata found`);
  return data[0];
}

// ---------------------------------------------------------------------------
// Build race order lookup: driverNumber → nearest race position at each time
// ---------------------------------------------------------------------------
function buildRaceOrderLookup(raceOrderRaw) {
  // Returns a function: getPositionAt(driverNumber, dateMs) → race position integer
  // Strategy: per driver, sort by date, binary search for the floor entry.
  const byDriver = new Map();
  for (const r of raceOrderRaw) {
    if (r.position == null) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push({ ts: new Date(r.date).getTime(), pos: r.position });
    byDriver.set(r.driver_number, list);
  }
  // Sort each driver's list ascending
  for (const [, list] of byDriver) {
    list.sort((a, b) => a.ts - b.ts);
  }

  return function getPositionAt(driverNumber, dateMs) {
    const list = byDriver.get(driverNumber);
    if (!list || list.length === 0) return 99;
    // Binary search for floor
    let lo = 0, hi = list.length - 1, result = list[0].pos;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= dateMs) { result = list[mid].pos; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  };
}

// ---------------------------------------------------------------------------
// Downsample: keep 1 record per DOWNSAMPLE_MS per driver
// ---------------------------------------------------------------------------
function downsampleLocations(locationRaw, getPositionAt) {
  // Group by driver
  const byDriver = new Map();
  for (const r of locationRaw) {
    if (r.x == null || r.y == null) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push(r);
    byDriver.set(r.driver_number, list);
  }

  const result = [];

  for (const [driverNum, records] of byDriver) {
    records.sort((a, b) => a.date.localeCompare(b.date));
    let windowStart = -Infinity;
    for (const rec of records) {
      const ts = new Date(rec.date).getTime();
      if (ts - windowStart >= DOWNSAMPLE_MS) {
        result.push({
          driver_number: driverNum,
          date: rec.date,
          x: rec.x,
          y: rec.y,
          z: rec.z ?? 0,
          position: getPositionAt(driverNum, ts),
        });
        windowStart = ts;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Build ReplayFrame[] (same format as HistoricalReplayData.frames)
// ---------------------------------------------------------------------------
function buildReplayFrames(downsampled, sessionStartMs) {
  if (downsampled.length === 0) return [];

  const sorted = [...downsampled].sort((a, b) => a.date.localeCompare(b.date));
  const frames = [];
  let i = 0;

  while (i < sorted.length) {
    const anchor    = sorted[i];
    const anchorMs  = new Date(anchor.date).getTime();

    const frame = {
      virtualTimeMs: anchorMs - sessionStartMs,
      wallTimeMs:    anchorMs,
      positions:     [],
    };

    while (i < sorted.length) {
      const posMs = new Date(sorted[i].date).getTime();
      if (posMs - anchorMs > FRAME_GROUPING_MS) break;
      frame.positions.push({
        driverNumber: sorted[i].driver_number,
        x:            sorted[i].x,
        y:            sorted[i].y,
        position:     sorted[i].position,
      });
      i++;
    }

    if (frame.positions.length > 0) frames.push(frame);
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== Prix Six — GPS Replay Ingest ===`);
  console.log(`Session: ${SESSION_KEY} | ${DATE_START_UTC} → ${DATE_END_UTC}`);
  console.log(`Downsample: ${DOWNSAMPLE_MS}ms | Force: ${FORCE}\n`);

  // Check if already ingested
  if (!FORCE) {
    const existing = await db.collection(FIRESTORE_COLL).doc(String(SESSION_KEY)).get();
    if (existing.exists) {
      console.log('✓ Already ingested. Use --force to re-ingest.');
      process.exit(0);
    }
  }

  // Fetch all data
  const sessionMeta    = await fetchSession();
  const rawDrivers     = await fetchDrivers();
  const rawRaceOrder   = await fetchRaceOrder();
  console.log('\nFetching GPS location data in 10-minute chunks …');
  const rawLocation    = await fetchAllLocation();

  console.log(`\nTotal GPS records: ${rawLocation.length}`);

  const sessionStartMs = new Date(sessionMeta.date_start).getTime();
  const sessionEndMs   = new Date(sessionMeta.date_end).getTime();
  const durationMs     = sessionEndMs - sessionStartMs;

  // Build race order lookup
  const getPositionAt = buildRaceOrderLookup(rawRaceOrder);

  // Downsample GPS data
  console.log(`\nDownsampling to ${DOWNSAMPLE_MS}ms intervals …`);
  const downsampled = downsampleLocations(rawLocation, getPositionAt);
  console.log(`  → ${downsampled.length} downsampled records`);

  // Build replay frames
  console.log('Building replay frames …');
  const frames = buildReplayFrames(downsampled, sessionStartMs);
  console.log(`  → ${frames.length} frames`);

  // Build driver list
  const drivers = rawDrivers.map(d => ({
    driverNumber: d.driver_number,
    driverCode:   d.name_acronym ?? `D${d.driver_number}`,
    fullName:     d.full_name ?? `Driver ${d.driver_number}`,
    teamName:     d.team_name ?? '',
    teamColour:   d.team_colour ? `#${d.team_colour}` : '#888888',
  }));

  // Build HistoricalReplayData-compatible payload
  const replayData = {
    sessionKey:   SESSION_KEY,
    sessionName:  sessionMeta.session_name ?? 'Race',
    meetingName:  sessionMeta.meeting_name ?? 'Chinese Grand Prix',
    drivers,
    frames,
    durationMs:   frames.length > 0 ? frames[frames.length - 1].virtualTimeMs : durationMs,
    totalLaps:    sessionMeta.total_laps ?? null,
  };

  // Compress and upload to Firebase Storage
  const jsonStr  = JSON.stringify(replayData);
  const jsonBuf  = Buffer.from(jsonStr, 'utf8');
  const gzipBuf  = await new Promise((resolve, reject) =>
    zlib.gzip(jsonBuf, { level: 9 }, (err, buf) => err ? reject(err) : resolve(buf))
  );

  console.log(`\nJSON size:   ${(jsonBuf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Gzipped:     ${(gzipBuf.length / 1024 / 1024).toFixed(2)} MB`);

  console.log(`\nUploading to Firebase Storage: ${STORAGE_PATH} …`);
  const file = bucket.file(STORAGE_PATH);
  await file.save(gzipBuf, {
    metadata: {
      contentType:     'application/json',
      contentEncoding: 'gzip',
      cacheControl:    'public, max-age=86400',
      metadata: {
        sessionKey:  String(SESSION_KEY),
        meetingName: replayData.meetingName,
        frames:      String(frames.length),
        durationMs:  String(replayData.durationMs),
      },
    },
  });
  await file.makePublic();

  // Firebase Storage public URL for firebasestorage.app buckets
  const publicUrl = `https://storage.googleapis.com/${STORAGE_BUCKET}/${STORAGE_PATH}`;
  console.log(`  → Public URL: ${publicUrl}`);

  // Write Firestore metadata
  console.log('\nWriting Firestore metadata …');
  const firestoreDoc = {
    sessionKey:          SESSION_KEY,
    sessionName:         replayData.sessionName,
    meetingName:         replayData.meetingName,
    circuitKey:          CIRCUIT_KEY,
    year:                2026,
    dateStart:           sessionMeta.date_start,
    dateEnd:             sessionMeta.date_end,
    durationMs:          replayData.durationMs,
    totalDrivers:        drivers.length,
    totalFrames:         frames.length,
    storagePath:         STORAGE_PATH,
    downloadUrl:         publicUrl,
    fileSizeBytesGzip:   gzipBuf.length,
    fileSizeBytesRaw:    jsonBuf.length,
    samplingIntervalMs:  DOWNSAMPLE_MS,
    ingestedAt:          admin.firestore.FieldValue.serverTimestamp(),
    ingestedBy:          'ingest-chinese-gp-replay.js',
    status:              'available',
  };

  await db.collection(FIRESTORE_COLL).doc(String(SESSION_KEY)).set(firestoreDoc);
  console.log(`  → Firestore doc: ${FIRESTORE_COLL}/${SESSION_KEY}`);

  console.log('\n✓ Ingest complete!\n');
  console.log(`  Frames:    ${frames.length}`);
  console.log(`  Duration:  ${Math.round(replayData.durationMs / 60000)} min`);
  console.log(`  Drivers:   ${drivers.length}`);
  console.log(`  Raw JSON:  ${(jsonBuf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Gzipped:   ${(gzipBuf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  URL:       ${publicUrl}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ Ingest failed:', err.message);
  process.exit(1);
});
