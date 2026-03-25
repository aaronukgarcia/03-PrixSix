// GUID: REPLAY_INGEST-000-v01
// [Intent] Shared ingest engine for durable Firestore telemetry storage.
//          Fetches all OpenF1 endpoints (location, position, car_data, laps, stints, pit, team_radio,
//          drivers, sessions), builds full-fidelity frames (NO downsampling — keeps all ~18K time points),
//          merges car_data/intervals/laps/stints into position frames, and writes chunk documents
//          to Firestore for fast subsequent loading.
// [Inbound Trigger] Called by historical-replay route on cache miss (firestoreStatus !== 'complete').
// [Downstream Impact] Writes to replay_chunks, replay_meta, replay_sessions collections.
//          replay-chunks/route.ts reads these for client chunk-loading.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { ReplayFrame } from '@/app/(app)/pit-wall/_types/showreel.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OPENF1_BASE = 'https://api.openf1.org/v1';
const FETCH_TIMEOUT_MS = 90_000;
const CHUNK_MINUTES = 10;
const FRAMES_PER_CHUNK = 800;
const FRAME_GROUPING_MS = 250;
const CAR_DATA_MATCH_WINDOW_MS = 500;
const REPLAY_CACHE_VERSION = 2; // v1 = legacy showreel, v2 = full-fidelity with telemetry

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// GUID: REPLAY_INGEST-001-v01
// [Intent] Chunk document stored in replay_chunks/{sessionKey}_{chunkIndex}.
export interface ReplayChunkDoc {
  sessionKey: number;
  chunkIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  frameCount: number;
  frames: ReplayFrame[];
}

// GUID: REPLAY_INGEST-002-v01
// [Intent] Metadata document stored in replay_meta/{sessionKey}.
export interface ReplayMetaDoc {
  sessionKey: number;
  sessionName: string;
  meetingName: string;
  durationMs: number;
  totalLaps: number | null;
  totalFrames: number;
  totalChunks: number;
  drivers: Array<{
    driverNumber: number;
    driverCode: string;
    fullName: string;
    teamName: string;
    teamColour: string;
  }>;
  radioMessages: Array<{
    driverNumber: number;
    message: string;
    utcTimestamp: string;
  }>;
  ingestedAt: FirebaseFirestore.FieldValue;
}

export type FirestoreStatus = 'none' | 'ingesting' | 'complete' | 'failed';

