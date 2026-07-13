// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       race_results (all), collectionGroup(predictions) via cumulative-standings,
//              users (team names), standings_adjustments
// Writes:      none — pure compute
// Errors:      none surfaced — decorative feature, every failure degrades to empty facts
// Idempotent:  yes
// Side-effects: none (module-level 10-min cache only)
// Key gotcha:  race_results docs only store the TOP 6 finishers (driver1..driver6).
//              A driver absent from lastRaceTop6 did NOT finish top 6 — we cannot say
//              where they actually finished. The prompt instructions account for this.
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_CHEEKY_BILL_CONTEXT-000-v01
// [Intent] Assembles factual banter ammunition for the Cheeky Bill AI roast: the last completed
//          race's official top-6 finishing order and the submitting team's current championship
//          position. Facts come from the cumulative-standings SSOT helpers (Golden Rule #3) so
//          Bill's digs always match what the standings page shows.
// [Inbound Trigger] Called by submit-prediction/route.ts inside the fire-and-forget WhatsApp
//          notification block, right before generateCheekyComment.
// [Downstream Impact] Output strings are interpolated into the Vertex AI prompt in
//          ai/flows/cheeky-bill.ts. Empty strings = Bill roasts without stats (graceful degrade).

import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  readStandingsAdjustments,
} from '@/lib/cumulative-standings';
import { normalizeRaceIdForComparison, generateRaceId } from '@/lib/normalize-race-id';
import { RaceSchedule, F1Drivers } from '@/lib/data';
import type { getFirebaseAdmin } from '@/lib/firebase-admin';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

export interface CheekyBillContext {
  /** e.g. "Last completed race: British Grand Prix. Official top 6: P1 Verstappen, ... P6 Alonso.
   *  Any driver not listed did not finish in the top 6." Empty string if no results yet. */
  lastRaceFacts: string;
  /** e.g. "Team \"Kwik Fitties\" is currently P7 of 22 in the championship with 143 points
   *  (leader: Iron Maidens on 210)." Empty string if team/standings unavailable. */
  standingsFacts: string;
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-001-v01
// [Intent] Module-level cache of the expensive Firestore aggregate (all results + all predictions
//          + all users). Prediction submissions cluster in the hours before qualifying, so a short
//          TTL saves hundreds of reads per burst while staying fresh enough for banter purposes.
// [Inbound Trigger] Read/written by buildCheekyBillContext on every call.
// [Downstream Impact] Worst case a roast quotes standings up to 10 minutes stale — acceptable for
//          a decorative comment; the standings page itself is unaffected.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; lastRaceFacts: string; standings: { rank: number; userId: string; teamName: string; totalPoints: number }[] } | null = null;

// GUID: LIB_CHEEKY_BILL_CONTEXT-002-v01
// [Intent] Find the most recent completed race (a race_results doc whose scheduled run time is
//          the latest) and render its official top-6 as a fact line for the prompt. Result doc
//          IDs are matched to RaceSchedule entries via normalizeRaceIdForComparison, so both
//          Title-Case and lowercase stored IDs resolve (SSOT-001 casing gotcha).
// [Inbound Trigger] Called by buildCheekyBillContext on cache miss.
// [Downstream Impact] Returns '' when no results exist (season start) — Bill roasts statless.
async function buildLastRaceFacts(db: AdminFirestore): Promise<string> {
  const snap = await db.collection('race_results').get();
  if (snap.empty) return '';

  // Map normalised schedule keys → { name, runMillis } for both GP and sprint sessions.
  const scheduleByKey = new Map<string, { label: string; runMillis: number }>();
  for (const race of RaceSchedule) {
    if (race.raceTime) {
      scheduleByKey.set(normalizeRaceIdForComparison(generateRaceId(race.name, 'gp')), {
        label: race.name,
        runMillis: new Date(race.raceTime).getTime(),
      });
    }
    if (race.hasSprint && race.sprintTime) {
      scheduleByKey.set(normalizeRaceIdForComparison(generateRaceId(race.name, 'sprint')), {
        label: `${race.name} (Sprint)`,
        runMillis: new Date(race.sprintTime).getTime(),
      });
    }
  }

  let best: { label: string; runMillis: number; top6: string[] } | null = null;
  snap.forEach((doc) => {
    const sched = scheduleByKey.get(normalizeRaceIdForComparison(doc.id));
    if (!sched) return; // result doc for a race not in the schedule — skip, never throw
    if (best && sched.runMillis <= best.runMillis) return;
    const data = doc.data();
    const top6 = [data.driver1, data.driver2, data.driver3, data.driver4, data.driver5, data.driver6]
      .map((id: string) => F1Drivers.find((d) => d.id === id)?.name || id)
      .filter(Boolean);
    best = { label: sched.label, runMillis: sched.runMillis, top6 };
  });

  if (!best) return '';
  const { label, top6 } = best as { label: string; runMillis: number; top6: string[] };
  const order = top6.map((name, i) => `P${i + 1} ${name}`).join(', ');
  return `Last completed race: ${label}. Official top 6: ${order}. Any driver NOT listed there failed to finish in the top 6 of that race.`;
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-003-v01
// [Intent] Build the full banter context for one submitting team: last-race facts (cached) plus
//          that team's championship rank/points line. Never throws — this feeds a decorative
//          WhatsApp one-liner and must not disturb the submission path (matches the established
//          non-fatal console.error convention of API_SUBMIT_PREDICTION-009).
// [Inbound Trigger] submit-prediction/route.ts fire-and-forget WhatsApp block, per submission.
// [Downstream Impact] Both fields may be '' — generateCheekyComment handles missing facts by
//          roasting the picks alone.
export async function buildCheekyBillContext(db: AdminFirestore, teamId: string): Promise<CheekyBillContext> {
  try {
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
      const [lastRaceFacts, { scores }, adjustments, names] = await Promise.all([
        buildLastRaceFacts(db),
        computeRaceScores(db),
        readStandingsAdjustments(db),
        buildTeamNamesMap(db),
      ]);
      const standings = aggregateStandings([...scores, ...adjustments], names);
      cache = { at: Date.now(), lastRaceFacts, standings };
    }

    let standingsFacts = '';
    const mine = cache.standings.find((s) => s.userId === teamId);
    if (mine) {
      const leader = cache.standings[0];
      const leaderNote = leader && leader.userId !== teamId ? ` (leader: ${leader.teamName} on ${leader.totalPoints})` : ' — they are leading the championship';
      standingsFacts = `This team is currently P${mine.rank} of ${cache.standings.length} in the fantasy championship with ${mine.totalPoints} points${leaderNote}.`;
    }

    return { lastRaceFacts: cache.lastRaceFacts, standingsFacts };
  } catch (err: any) {
    // Decorative path — degrade to statless roast, never block or bubble up.
    console.error('[cheeky-bill-context] Failed to build banter context (non-fatal):', err?.message || err);
    return { lastRaceFacts: '', standingsFacts: '' };
  }
}
