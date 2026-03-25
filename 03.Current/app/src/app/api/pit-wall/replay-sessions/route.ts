// GUID: API_REPLAY_SESSIONS-000-v03
// [Intent] Returns the list of GPS replay sessions — merges Firestore replay_sessions
//          (pre-ingested, ready to play) with completed Race + Sprint sessions derived
//          from the static RaceSchedule. Authenticated users only (any signed-in user).
//          v02: FEAT-PW-004 — query OpenF1 for all completed 2026 Race/Sprint sessions
//               and merge with Firestore docs. Non-ingested sessions have available=false.
//          v03: FIX — replaced unreliable OpenF1 session query with static RaceSchedule.
//               OpenF1 session_type=Sprint returns 404 and the Race query is fragile from
//               server-side (timeouts, auth issues). The static schedule is authoritative,
//               always available, and already contains sprint flags. Sessions are keyed by
//               a synthetic sessionKey (hash of name+type) when no Firestore doc exists.
//               Sorted by dateStart descending (most recent first).
// [Inbound Trigger] Called by PitWallClient on entering replay mode to populate session picker.
// [Downstream Impact] Returns ReplaySessionMetadata[] for useReplayPlayer.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { RaceSchedule } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GUID: API_REPLAY_SESSIONS-005-v01
// [Intent] Build a list of completed Race and Sprint sessions from the static RaceSchedule.
//          A session is "completed" if its dateStart (raceTime or sprintTime) is in the past.
//          Returns objects shaped for merge with Firestore replay_sessions.
//          Uses a deterministic synthetic sessionKey derived from race name + session type
//          so that Firestore docs (which use the real OpenF1 session_key) take priority
//          during the merge step.
function getCompletedScheduleSessions(): Array<{
  syntheticKey: number;
  sessionName: string;
  meetingName: string;
  dateStart: string;
}> {
  const now = new Date();
  const results: Array<{
    syntheticKey: number;
    sessionName: string;
    meetingName: string;
    dateStart: string;
  }> = [];

  for (const race of RaceSchedule) {
    // Main race
    if (new Date(race.raceTime) < now) {
      results.push({
        syntheticKey: hashStringToNumber(`${race.name}::Race`),
        sessionName: 'Race',
        meetingName: race.name,
        dateStart: race.raceTime,
      });
    }

    // Sprint (only for sprint weekends)
    if (race.hasSprint && race.sprintTime && new Date(race.sprintTime) < now) {
      results.push({
        syntheticKey: hashStringToNumber(`${race.name}::Sprint`),
        sessionName: 'Sprint',
        meetingName: race.name,
        dateStart: race.sprintTime,
      });
    }
  }

  return results;
}

// GUID: API_REPLAY_SESSIONS-006-v01
// [Intent] Deterministic hash of a string to a positive integer, used as a synthetic
//          sessionKey for schedule-derived sessions that don't have a Firestore doc.
//          Negative range avoided (sessionKey is typed as number in the client).
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// GUID: API_REPLAY_SESSIONS-001-v03
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  getFirebaseAdmin();

  const authResult = await verifyAuthToken(req.headers.get('Authorization'));
  if (!authResult) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();

    // Fetch Firestore replay_sessions (ingested, ready to play)
    const snapshot = await db.collection('replay_sessions')
      .where('status', '==', 'available')
      .orderBy('dateStart', 'desc')
      .limit(50)
      .get();

    // Build a map of Firestore sessions keyed by sessionKey for fast lookup
    const sessionMap = new Map<number, any>();
    // Also build a set of meetingName+sessionName for dedup against schedule entries
    const firestoreNameSet = new Set<string>();

    for (const doc of snapshot.docs) {
      const d = doc.data();
      sessionMap.set(d.sessionKey, {
        sessionKey:         d.sessionKey,
        sessionName:        d.sessionName,
        meetingName:        d.meetingName,
        circuitKey:         d.circuitKey,
        year:               d.year,
        dateStart:          d.dateStart,
        durationMs:         d.durationMs,
        totalDrivers:       d.totalDrivers,
        totalFrames:        d.totalFrames,
        downloadUrl:        d.downloadUrl,
        fileSizeBytesGzip:  d.fileSizeBytesGzip,
        fileSizeBytesRaw:   d.fileSizeBytesRaw,
        samplingIntervalMs: d.samplingIntervalMs,
        firestoreStatus:    d.firestoreStatus ?? 'none',
        totalChunks:        d.firestoreChunkCount ?? 0,
        available:          true,
      });
      // Normalise for matching: lowercase meetingName + sessionName
      firestoreNameSet.add(`${(d.meetingName ?? '').toLowerCase()}::${(d.sessionName ?? '').toLowerCase()}`);
    }

    // Merge completed schedule sessions — add any that don't already exist in Firestore.
    // Firestore docs use real OpenF1 session_keys so we can't match by key alone.
    // Instead, match by normalised meetingName + sessionName to avoid duplicates.
    const scheduleSessions = getCompletedScheduleSessions();
    for (const s of scheduleSessions) {
      const nameKey = `${s.meetingName.toLowerCase()}::${s.sessionName.toLowerCase()}`;
      if (!firestoreNameSet.has(nameKey)) {
        sessionMap.set(s.syntheticKey, {
          sessionKey:         s.syntheticKey,
          sessionName:        s.sessionName,
          meetingName:        s.meetingName,
          circuitKey:         0,
          year:               2026,
          dateStart:          s.dateStart,
          durationMs:         0,
          totalDrivers:       0,
          totalFrames:        0,
          downloadUrl:        '',
          fileSizeBytesGzip:  0,
          fileSizeBytesRaw:   0,
          samplingIntervalMs: 0,
          firestoreStatus:    'none',
          totalChunks:        0,
          available:          false,
        });
      }
    }

    // Sort by dateStart descending (most recent first)
    const sessions = Array.from(sessionMap.values()).sort((a, b) => {
      const dateA = a.dateStart ? new Date(a.dateStart).getTime() : 0;
      const dateB = b.dateStart ? new Date(b.dateStart).getTime() : 0;
      return dateB - dateA;
    });

    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.message,
        code:  ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
