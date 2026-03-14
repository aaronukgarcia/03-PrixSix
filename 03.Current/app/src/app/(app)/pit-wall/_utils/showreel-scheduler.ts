// GUID: SHOWREEL_SCHEDULER-000-v01
// [Intent] Pure utility functions for scheduling the Pre-Race Showreel.
//          Determines which historical sessions to play, how to compress them,
//          and assigns wall-clock windows so replay completes 5 min before race start.
// [Inbound Trigger] Called by usePreRaceMode when a race is within the showreel window.
// [Downstream Impact] Drives the full showreel queue — all replay timing derives from these outputs.

import type {
  HistoricalSession,
  ShowreelSchedule,
  ShowreelQueueItem,
} from '../_types/showreel.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUTOFF_BUFFER_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const MAX_SHOWREEL_ITEMS = 3;
const MIN_COMPRESSION_FACTOR = 0.1; // don't play slower than 10x real time
const MAX_COMPRESSION_FACTOR = 10;  // don't play faster than 10x real time

// ---------------------------------------------------------------------------
// 1. buildShowreelSchedule
// ---------------------------------------------------------------------------

// GUID: SHOWREEL_SCHEDULER-001-v01
// [Intent] Build a complete showreel schedule from available historical sessions,
//          fitting within the window between now and 5 minutes before the next race.
//          Selects 1–3 sessions (Race and Sprint only), compresses them proportionally
//          to fill the available slot, and assigns wall-clock start/end times.
// [Inbound Trigger] Called by usePreRaceMode when mode transitions to SHOWREEL_QUEUED.
// [Downstream Impact] Returns the ShowreelSchedule that drives all replay playback.
export function buildShowreelSchedule(
  historicalSessions: HistoricalSession[],
  nextRaceStart: Date,
  nextRaceName: string,
  now?: Date,
): ShowreelSchedule | null {
  const effectiveNow = now ?? new Date();
  const cutoffTime = new Date(nextRaceStart.getTime() - CUTOFF_BUFFER_MS);

  // No time left for a showreel
  if (cutoffTime.getTime() <= effectiveNow.getTime()) {
    return null;
  }

  const totalSlotSeconds =
    (cutoffTime.getTime() - effectiveNow.getTime()) / 1000;

  // Filter to Race and Sprint sessions only, then sort longest first
  const eligible = historicalSessions
    .filter(
      (s) => s.sessionType === 'Race' || s.sessionType === 'Sprint',
    )
    .sort((a, b) => b.durationSeconds - a.durationSeconds);

  if (eligible.length === 0) {
    return null;
  }

  // Greedy selection: pick up to MAX_SHOWREEL_ITEMS sessions whose combined
  // real-time duration can be meaningfully compressed into the available slot.
  // Strategy:
  //   - Start with the longest available session.
  //   - Keep adding sessions (longest-first) until we have MAX_SHOWREEL_ITEMS
  //     or run out of candidates.
  //   - We always pick at least 1 session regardless of duration ratio —
  //     the compression factor handles any speed adjustment.
  const selected: HistoricalSession[] = [];

  for (const session of eligible) {
    if (selected.length >= MAX_SHOWREEL_ITEMS) break;

    // Avoid repeating the same session key
    if (selected.some((s) => s.sessionKey === session.sessionKey)) continue;

    selected.push(session);
  }

  if (selected.length === 0) {
    return null;
  }

  // Total real-time duration of selected sessions
  const totalRealSeconds = selected.reduce(
    (acc, s) => acc + s.durationSeconds,
    0,
  );

  // Uniform compression factor: how many real seconds map to one slot second.
  // If totalRealSeconds < totalSlotSeconds the playback is slower than real time
  // (factor < 1). Cap at a sensible range so we never play absurdly fast/slow.
  const rawCompression = totalRealSeconds / totalSlotSeconds;
  const compressionFactor = Math.min(
    MAX_COMPRESSION_FACTOR,
    Math.max(MIN_COMPRESSION_FACTOR, rawCompression),
  );

  // Distribute wall-clock slots proportionally by each session's real duration
  const items: ShowreelQueueItem[] = [];
  let cursor = effectiveNow.getTime();

  for (const session of selected) {
    // Proportional share of the total slot
    const proportion = session.durationSeconds / totalRealSeconds;
    const slotSeconds = totalSlotSeconds * proportion;
    const slotMs = slotSeconds * 1000;

    const wallClockStart = new Date(cursor);
    const wallClockEnd = new Date(cursor + slotMs);

    // Per-item compression factor (identical to global when distribution is
    // proportional, but expressed per-item for type correctness)
    const itemCompression = session.durationSeconds / slotSeconds;

    items.push({
      session,
      compressionFactor: Math.min(
        MAX_COMPRESSION_FACTOR,
        Math.max(MIN_COMPRESSION_FACTOR, itemCompression),
      ),
      wallClockStart,
      wallClockEnd,
    });

    cursor += slotMs;
  }

  return {
    nextRaceName,
    nextRaceStart,
    cutoffTime,
    totalSlotSeconds,
    items,
    builtAt: effectiveNow,
  };
}

