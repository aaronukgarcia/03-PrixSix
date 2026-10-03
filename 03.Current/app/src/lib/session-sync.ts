// GUID: LIB_SESSION_SYNC-000-v01
// [Intent] Pure planning logic for the daily OpenF1 → race_schedule session-time sync.
//          Split out of the cron route so the matching can be dry-run against live OpenF1 data
//          without touching Firestore.
// [Inbound Trigger] Called by /api/cron/sync-session-times (POST) once per run.
// [Downstream Impact] The plan it returns is batch-written to race_schedule, which drives the
//                     pit lane deadline (/api/submit-prediction) and the scoring cutoff
//                     (/api/calculate-scores). A wrong match here moves a real deadline.
//
// @BUGFIX (v3.25.4, BUG-SCHED-SYNC-001): the previous matcher keyed on `session.meeting_name`,
//   a field OpenF1's /v1/sessions endpoint does not return (it exists only on /v1/meetings).
//   Every session was skipped and the route answered 200 "updated: 0" — the sync never wrote a
//   value from the day it shipped (v2.0.42, 2026-03-13). The Bahrain GP at Sepang kept its
//   provisional 07:00Z qualifying time and the pit lane closed an hour early on 2026-10-03.
//   Names are not a safe key anyway: OpenF1 says "Mexico City Grand Prix" / "São Paulo Grand
//   Prix" / "Barcelona Grand Prix", calls the Madrid race "Spanish Grand Prix" (our Barcelona
//   doc's name), and lists "Bahrain Grand Prix" twice. Meetings are now matched by race weekend.

// GUID: LIB_SESSION_SYNC-001-v01
// [Intent] Shape of an OpenF1 /v1/sessions row — only the fields the sync reads.
// [Inbound Trigger] Used when parsing the OpenF1 response in the cron route.
// [Downstream Impact] Field renames in OpenF1 surface as unmatched meetings (loud), not silence.
export interface OpenF1Session {
  session_key: number;
  meeting_key: number;
  session_name: string; // "Practice 1/2/3", "Sprint Qualifying", "Sprint", "Qualifying", "Race"
  date_start: string;   // ISO, e.g. "2026-10-03T08:00:00+00:00"
  date_end?: string;
  location?: string;
  country_name?: string;
  is_cancelled?: boolean;
}

// GUID: LIB_SESSION_SYNC-002-v01
// [Intent] The slice of a race_schedule document the planner needs.
// [Inbound Trigger] Built by the cron route from the race_schedule snapshot.
// [Downstream Impact] `id` is the stable document id — see BUG-WA-SCHED-001 for why round is not.
export interface ScheduleDocTimes {
  id: string;
  name: string;
  raceTime?: string;
  qualifyingTime?: string;
  sprintTime?: string;
  raceEndTime?: string;
}

export type SessionTimeField = 'qualifyingTime' | 'sprintTime' | 'raceTime' | 'raceEndTime';

export interface SessionSyncPlan {
  /** Docs whose stored times differ from OpenF1 — only the differing fields are listed. */
  updates: { id: string; name: string; fields: Partial<Record<SessionTimeField, string>> }[];
  /** Upcoming OpenF1 race meetings that mapped to no (or more than one) race_schedule doc. */
  unmatched: { meetingKey: number; location: string; raceStart: string; candidates: string[] }[];
  /** Upcoming OpenF1 race meetings considered this run. */
  meetingsConsidered: number;
  /** Meetings that mapped to exactly one doc (changed or not). */
  meetingsMatched: number;
}

// A race weekend is matched to the doc whose stored raceTime is within this distance of the
// OpenF1 Race start. Rounds are never closer than 7 days, so 3 days cannot straddle two races
// yet still absorbs a provisional time that is a full day out (Las Vegas was stored 22h early).
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// A meeting stays in scope until its Race is this far in the past, so a wrong qualifyingTime
// (the scoring cutoff) is still corrected on race morning, after qualifying has already run.
const RACE_GRACE_MS = 60 * 60 * 1000;

