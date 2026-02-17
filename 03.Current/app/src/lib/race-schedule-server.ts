// GUID: LIB_RACE_SCHEDULE_SERVER-000-v01
// @SECURITY_FIX: GEMINI-AUDIT-052 - Server-side race schedule from Firestore.
//   Provides trusted source of truth for race timing that cannot be tampered with by clients.
//   Used by API routes for server-side validation of prediction deadlines and race lockouts.
// [Intent] Server-side module to fetch race schedule from Firestore with in-memory caching.
//          Replaces hardcoded RaceSchedule imports in API routes to prevent client tampering.
// [Inbound Trigger] Called by API routes that need race timing data (e.g., /api/submit-prediction).
// [Downstream Impact] All server-side deadline validation depends on this trusted source.
//                     Cache invalidates after 1 hour to pick up admin schedule updates.

import { getFirebaseAdmin } from './firebase-admin';

// GUID: LIB_RACE_SCHEDULE_SERVER-001-v01
// [Intent] TypeScript interface for race schedule document from Firestore.
//          Matches the structure seeded by seed-race-schedule.ts script.
// [Inbound Trigger] Used by getRaceSchedule() return type and internal caching.
// [Downstream Impact] Any changes to Firestore schema require updating this interface.
export interface RaceScheduleDoc {
  name: string;
  location: string;
  qualifyingTime: string; // UTC ISO string
  raceTime: string; // UTC ISO string
  sprintTime?: string; // UTC ISO string (sprint weekends only)
  hasSprint: boolean;
  round: number; // Race number (1-24)
  createdAt?: any; // Firestore Timestamp
  updatedAt?: any; // Firestore Timestamp
}

// GUID: LIB_RACE_SCHEDULE_SERVER-002-v01
// [Intent] In-memory cache for race schedule with timestamp for TTL enforcement.
//          Reduces Firestore reads and improves API response times.
// [Inbound Trigger] Written by getRaceSchedule() on first fetch, read on subsequent calls.
// [Downstream Impact] Cache invalidates after CACHE_TTL_MS (1 hour) to pick up admin updates.
let scheduleCache: RaceScheduleDoc[] | null = null;
let cacheTimestamp: number | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// GUID: LIB_RACE_SCHEDULE_SERVER-003-v01
// @SECURITY_FIX: GEMINI-AUDIT-052 - Fetch race schedule from Firestore (trusted source).
// [Intent] Fetch race schedule from Firestore race_schedule collection with in-memory caching.
//          Returns races sorted by round number (chronological order). Cache expires after 1 hour.
// [Inbound Trigger] Called by API routes that validate prediction deadlines or check race timing.
// [Downstream Impact] Server-side lockout enforcement and deadline validation depend on this data.
//                     If Firestore is unavailable, throws error (no fallback to prevent using stale data).
// [Security] Admin-only writable Firestore collection ensures clients cannot tamper with deadlines.
/**
 * Fetch race schedule from Firestore (server-side only).
 * Returns cached schedule if available and not expired, otherwise fetches from Firestore.
 *
 * @throws {Error} If Firestore is unavailable or collection is empty
 * @returns {Promise<RaceScheduleDoc[]>} Array of races sorted by round number
 */
export async function getRaceSchedule(): Promise<RaceScheduleDoc[]> {
  // Check cache validity
  const now = Date.now();
  if (scheduleCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return scheduleCache;
  }

  // Fetch from Firestore
  const { db } = await getFirebaseAdmin();
  const snapshot = await db.collection('race_schedule').get();

  if (snapshot.empty) {
    throw new Error('Race schedule not found in Firestore. Run seed-race-schedule.ts to populate.');
  }

  // Convert Firestore documents to RaceScheduleDoc objects
  const schedule: RaceScheduleDoc[] = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    schedule.push({
      name: data.name,
      location: data.location,
      qualifyingTime: data.qualifyingTime,
      raceTime: data.raceTime,
      sprintTime: data.sprintTime,
      hasSprint: data.hasSprint,
      round: data.round,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  });

  // Sort by round number (chronological order)
  schedule.sort((a, b) => a.round - b.round);

  // Update cache
  scheduleCache = schedule;
  cacheTimestamp = now;

  return schedule;
}

// GUID: LIB_RACE_SCHEDULE_SERVER-004-v01
// [Intent] Find a specific race by name from the cached/fetched schedule.
//          Handles name matching with flexible formatting (spaces vs hyphens).
// [Inbound Trigger] Called by API routes to lookup specific race timing for validation.
// [Downstream Impact] Used for deadline checks in /api/submit-prediction lockout enforcement.
/**
 * Find a race by name from the Firestore schedule.
 * Handles both "Australian Grand Prix" and "australian-grand-prix" formats.
 *
 * @param {string} raceName - Race name to search for
 * @returns {Promise<RaceScheduleDoc | undefined>} Race document or undefined if not found
 */
export async function getRaceByName(raceName: string): Promise<RaceScheduleDoc | undefined> {
  const schedule = await getRaceSchedule();
  const normalized = raceName.toLowerCase().replace(/\s+/g, '-');

  return schedule.find(race => {
    const raceNormalized = race.name.toLowerCase().replace(/\s+/g, '-');
    return raceNormalized === normalized || race.name === raceName;
  });
}

// GUID: LIB_RACE_SCHEDULE_SERVER-005-v01
// [Intent] Manually clear the in-memory cache to force fresh Firestore fetch.
//          Useful for admin operations that update race schedule and need immediate reflection.
// [Inbound Trigger] Called after admin updates to race_schedule collection (if needed).
// [Downstream Impact] Next getRaceSchedule() call will fetch from Firestore instead of cache.
/**
 * Clear the in-memory race schedule cache.
 * Next call to getRaceSchedule() will fetch fresh data from Firestore.
 */
export function clearScheduleCache(): void {
  scheduleCache = null;
  cacheTimestamp = null;
}