// ---------------------------------------------------------------------------
// 2. validateScheduleTiming
// ---------------------------------------------------------------------------

// GUID: SHOWREEL_SCHEDULER-002-v01
// [Intent] Validate that a previously-built ShowreelSchedule is still temporally
//          consistent given the current wall-clock time. Detects schedules that
//          have already expired or whose final item overruns the cutoff window.
// [Inbound Trigger] Called by usePreRaceMode before starting or resuming playback
//                   to guard against stale schedules (e.g. after a tab sleep).
// [Downstream Impact] If invalid, usePreRaceMode should rebuild the schedule or
//                     transition to COUNTDOWN if the cutoff has already passed.
export function validateScheduleTiming(
  schedule: ShowreelSchedule,
  now: Date,
): { valid: boolean; reason?: string } {
  // Race must not have started yet
  if (now.getTime() >= schedule.nextRaceStart.getTime()) {
    return {
      valid: false,
      reason: 'Race has already started — schedule is expired.',
    };
  }

  // Current time must be before the cutoff
  if (now.getTime() >= schedule.cutoffTime.getTime()) {
    return {
      valid: false,
      reason:
        'Cutoff time has passed — transition to COUNTDOWN instead of playing showreel.',
    };
  }

  // Every item must end at or before the cutoff
  for (const item of schedule.items) {
    if (item.wallClockEnd.getTime() > schedule.cutoffTime.getTime()) {
      return {
        valid: false,
        reason: `Item "${item.session.meetingName} – ${item.session.sessionName}" overruns the cutoff time.`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// 3. findMatchingHistoricalSession
// ---------------------------------------------------------------------------

// GUID: SHOWREEL_SCHEDULER-003-v01
// [Intent] Return the best matching historical session for a given session type,
//          preferring a session from the same circuit when a circuitKey is provided.
//          Falls back to any session of the requested type if no circuit match exists.
// [Inbound Trigger] Called by usePreRaceMode or on-demand race selector to look up
//                   a suitable historical replay for the next real race's circuit.
// [Downstream Impact] Determines which race telemetry is fetched from the
//                     historical-replay API and fed into useHistoricalReplay.
export function findMatchingHistoricalSession(
  sessions: HistoricalSession[],
  sessionType: 'Race' | 'Sprint',
  preferredCircuitKey?: number,
): HistoricalSession | null {
  const candidates = sessions.filter((s) => s.sessionType === sessionType);

  if (candidates.length === 0) {
    return null;
  }

  // Prefer exact circuit match
  if (preferredCircuitKey !== undefined) {
    const circuitMatch = candidates.find(
      (s) => s.circuitKey === preferredCircuitKey,
    );
    if (circuitMatch) {
      return circuitMatch;
    }
  }

  // Fall back to the first (or longest, since callers may pre-sort) candidate
  return candidates[0];
}