// GUID: LIB_SESSION_SYNC-003-v01
// [Intent] Normalise any parseable timestamp to the "2026-10-03T08:00:00Z" form the seeded
//          race_schedule docs and data.ts use, so a sync write is byte-comparable with them.
// [Inbound Trigger] Called for every field the planner emits.
// [Downstream Impact] Readers all go through new Date(), so the format is cosmetic but stable.
function toScheduleIso(value: string): string {
  return new Date(value).toISOString().replace('.000Z', 'Z');
}

function sameInstant(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const ta = new Date(a).getTime();
  return !Number.isNaN(ta) && ta === new Date(b).getTime();
}

// GUID: LIB_SESSION_SYNC-004-v01
// [Intent] Turn OpenF1 sessions + current race_schedule docs into a write plan:
//          group sessions by meeting_key, keep meetings whose Race has not finished, match each
//          to exactly one doc by race weekend, and list the fields that differ.
//          Sprint weekends are detected from the meeting's own sessions (a "Sprint Qualifying"
//          session exists) — on those, Sprint Qualifying is the picks deadline, not Qualifying.
// [Inbound Trigger] Cron route, once per run. Pure — no I/O, `now` is injected.
// [Downstream Impact] `unmatched` non-empty must be treated as a FAILURE by the caller: that is
//                     the signal that was missing for seven months.
export function planSessionSync(
  sessions: OpenF1Session[],
  docs: ScheduleDocTimes[],
  now: number,
): SessionSyncPlan {
  const byMeeting = new Map<number, OpenF1Session[]>();
  for (const s of sessions) {
    if (!s || s.is_cancelled || typeof s.meeting_key !== 'number' || !s.date_start) continue;
    if (Number.isNaN(new Date(s.date_start).getTime())) continue;
    const list = byMeeting.get(s.meeting_key);
    if (list) list.push(s); else byMeeting.set(s.meeting_key, [s]);
  }

  const plan: SessionSyncPlan = { updates: [], unmatched: [], meetingsConsidered: 0, meetingsMatched: 0 };

  for (const [meetingKey, meetingSessions] of byMeeting) {
    const find = (name: string) => meetingSessions.find(s => s.session_name === name);
    const race = find('Race');
    if (!race) continue; // testing, or a meeting whose race was cancelled

    const raceStartMs = new Date(race.date_start).getTime();
    if (raceStartMs < now - RACE_GRACE_MS) continue; // weekend is over

    plan.meetingsConsidered++;

    const candidates = docs.filter(d => {
      const t = d.raceTime ? new Date(d.raceTime).getTime() : NaN;
      return !Number.isNaN(t) && Math.abs(t - raceStartMs) <= MATCH_WINDOW_MS;
    });

    if (candidates.length !== 1) {
      plan.unmatched.push({
        meetingKey,
        location: race.location ?? race.country_name ?? 'unknown',
        raceStart: toScheduleIso(race.date_start),
        candidates: candidates.map(c => c.id),
      });
      continue;
    }

    plan.meetingsMatched++;
    const doc = candidates[0];
    const deadline = find('Sprint Qualifying') ?? find('Qualifying');
    const sprint = find('Sprint');

    const wanted: Partial<Record<SessionTimeField, string>> = {
      raceTime: toScheduleIso(race.date_start),
    };
    if (race.date_end && !Number.isNaN(new Date(race.date_end).getTime())) {
      wanted.raceEndTime = toScheduleIso(race.date_end);
    }
    if (deadline) wanted.qualifyingTime = toScheduleIso(deadline.date_start);
    if (sprint) wanted.sprintTime = toScheduleIso(sprint.date_start);

    const fields: Partial<Record<SessionTimeField, string>> = {};
    for (const key of Object.keys(wanted) as SessionTimeField[]) {
      const value = wanted[key]!;
      if (!sameInstant(doc[key], value)) fields[key] = value;
    }

    if (Object.keys(fields).length > 0) {
      plan.updates.push({ id: doc.id, name: doc.name, fields });
    }
  }

  return plan;
}