// GUID: REPLAY_INGEST-003-v01
// [Intent] Progress callback for streaming frames to client during ingest.
export interface IngestCallbacks {
  onProgress?: (status: { endpoint: string; recordCount?: number }) => void;
  onFrame: (frame: ReplayFrame) => void;
  onMeta: (meta: {
    sessionKey: number;
    sessionName: string;
    meetingName: string;
    durationMs: number;
    totalLaps: number | null;
    drivers: ReplayMetaDoc['drivers'];
    samplingIntervalMs: number;
  }) => void;
  onComplete: (stats: { totalFrames: number; totalChunks: number }) => void;
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

// GUID: REPLAY_INGEST-004-v01
// [Intent] Fetch JSON from OpenF1 with timeout and abort controller.
async function fetchJson(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(id);
    const text = await res.text();
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// GUID: REPLAY_INGEST-005-v01
// [Intent] Fetch an OpenF1 endpoint with retry on rate limit and chunking for large datasets.
async function fetchOpenF1(
  endpoint: string,
  sessionKey: number,
  extraParams = '',
  attempt = 1,
): Promise<any[]> {
  const url = `${OPENF1_BASE}/${endpoint}?session_key=${sessionKey}${extraParams}`;
  const data = await fetchJson(url);

  if (!Array.isArray(data)) {
    const obj = data as any;
    if (obj?.detail?.includes?.('No results')) return [];
    if (obj?.detail?.includes?.('too much')) return []; // signal: need chunking
    if ((obj?.error || obj?.detail) && attempt <= 5) {
      const waitMs = attempt * 3000;
      await new Promise(r => setTimeout(r, waitMs));
      return fetchOpenF1(endpoint, sessionKey, extraParams, attempt + 1);
    }
    throw new Error(`Expected array from /${endpoint}, got: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// GUID: REPLAY_INGEST-006-v01
// [Intent] Fetch location data in time-windowed chunks to avoid OpenF1's "too much data" error.
async function fetchLocationChunked(
  sessionKey: number,
  dateStart: string,
  dateEnd: string,
): Promise<any[]> {
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const all: any[] = [];

  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + CHUNK_MINUTES * 60_000);
    const from = cursor.toISOString().replace('.000Z', '').replace('Z', '');
    const to = next.toISOString().replace('.000Z', '').replace('Z', '');
    const chunk = await fetchOpenF1(
      'location',
      sessionKey,
      `&date%3E=${encodeURIComponent(from)}&date%3C=${encodeURIComponent(to)}`,
    );
    all.push(...chunk);
    cursor = next;
    // Rate limit: polite 1.5s delay between chunks
    await new Promise(r => setTimeout(r, 1500));
  }
  return all;
}

// GUID: REPLAY_INGEST-007-v01
// [Intent] Fetch car_data in time-windowed chunks (largest dataset, ~530K records).
async function fetchCarDataChunked(
  sessionKey: number,
  dateStart: string,
  dateEnd: string,
): Promise<any[]> {
  // Try full request first
  const full = await fetchOpenF1('car_data', sessionKey);
  if (full.length > 0) return full;

  // Chunk by time windows
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const all: any[] = [];

  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + CHUNK_MINUTES * 60_000);
    const from = cursor.toISOString().replace('.000Z', '').replace('Z', '');
    const to = next.toISOString().replace('.000Z', '').replace('Z', '');
    const chunk = await fetchOpenF1(
      'car_data',
      sessionKey,
      `&date%3E=${encodeURIComponent(from)}&date%3C=${encodeURIComponent(to)}`,
    );
    all.push(...chunk);
    cursor = next;
    await new Promise(r => setTimeout(r, 1500));
  }
  return all;
}

// ---------------------------------------------------------------------------
// Lookup builders (binary search for nearest value at a given time per driver)
// ---------------------------------------------------------------------------

interface TimeEntry<T> { ts: number; val: T }

// GUID: REPLAY_INGEST-008-v01
// [Intent] Build a per-driver time-sorted lookup with binary search for floor entry.
function buildTimeLookup<T>(
  records: any[],
  driverField: string,
  dateField: string,
  valueFn: (r: any) => T,
): (driverNumber: number, dateMs: number) => T | null {
  const byDriver = new Map<number, TimeEntry<T>[]>();
  for (const r of records) {
    const dn = r[driverField];
    if (dn == null) continue;
    const ts = new Date(r[dateField]).getTime();
    if (isNaN(ts)) continue;
    const list = byDriver.get(dn) ?? [];
    list.push({ ts, val: valueFn(r) });
    byDriver.set(dn, list);
  }
  for (const [, list] of byDriver) list.sort((a, b) => a.ts - b.ts);

  return function getAt(driverNumber: number, dateMs: number): T | null {
    const list = byDriver.get(driverNumber);
    if (!list || list.length === 0) return null;
    let lo = 0, hi = list.length - 1, result = list[0].val;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= dateMs) { result = list[mid].val; lo = mid + 1; }
      else hi = mid - 1;
    }
    return result;
  };
}

// GUID: REPLAY_INGEST-009-v01
// [Intent] Build pit stop count lookup — count pits before each timestamp.
function buildPitCountLookup(pitRecords: any[]): (driverNumber: number, dateMs: number) => number {
  const byDriver = new Map<number, number[]>();
  for (const r of pitRecords) {
    if (r.driver_number == null) continue;
    const ts = new Date(r.date).getTime();
    if (isNaN(ts)) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push(ts);
    byDriver.set(r.driver_number, list);
  }
  for (const [, list] of byDriver) list.sort((a, b) => a - b);

  return function getPitCountAt(driverNumber: number, dateMs: number): number {
    const list = byDriver.get(driverNumber);
    if (!list) return 0;
    let count = 0;
    for (const ts of list) { if (ts <= dateMs) count++; else break; }
    return count;
  };
}

// GUID: REPLAY_INGEST-010-v01
// [Intent] Build stint (tyre) lookup — compound and age by lap number.
function buildStintLookup(
  stintRecords: any[],
): (driverNumber: number, currentLap: number) => { compound: string; tyreLapAge: number } {
  const byDriver = new Map<number, Array<{ lapStart: number; lapEnd: number; compound: string; tyreAgeAtStart: number }>>();
  for (const r of stintRecords) {
    if (r.driver_number == null) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push({
      lapStart: r.lap_start ?? 1,
      lapEnd: r.lap_end ?? 999,
      compound: r.compound ?? 'UNKNOWN',
      tyreAgeAtStart: r.tyre_age_at_start ?? 0,
    });
    byDriver.set(r.driver_number, list);
  }
  for (const [, list] of byDriver) list.sort((a, b) => a.lapStart - b.lapStart);

  return function getStintAt(driverNumber: number, currentLap: number) {
    const list = byDriver.get(driverNumber);
    if (!list) return { compound: 'UNKNOWN', tyreLapAge: 0 };
    for (const stint of list) {
      if (currentLap >= stint.lapStart && currentLap <= stint.lapEnd) {
        return { compound: stint.compound, tyreLapAge: stint.tyreAgeAtStart + (currentLap - stint.lapStart) };
      }
    }
    const last = list[list.length - 1];
    return { compound: last.compound, tyreLapAge: last.tyreAgeAtStart };
  };
}

// GUID: REPLAY_INGEST-011-v01
// [Intent] Build sorted radio messages array for frame matching.
function buildRadioMessages(radioRecords: any[]): Array<{ ts: number; driverNumber: number; message: string; utcTimestamp: string }> {
  return radioRecords
    .filter((r: any) => r.driver_number != null && r.date != null)
    .map((r: any) => ({
      ts: new Date(r.date).getTime(),
      driverNumber: r.driver_number as number,
      message: (r.recording_url ?? '(radio)') as string,
      utcTimestamp: r.date as string,
    }))
    .sort((a, b) => a.ts - b.ts);
}

// GUID: REPLAY_INGEST-021-v01
// [Intent] Build sorted race control messages array for frame matching.
//          Maps OpenF1 /race_control records into a timestamped array for
//          assignment to replay frames using the same 250ms window technique as radio.
function buildRaceControlMessages(raceControlRecords: any[]): Array<{
  ts: number; date: string; lapNumber: number | null; category: string;
  flag: string | null; message: string; scope: string | null; sector: number | null;
}> {
  return raceControlRecords
    .filter((r: any) => r.date != null && r.message != null)
    .map((r: any) => ({
      ts: new Date(r.date).getTime(),
      date: r.date as string,
      lapNumber: (r.lap_number ?? null) as number | null,
      category: (r.category ?? 'Other') as string,
      flag: (r.flag ?? null) as string | null,
      message: r.message as string,
      scope: (r.scope ?? null) as string | null,
      sector: (r.sector ?? null) as number | null,
    }))
    .sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------------------
// Frame building — full fidelity, no downsampling
// ---------------------------------------------------------------------------

// GUID: REPLAY_INGEST-012-v01
// [Intent] Build full-fidelity ReplayFrame[] from raw location data + all telemetry lookups.
//          No downsampling — keeps every unique time point from /location (~2 Hz per driver).
//          Car data, intervals, laps, stints, pit stops merged into each position entry.
//          Radio messages matched to frames within 250ms window.
function buildFullFidelityFrames(
  locationRaw: any[],
  sessionStartMs: number,
  getCarData: (dn: number, ms: number) => any | null,
  getInterval: (dn: number, ms: number) => any | null,
  getLap: (dn: number, ms: number) => any | null,
  getPosition: (dn: number, ms: number) => number | null,
  getPitCount: (dn: number, ms: number) => number,
  getStint: (dn: number, lap: number) => { compound: string; tyreLapAge: number },
  radioMessages: Array<{ ts: number; driverNumber: number; message: string; utcTimestamp: string }>,
  raceControlMessages: Array<{ ts: number; date: string; lapNumber: number | null; category: string; flag: string | null; message: string; scope: string | null; sector: number | null }>,
): ReplayFrame[] {
  // Filter invalid records and sort by date
  const valid = locationRaw
    .filter((r: any) => r.x != null && r.y != null && r.date != null)
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  if (valid.length === 0) return [];

  // Group into frames using FRAME_GROUPING_MS window
  const frames: ReplayFrame[] = [];
  let i = 0;
  let radioIdx = 0;
  let rcIdx = 0;

  while (i < valid.length) {
    const anchor = valid[i];
    const anchorMs = new Date(anchor.date).getTime();

    const positions: ReplayFrame['positions'] = [];

    // Collect all positions within the grouping window
    const seenDrivers = new Set<number>();
    while (i < valid.length) {
      const posMs = new Date(valid[i].date).getTime();
      if (posMs - anchorMs > FRAME_GROUPING_MS) break;

      const dn = valid[i].driver_number as number;
      // Deduplicate: keep first entry per driver per frame
      if (seenDrivers.has(dn)) { i++; continue; }
      seenDrivers.add(dn);

      const frameMs = posMs;

      // Merge car data (nearest within 500ms)
      const car = getCarData(dn, frameMs);
      // Merge intervals
      const intv = getInterval(dn, frameMs);
      // Merge lap data
      const lap = getLap(dn, frameMs);
      // Merge race position
      const racePos = getPosition(dn, frameMs) ?? 99;
      // Merge pit count
      const pitCount = getPitCount(dn, frameMs);
      // Merge stint
      const lapNum = lap?.currentLap ?? 0;
      const stint = getStint(dn, lapNum);

      positions.push({
        driverNumber: dn,
        x: valid[i].x,
        y: valid[i].y,
        position: racePos,
        speed: car?.speed ?? null,
        throttle: car?.throttle ?? null,
        brake: car?.brake ?? null,
        gear: car?.gear ?? null,
        drs: car?.drs ?? null,
        gapToLeader: intv?.gapToLeader ?? null,
        intervalToAhead: intv?.intervalToAhead ?? null,
        lastLapTime: lap?.lastLapTime ?? null,
        bestLapTime: null, // computed in post-pass
        currentLap: lap?.currentLap ?? null,
        s1: lap?.s1 ?? null,
        s2: lap?.s2 ?? null,
        s3: lap?.s3 ?? null,
        tyreCompound: stint.compound,
        tyreLapAge: stint.tyreLapAge,
        pitStopCount: pitCount,
        inPit: (car?.speed != null && car.speed < 5 && pitCount > 0 && lapNum > 0),
      });

      i++;
    }

    if (positions.length === 0) continue;

    const frame: ReplayFrame = {
      virtualTimeMs: anchorMs - sessionStartMs,
      wallTimeMs: anchorMs,
      positions,
    };

    // Match radio messages to this frame (within 250ms window)
    const frameRadio: Array<{ driverNumber: number; message: string; utcTimestamp: string }> = [];
    while (radioIdx < radioMessages.length && radioMessages[radioIdx].ts <= anchorMs + 125) {
      const r = radioMessages[radioIdx];
      if (r.ts >= anchorMs - 125) {
        frameRadio.push({ driverNumber: r.driverNumber, message: r.message, utcTimestamp: r.utcTimestamp });
      }
      radioIdx++;
    }
    if (frameRadio.length > 0) {
      frame.radioMessages = frameRadio;
    }

    // Match race control messages to this frame (within 250ms window)
    const frameRaceControl: Array<{ date: string; lapNumber: number | null; category: string; flag: string | null; message: string; scope: string | null; sector: number | null }> = [];
    while (rcIdx < raceControlMessages.length && raceControlMessages[rcIdx].ts <= anchorMs + 125) {
      const rc = raceControlMessages[rcIdx];
      if (rc.ts >= anchorMs - 125) {
        frameRaceControl.push({ date: rc.date, lapNumber: rc.lapNumber, category: rc.category, flag: rc.flag, message: rc.message, scope: rc.scope, sector: rc.sector });
      }
      rcIdx++;
    }
    if (frameRaceControl.length > 0) {
      frame.raceControlMessages = frameRaceControl;
    }

    frames.push(frame);
  }

  // Post-pass: compute best lap times per driver
  const bestLaps = new Map<number, number>();
  for (const frame of frames) {
    for (const pos of frame.positions) {
      if (pos.lastLapTime != null && pos.lastLapTime > 0) {
        const current = bestLaps.get(pos.driverNumber) ?? Infinity;
        if (pos.lastLapTime < current) bestLaps.set(pos.driverNumber, pos.lastLapTime);
      }
    }
  }
  for (const frame of frames) {
    for (const pos of frame.positions) {
      pos.bestLapTime = bestLaps.get(pos.driverNumber) ?? null;
    }
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Chunk writer
// ---------------------------------------------------------------------------

// GUID: REPLAY_INGEST-013-v01
// [Intent] Write a single chunk document to Firestore.
async function writeChunk(
  db: FirebaseFirestore.Firestore,
  sessionKey: number,
  chunkIndex: number,
  frames: ReplayFrame[],
): Promise<void> {
  const docId = `${sessionKey}_${String(chunkIndex).padStart(4, '0')}`;
  const chunk: ReplayChunkDoc = {
    sessionKey,
    chunkIndex,
    startTimeMs: frames[0].virtualTimeMs,
    endTimeMs: frames[frames.length - 1].virtualTimeMs,
    frameCount: frames.length,
    frames,
  };
  await db.collection('replay_chunks').doc(docId).set(chunk);
}

// ---------------------------------------------------------------------------
// Main ingest function
// ---------------------------------------------------------------------------

// GUID: REPLAY_INGEST-014-v01
// [Intent] Full ingest pipeline: fetch all OpenF1 data, build frames, stream to client,
//          write chunks to Firestore, write meta doc, update session doc.
//          Called by historical-replay route on Firestore miss.
export async function ingestReplaySession(
  sessionKey: number,
  callbacks: IngestCallbacks,
): Promise<void> {
  const db = getFirestore();
  const sessionDocRef = db.collection('replay_sessions').doc(String(sessionKey));

  try {
    // GUID: REPLAY_INGEST-020-v01
    // [Intent] Atomically claim the ingest slot using a Firestore transaction.
    //          Only one request can transition firestoreStatus from 'none' (or 'failed')
    //          to 'ingesting'. Concurrent requests see the status has already changed and
    //          bail out, preventing duplicate chunk writes.
    const claimedIngest = await db.runTransaction(async (txn) => {
      const snap = await txn.get(sessionDocRef);
      const currentStatus = snap.exists ? (snap.data()?.firestoreStatus as FirestoreStatus) ?? 'none' : 'none';
      if (currentStatus !== 'none' && currentStatus !== 'failed') {
        return false; // another request is already ingesting or complete
      }
      txn.set(sessionDocRef, {
        firestoreStatus: 'ingesting' as FirestoreStatus,
        firestoreError: null,
        firestoreIngestStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });

    if (!claimedIngest) {
      // Another request is handling ingest — exit gracefully
      callbacks.onError('Ingest already in progress or complete');
      return;
    }

    // 1. Fetch session metadata
    const sessionData = await fetchOpenF1('sessions', sessionKey);
    if (!Array.isArray(sessionData) || sessionData.length === 0) {
      throw new Error(`No session metadata found for session_key=${sessionKey}`);
    }
    const sessionMeta = sessionData[0];
    const dateStart = sessionMeta.date_start;
    const dateEnd = sessionMeta.date_end;
    const sessionStartMs = new Date(dateStart).getTime();

    // 2. Fetch drivers
    const rawDrivers = await fetchOpenF1('drivers', sessionKey);
    const drivers = (Array.isArray(rawDrivers) ? rawDrivers : []).map((d: any) => ({
      driverNumber: d.driver_number as number,
      driverCode: (d.name_acronym ?? '') as string,
      fullName: (d.full_name ?? '') as string,
      teamName: (d.team_name ?? '') as string,
      teamColour: d.team_colour ? `#${d.team_colour}` : '#888888',
    }));

    // GUID: REPLAY_INGEST-022-v01
    // [Intent] Fetch all data endpoints with keep-alive progress callbacks.
    //          Each callback.onProgress() sends a ping to the HTTP stream, preventing
    //          the load balancer from killing the idle connection (60s timeout).
    //          Without these pings, the stream sits silent for 2-3 min and gets 504'd.
    const ping = (endpoint: string, count?: number) => callbacks.onProgress?.({ endpoint, recordCount: count });

    // 3. Fetch all data endpoints in sequence (with rate limit delays)
    ping('location');
    const rawLocation = await fetchLocationChunked(sessionKey, dateStart, dateEnd);
    ping('location', rawLocation.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('position');
    const rawPosition = await fetchOpenF1('position', sessionKey);
    ping('position', rawPosition.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('car_data');
    const rawCarData = await fetchCarDataChunked(sessionKey, dateStart, dateEnd);
    ping('car_data', rawCarData.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('intervals');
    const rawIntervals = await fetchOpenF1('intervals', sessionKey);
    ping('intervals', rawIntervals.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('laps');
    const rawLaps = await fetchOpenF1('laps', sessionKey);
    ping('laps', rawLaps.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('stints');
    const rawStints = await fetchOpenF1('stints', sessionKey);
    ping('stints', rawStints.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('pit');
    const rawPits = await fetchOpenF1('pit', sessionKey);
    ping('pit', rawPits.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('team_radio');
    const rawRadio = await fetchOpenF1('team_radio', sessionKey);
    ping('team_radio', rawRadio.length);
    await new Promise(r => setTimeout(r, 2000));

    ping('race_control');
    const rawRaceControl = await fetchOpenF1('race_control', sessionKey);
    ping('race_control', rawRaceControl.length);

    // 4. Build lookups
    const getCarData = buildTimeLookup(rawCarData, 'driver_number', 'date', (r: any) => ({
      speed: r.speed ?? null,
      throttle: r.throttle ?? null,
      brake: r.brake ?? null,
      gear: r.n_gear ?? null,
      drs: r.drs ?? null,
    }));

    const getInterval = buildTimeLookup(rawIntervals, 'driver_number', 'date', (r: any) => ({
      gapToLeader: r.gap_to_leader != null ? String(r.gap_to_leader) : null,
      intervalToAhead: r.interval != null ? String(r.interval) : null,
    }));

    const getLap = buildTimeLookup(rawLaps, 'driver_number', 'date_start', (r: any) => ({
      lastLapTime: r.lap_duration ?? null,
      currentLap: r.lap_number ?? null,
      s1: r.duration_sector_1 ?? null,
      s2: r.duration_sector_2 ?? null,
      s3: r.duration_sector_3 ?? null,
    }));

    const getPosition = buildTimeLookup(rawPosition, 'driver_number', 'date', (r: any) => r.position as number);
    const getPitCount = buildPitCountLookup(rawPits);
    const getStint = buildStintLookup(rawStints);
    const radioMessages = buildRadioMessages(rawRadio);
    const raceControlMessages = buildRaceControlMessages(rawRaceControl);

    // 5. Build full-fidelity frames
    const frames = buildFullFidelityFrames(
      rawLocation,
      sessionStartMs,
      getCarData,
      getInterval,
      getLap,
      getPosition,
      getPitCount,
      getStint,
      radioMessages,
      raceControlMessages,
    );

    const durationMs = frames.length > 0 ? frames[frames.length - 1].virtualTimeMs : 0;

    // Emit metadata to client
    callbacks.onMeta({
      sessionKey,
      sessionName: sessionMeta.session_name ?? '',
      meetingName: sessionMeta.meeting_name ?? '',
      durationMs,
      totalLaps: sessionMeta.total_laps ?? null,
      drivers,
      samplingIntervalMs: 500, // ~2Hz full fidelity
    });

    // 6. Stream frames to client AND write chunks to Firestore simultaneously
    let chunkIndex = 0;
    let chunkFrames: ReplayFrame[] = [];

    for (const frame of frames) {
      // Stream to client
      callbacks.onFrame(frame);

      // Accumulate for chunk writing
      chunkFrames.push(frame);

      if (chunkFrames.length >= FRAMES_PER_CHUNK) {
        await writeChunk(db, sessionKey, chunkIndex, chunkFrames);
        chunkIndex++;
        chunkFrames = [];
      }
    }

    // Write remaining frames as final chunk
    if (chunkFrames.length > 0) {
      await writeChunk(db, sessionKey, chunkIndex, chunkFrames);
      chunkIndex++;
    }

    const totalChunks = chunkIndex;

    // 7. Collect all radio messages for meta doc
    const allRadio: ReplayMetaDoc['radioMessages'] = radioMessages.map(r => ({
      driverNumber: r.driverNumber,
      message: r.message,
      utcTimestamp: r.utcTimestamp,
    }));

    // 8. Write replay_meta document
    const metaDoc: ReplayMetaDoc = {
      sessionKey,
      sessionName: sessionMeta.session_name ?? '',
      meetingName: sessionMeta.meeting_name ?? '',
      durationMs,
      totalLaps: sessionMeta.total_laps ?? null,
      totalFrames: frames.length,
      totalChunks,
      drivers,
      radioMessages: allRadio,
      ingestedAt: FieldValue.serverTimestamp(),
    };
    await db.collection('replay_meta').doc(String(sessionKey)).set(metaDoc);

    // 9. Update replay_sessions doc with Firestore status
    await sessionDocRef.set({
      firestoreStatus: 'complete' as FirestoreStatus,
      firestoreChunkCount: totalChunks,
      firestoreTotalFrames: frames.length,
      firestoreIngestedAt: FieldValue.serverTimestamp(),
      firestoreError: null,
      cacheVersion: REPLAY_CACHE_VERSION,
    }, { merge: true });

    callbacks.onComplete({ totalFrames: frames.length, totalChunks });

  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown ingest error';
    // Mark as failed
    await sessionDocRef.set({
      firestoreStatus: 'failed' as FirestoreStatus,
      firestoreError: errorMsg,
    }, { merge: true }).catch(() => {});
    callbacks.onError(errorMsg);
    throw err;
  }
}

// GUID: REPLAY_INGEST-015-v01
// [Intent] Check Firestore status for a session — used by historical-replay route to decide path.
// GUID: REPLAY_INGEST-015-v02
// [Intent] Check Firestore status for a session — used by historical-replay route to decide path.
//          v02: Added stale lock recovery. If firestoreStatus === 'ingesting' but the lock
//               was set more than 5 minutes ago, the ingest worker likely died (SIGKILL from
//               load balancer timeout). Auto-reset to 'none' so a new ingest can start.
//               Without this, a failed ingest permanently blocks all future replay attempts.
const STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function getSessionFirestoreStatus(
  sessionKey: number,
): Promise<{ status: FirestoreStatus; totalChunks: number; totalFrames: number }> {
  const db = getFirestore();
  const docRef = db.collection('replay_sessions').doc(String(sessionKey));
  const doc = await docRef.get();
  if (!doc.exists) {
    return { status: 'none', totalChunks: 0, totalFrames: 0 };
  }
  const data = doc.data()!;
  let status = (data.firestoreStatus as FirestoreStatus) ?? 'none';

  // Stale lock recovery: if 'ingesting' for more than 5 minutes, the worker died
  if (status === 'ingesting') {
    const lockTime = data.firestoreIngestStartedAt?._seconds
      ? data.firestoreIngestStartedAt._seconds * 1000
      : data.firestoreIngestedAt?._seconds
        ? data.firestoreIngestedAt._seconds * 1000
        : 0;
    const age = lockTime > 0 ? Date.now() - lockTime : Infinity;
    if (age > STALE_LOCK_TIMEOUT_MS) {
      // Auto-recover: reset to 'none' so next request can retry
      await docRef.set({
        firestoreStatus: 'none' as FirestoreStatus,
        firestoreError: 'Stale lock recovered — previous ingest timed out',
      }, { merge: true }).catch(() => {});
      status = 'none';
    }
  }

  return {
    status,
    totalChunks: data.firestoreChunkCount ?? 0,
    totalFrames: data.firestoreTotalFrames ?? 0,
  };
}

// GUID: REPLAY_INGEST-016-v01
// [Intent] Load chunk documents from Firestore for the replay-chunks API route.
export async function loadChunks(
  sessionKey: number,
  fromChunk: number,
  count: number,
): Promise<ReplayChunkDoc[]> {
  const db = getFirestore();
  const chunks: ReplayChunkDoc[] = [];

  for (let i = fromChunk; i < fromChunk + count; i++) {
    const docId = `${sessionKey}_${String(i).padStart(4, '0')}`;
    const doc = await db.collection('replay_chunks').doc(docId).get();
    if (!doc.exists) break;
    chunks.push(doc.data() as ReplayChunkDoc);
  }

  return chunks;
}

// GUID: REPLAY_INGEST-017-v01
// [Intent] Load replay metadata for the replay-chunks API route (first request includes meta).
export async function loadReplayMeta(sessionKey: number): Promise<ReplayMetaDoc | null> {
  const db = getFirestore();
  const doc = await db.collection('replay_meta').doc(String(sessionKey)).get();
  if (!doc.exists) return null;
  return doc.data() as ReplayMetaDoc;
}

// GUID: REPLAY_INGEST-018-v01
// [Intent] Purge all Firestore data for a replay session (chunks + meta + status reset).
//          Used by admin purge-replay route.
export async function purgeReplaySession(
  sessionKey: number,
  purgeAll = false,
): Promise<{ deletedChunks: number; sessionsReset: number }> {
  const db = getFirestore();
  let deletedChunks = 0;
  let sessionsReset = 0;

  if (purgeAll) {
    // Purge ALL sessions
    const sessionsSnapshot = await db.collection('replay_sessions').get();
    for (const sessionDoc of sessionsSnapshot.docs) {
      const sk = sessionDoc.data().sessionKey as number;
      deletedChunks += await deleteSessionChunks(db, sk);
      await db.collection('replay_meta').doc(String(sk)).delete().catch(() => {});
      await sessionDoc.ref.update({
        firestoreStatus: 'none',
        firestoreChunkCount: 0,
        firestoreTotalFrames: 0,
        firestoreIngestedAt: null,
        firestoreError: null,
      });
      sessionsReset++;
    }
  } else {
    deletedChunks = await deleteSessionChunks(db, sessionKey);
    await db.collection('replay_meta').doc(String(sessionKey)).delete().catch(() => {});
    await db.collection('replay_sessions').doc(String(sessionKey)).update({
      firestoreStatus: 'none',
      firestoreChunkCount: 0,
      firestoreTotalFrames: 0,
      firestoreIngestedAt: null,
      firestoreError: null,
    }).catch(() => {});
    sessionsReset = 1;
  }

  return { deletedChunks, sessionsReset };
}

// GUID: REPLAY_INGEST-019-v01
// [Intent] Delete all chunk documents for a session using batched deletes (500 ops max per batch).
async function deleteSessionChunks(
  db: FirebaseFirestore.Firestore,
  sessionKey: number,
): Promise<number> {
  const snapshot = await db.collection('replay_chunks')
    .where('sessionKey', '==', sessionKey)
    .select() // only fetch doc refs, not data
    .get();

  if (snapshot.empty) return 0;

  let deleted = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    batchCount++;
    deleted++;
    if (batchCount >= 500) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  return deleted;
}
