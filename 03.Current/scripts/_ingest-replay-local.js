// Local replay ingest — bypasses server timeout limits.
// Usage: node scripts/_ingest-replay-local.js 11245
const admin = require('firebase-admin');
const path = require('path');
const sa = path.resolve(__dirname, '../service-account.json');
admin.initializeApp({ credential: admin.credential.cert(require(sa)) });

// We can't import TS directly, so replicate the essential ingest logic
const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');

const OPENF1_BASE = 'https://api.openf1.org/v1';
const CHUNK_MINUTES = 10;
const FRAMES_PER_CHUNK = 100; // Full telemetry frames are ~6.8KB each — 800 = 5.4MB, exceeds Firestore 1MB doc limit
const FRAME_GROUPING_MS = 250;
const REPLAY_CACHE_VERSION = 2;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  return res.json();
}

async function fetchOpenF1(endpoint, sessionKey, extra = '', attempt = 1) {
  const url = `${OPENF1_BASE}/${endpoint}?session_key=${sessionKey}${extra}`;
  console.log(`  Fetching ${endpoint}${attempt > 1 ? ` (retry ${attempt})` : ''}...`);
  const start = Date.now();
  const data = await fetchJson(url);
  if (!Array.isArray(data)) {
    if (data?.detail?.includes?.('No results')) return [];
    if ((data?.detail?.includes?.('Rate limit') || data?.error?.includes?.('Too Many')) && attempt <= 5) {
      const wait = attempt * 5000;
      console.log(`  Rate limited! Waiting ${wait/1000}s before retry...`);
      await new Promise(r => setTimeout(r, wait));
      return fetchOpenF1(endpoint, sessionKey, extra, attempt + 1);
    }
    throw new Error(`Bad response from /${endpoint}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  console.log(`  ${endpoint}: ${data.length} records (${Date.now() - start}ms)`);
  return data;
}

async function fetchChunked(endpoint, sessionKey, dateStart, dateEnd) {
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const all = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + CHUNK_MINUTES * 60000);
    const from = cursor.toISOString().replace('.000Z', '').replace('Z', '');
    const to = next.toISOString().replace('.000Z', '').replace('Z', '');
    const chunk = await fetchOpenF1(endpoint, sessionKey,
      `&date%3E=${encodeURIComponent(from)}&date%3C=${encodeURIComponent(to)}`);
    all.push(...chunk);
    cursor = next;
    await new Promise(r => setTimeout(r, 2000));
  }
  return all;
}

function buildTimeLookup(records, driverField, dateField, valueFn) {
  const byDriver = new Map();
  for (const r of records) {
    const dn = r[driverField]; if (dn == null) continue;
    const ts = new Date(r[dateField]).getTime(); if (isNaN(ts)) continue;
    const list = byDriver.get(dn) ?? [];
    list.push({ ts, val: valueFn(r) });
    byDriver.set(dn, list);
  }
  for (const [, list] of byDriver) list.sort((a, b) => a.ts - b.ts);
  return function(dn, ms) {
    const list = byDriver.get(dn);
    if (!list || !list.length) return null;
    let lo = 0, hi = list.length - 1, result = list[0].val;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= ms) { result = list[mid].val; lo = mid + 1; } else hi = mid - 1;
    }
    return result;
  };
}

function buildPitCountLookup(pits) {
  const byDriver = new Map();
  for (const r of pits) { if (!r.driver_number || !r.date) continue; const list = byDriver.get(r.driver_number) ?? []; list.push(new Date(r.date).getTime()); byDriver.set(r.driver_number, list); }
  for (const [, l] of byDriver) l.sort((a, b) => a - b);
  return (dn, ms) => { const l = byDriver.get(dn); if (!l) return 0; let c = 0; for (const t of l) { if (t <= ms) c++; else break; } return c; };
}

function buildStintLookup(stints) {
  const byDriver = new Map();
  for (const r of stints) { if (!r.driver_number) continue; const list = byDriver.get(r.driver_number) ?? []; list.push({ lapStart: r.lap_start ?? 1, lapEnd: r.lap_end ?? 999, compound: r.compound ?? 'UNKNOWN', tyreAgeAtStart: r.tyre_age_at_start ?? 0 }); byDriver.set(r.driver_number, list); }
  for (const [, l] of byDriver) l.sort((a, b) => a.lapStart - b.lapStart);
  return (dn, lap) => { const l = byDriver.get(dn); if (!l) return { compound: 'UNKNOWN', tyreLapAge: 0 }; for (const s of l) { if (lap >= s.lapStart && lap <= s.lapEnd) return { compound: s.compound, tyreLapAge: s.tyreAgeAtStart + (lap - s.lapStart) }; } const last = l[l.length - 1]; return { compound: last.compound, tyreLapAge: last.tyreAgeAtStart }; };
}

async function run() {
  const sessionKey = parseInt(process.argv[2]);
  if (!sessionKey) { console.error('Usage: node _ingest-replay-local.js <sessionKey>'); process.exit(1); }

  const sessionDocRef = db.collection('replay_sessions').doc(String(sessionKey));

  // Claim lock
  await sessionDocRef.set({ firestoreStatus: 'ingesting', firestoreError: null, firestoreIngestStartedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`\nIngesting session ${sessionKey}...\n`);

  try {
    // 1. Fetch session meta
    const sessions = await fetchOpenF1('sessions', sessionKey);
    const meta = sessions[0];
    const dateStart = meta.date_start;
    const dateEnd = meta.date_end;
    const sessionStartMs = new Date(dateStart).getTime();

    // 2. Fetch drivers
    const rawDrivers = await fetchOpenF1('drivers', sessionKey);
    const drivers = rawDrivers.map(d => ({ driverNumber: d.driver_number, driverCode: d.name_acronym ?? '', fullName: d.full_name ?? '', teamName: d.team_name ?? '', teamColour: d.team_colour ? `#${d.team_colour}` : '#888' }));

    // 3. Fetch all endpoints
    const rawLocation = await fetchChunked('location', sessionKey, dateStart, dateEnd);
    const rawPosition = await fetchOpenF1('position', sessionKey);
    await new Promise(r => setTimeout(r, 1000));
    const rawCarData = await fetchChunked('car_data', sessionKey, dateStart, dateEnd);
    const rawIntervals = await fetchOpenF1('intervals', sessionKey);
    await new Promise(r => setTimeout(r, 1000));
    const rawLaps = await fetchOpenF1('laps', sessionKey);
    await new Promise(r => setTimeout(r, 1000));
    const rawStints = await fetchOpenF1('stints', sessionKey);
    const rawPits = await fetchOpenF1('pit', sessionKey);
    const rawRadio = await fetchOpenF1('team_radio', sessionKey);
    const rawRC = await fetchOpenF1('race_control', sessionKey);

    // 4. Build lookups
    const getCarData = buildTimeLookup(rawCarData, 'driver_number', 'date', r => ({ speed: r.speed ?? null, throttle: r.throttle ?? null, brake: r.brake ?? null, gear: r.n_gear ?? null, drs: r.drs ?? null }));
    const getInterval = buildTimeLookup(rawIntervals, 'driver_number', 'date', r => ({ gapToLeader: r.gap_to_leader != null ? String(r.gap_to_leader) : null, intervalToAhead: r.interval != null ? String(r.interval) : null }));
    const getLap = buildTimeLookup(rawLaps, 'driver_number', 'date_start', r => ({ lastLapTime: r.lap_duration ?? null, currentLap: r.lap_number ?? null, s1: r.duration_sector_1 ?? null, s2: r.duration_sector_2 ?? null, s3: r.duration_sector_3 ?? null }));
    const getPosition = buildTimeLookup(rawPosition, 'driver_number', 'date', r => r.position);
    const getPitCount = buildPitCountLookup(rawPits);
    const getStint = buildStintLookup(rawStints);

    // 5. Build frames
    console.log('\nBuilding frames...');
    const valid = rawLocation.filter(r => r.x != null && r.y != null && r.date).sort((a, b) => a.date.localeCompare(b.date));
    const frames = [];
    let i = 0;
    let radioIdx = 0;
    let rcIdx = 0;
    const radioSorted = rawRadio.filter(r => r.driver_number && r.date).map(r => ({ ts: new Date(r.date).getTime(), driverNumber: r.driver_number, message: r.recording_url ?? '(radio)', utcTimestamp: r.date })).sort((a, b) => a.ts - b.ts);
    const rcSorted = rawRC.filter(r => r.date && r.message).map(r => ({ ts: new Date(r.date).getTime(), date: r.date, lapNumber: r.lap_number ?? null, category: r.category ?? 'Other', flag: r.flag ?? null, message: r.message, scope: r.scope ?? null, sector: r.sector ?? null })).sort((a, b) => a.ts - b.ts);

    while (i < valid.length) {
      const anchor = valid[i];
      const anchorMs = new Date(anchor.date).getTime();
      const positions = [];
      const seen = new Set();
      while (i < valid.length) {
        const posMs = new Date(valid[i].date).getTime();
        if (posMs - anchorMs > FRAME_GROUPING_MS) break;
        const dn = valid[i].driver_number;
        if (seen.has(dn)) { i++; continue; }
        seen.add(dn);
        const frameMs = posMs;
        const car = getCarData(dn, frameMs);
        const intv = getInterval(dn, frameMs);
        const lap = getLap(dn, frameMs);
        const racePos = getPosition(dn, frameMs) ?? 99;
        const pitCount = getPitCount(dn, frameMs);
        const lapNum = lap?.currentLap ?? 0;
        const stint = getStint(dn, lapNum);
        positions.push({ driverNumber: dn, x: valid[i].x, y: valid[i].y, position: racePos, speed: car?.speed ?? null, throttle: car?.throttle ?? null, brake: car?.brake ?? null, gear: car?.gear ?? null, drs: car?.drs ?? null, gapToLeader: intv?.gapToLeader ?? null, intervalToAhead: intv?.intervalToAhead ?? null, lastLapTime: lap?.lastLapTime ?? null, bestLapTime: null, currentLap: lap?.currentLap ?? null, s1: lap?.s1 ?? null, s2: lap?.s2 ?? null, s3: lap?.s3 ?? null, tyreCompound: stint.compound, tyreLapAge: stint.tyreLapAge, pitStopCount: pitCount, inPit: car?.speed != null && car.speed < 5 && pitCount > 0 && lapNum > 0 });
        i++;
      }
      if (!positions.length) continue;
      const frame = { virtualTimeMs: anchorMs - sessionStartMs, wallTimeMs: anchorMs, positions };
      // Radio
      const fRadio = [];
      while (radioIdx < radioSorted.length && radioSorted[radioIdx].ts <= anchorMs + 125) { const r = radioSorted[radioIdx]; if (r.ts >= anchorMs - 125) fRadio.push({ driverNumber: r.driverNumber, message: r.message, utcTimestamp: r.utcTimestamp }); radioIdx++; }
      if (fRadio.length) frame.radioMessages = fRadio;
      // Race control
      const fRC = [];
      while (rcIdx < rcSorted.length && rcSorted[rcIdx].ts <= anchorMs + 125) { const r = rcSorted[rcIdx]; if (r.ts >= anchorMs - 125) fRC.push({ date: r.date, lapNumber: r.lapNumber, category: r.category, flag: r.flag, message: r.message, scope: r.scope, sector: r.sector }); rcIdx++; }
      if (fRC.length) frame.raceControlMessages = fRC;
      frames.push(frame);
    }

    // Best lap post-pass
    const bestLaps = new Map();
    for (const f of frames) for (const p of f.positions) { if (p.lastLapTime > 0) { const c = bestLaps.get(p.driverNumber) ?? Infinity; if (p.lastLapTime < c) bestLaps.set(p.driverNumber, p.lastLapTime); } }
    for (const f of frames) for (const p of f.positions) p.bestLapTime = bestLaps.get(p.driverNumber) ?? null;

    console.log(`Built ${frames.length} frames\n`);
    const durationMs = frames.length > 0 ? frames[frames.length - 1].virtualTimeMs : 0;

    // 6. Write chunks
    let chunkIndex = 0;
    let chunkFrames = [];
    for (const frame of frames) {
      chunkFrames.push(frame);
      if (chunkFrames.length >= FRAMES_PER_CHUNK) {
        const docId = `${sessionKey}_${String(chunkIndex).padStart(4, '0')}`;
        await db.collection('replay_chunks').doc(docId).set({ sessionKey, chunkIndex, startTimeMs: chunkFrames[0].virtualTimeMs, endTimeMs: chunkFrames[chunkFrames.length - 1].virtualTimeMs, frameCount: chunkFrames.length, frames: chunkFrames });
        console.log(`  Wrote chunk ${chunkIndex} (${chunkFrames.length} frames)`);
        chunkIndex++;
        chunkFrames = [];
      }
    }
    if (chunkFrames.length > 0) {
      const docId = `${sessionKey}_${String(chunkIndex).padStart(4, '0')}`;
      await db.collection('replay_chunks').doc(docId).set({ sessionKey, chunkIndex, startTimeMs: chunkFrames[0].virtualTimeMs, endTimeMs: chunkFrames[chunkFrames.length - 1].virtualTimeMs, frameCount: chunkFrames.length, frames: chunkFrames });
      console.log(`  Wrote chunk ${chunkIndex} (${chunkFrames.length} frames)`);
      chunkIndex++;
    }

    // 7. Write meta
    await db.collection('replay_meta').doc(String(sessionKey)).set({ sessionKey, sessionName: meta.session_name ?? '', meetingName: meta.meeting_name ?? '', durationMs, totalLaps: meta.total_laps ?? null, totalFrames: frames.length, totalChunks: chunkIndex, drivers, radioMessages: radioSorted.map(r => ({ driverNumber: r.driverNumber, message: r.message, utcTimestamp: r.utcTimestamp })), ingestedAt: FieldValue.serverTimestamp() });

    // 8. Update session doc
    await sessionDocRef.set({ firestoreStatus: 'complete', firestoreChunkCount: chunkIndex, firestoreTotalFrames: frames.length, firestoreIngestedAt: FieldValue.serverTimestamp(), firestoreError: null, cacheVersion: REPLAY_CACHE_VERSION, circuitKey: meta.circuit_key ?? null, meetingName: meta.meeting_name ?? null, sessionName: meta.session_name ?? null, dateStart: meta.date_start ?? null, dateEnd: meta.date_end ?? null }, { merge: true });

    console.log(`\nDone! ${frames.length} frames in ${chunkIndex} chunks. Session marked as complete.`);
  } catch (err) {
    console.error('FAILED:', err.message);
    await sessionDocRef.set({ firestoreStatus: 'failed', firestoreError: err.message }, { merge: true }).catch(() => {});
  }
  process.exit(0);
}

run();
