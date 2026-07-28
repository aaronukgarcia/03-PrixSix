// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure compute over caller-supplied score rows + static RaceSchedule)
// Writes:      nothing
// Errors:      none — every export is total; empty input yields an empty Map
// Idempotent:  yes
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_TROPHIES-000-v01
// [Intent] FEAT-TROPHY-002 — the single source of truth for "which podium finishes has each team
//          earned". Extracted from the standings page's useMemo (FEAT-TROPHY-001, v3.19.0) so the
//          Standings trophy strip and the Teams trophy cabinet cannot disagree about who won what.
// [Inbound Trigger] Standings page (strip, limited to the selected weekend) and Teams page (cabinet,
//          whole season). Both feed it the same ScoreData rows /api/standings already returns.
// [Downstream Impact] Changing the tie rule or the zero-point rule here changes both pages at once,
//          which is the point. Ranking itself is delegated to assignCompetitionPlaces in lib/podium.
//
// GR#15: session order and membership derive from RaceSchedule and from the raceIds actually present
// in the data. Nothing here hardcodes a race count or a season length.

import { RaceSchedule } from '@/lib/data';
import { generateRaceId, normalizeRaceIdForComparison } from '@/lib/normalize-race-id';
import { assignCompetitionPlaces, type PodiumPlace } from '@/lib/podium';

/** Synthetic rows that ride through the scores array but are not races. Ranking them would invent
 *  a Grand Prix out of a late-joiner adjustment. */
export const NON_RACE_SCORE_IDS = new Set(['late-joiner-penalty', 'late-joiner-handicap']);

export interface TrophySession {
  /** Normalised lowercase id — matches ScoreData.raceId. */
  key: string;
  /** Title-Case id for URLs, e.g. "Belgian-Grand-Prix-GP". Never derived by string-munging `key`. */
  urlRaceId: string;
  /** Short circuit label for tooltips, e.g. "Spa" or "Silverstone Sprint". */
  label: string;
  /** RaceSchedule.location — the key into the trophy artwork table. */
  location: string;
  raceName: string;
  isSprint: boolean;
}

export interface Trophy {
  place: PodiumPlace;
  urlRaceId: string;
  label: string;
  location: string;
  raceName: string;
  isSprint: boolean;
  /** Points the team scored in that session — shown under the large tile, and the hot link back. */
  points: number;
}

export interface TrophyScoreRow {
  userId: string;
  raceId: string;
  totalPoints: number;
}

// GUID: LIB_TROPHIES-001-v01
// [Intent] Every scored session in season order — sprint before GP within a weekend — restricted to
//          the raceIds that actually carry scores. Callers narrow the input set to control scope:
//          the Teams cabinet passes everything, the Standings strip passes only sessions up to the
//          weekend being viewed (the standings table is a time machine; an earlier round must not
//          show trophies won later).
// [Inbound Trigger] computeTrophies callers.
// [Downstream Impact] Order here IS the left-to-right order of a team's trophies.
export function buildSeasonSessions(raceIdsWithScores: Set<string>): TrophySession[] {
  const sessions: TrophySession[] = [];
  RaceSchedule.forEach(race => {
    // "Spa-Francorchamps" -> "Spa"; every other location is already short.
    const circuit = race.location ? String(race.location).split('-')[0] : race.name;
    if (race.hasSprint) {
      const urlRaceId = generateRaceId(race.name, 'sprint');
      const key = normalizeRaceIdForComparison(urlRaceId);
      if (raceIdsWithScores.has(key)) {
        sessions.push({ key, urlRaceId, label: `${circuit} Sprint`, location: race.location, raceName: race.name, isSprint: true });
      }
    }
    const gpUrlRaceId = generateRaceId(race.name, 'gp');
    const gpKey = normalizeRaceIdForComparison(gpUrlRaceId);
    if (raceIdsWithScores.has(gpKey)) {
      sessions.push({ key: gpKey, urlRaceId: gpUrlRaceId, label: circuit, location: race.location, raceName: race.name, isSprint: false });
    }
  });
  return sessions;
}

// GUID: LIB_TROPHIES-002-v01
// [Intent] Award podium trophies per session and collect them per team, oldest first.
// [Inbound Trigger] Standings strip and Teams cabinet.
// [Downstream Impact] Two rules are load-bearing and were explicit product decisions:
//          - ZERO-POINT SESSIONS AWARD NOTHING, and a team on 0 never receives a trophy even if that
//            placed it third (Aaron, 2026-07-27). Without this a round nobody scored in would still
//            crown a "winner".
//          - TIES share the place and SKIP the next, via assignCompetitionPlaces — the same rule the
//            standings and results tables already use, so a shared gold means no silver is awarded.
export function computeTrophies(scores: TrophyScoreRow[], sessions: TrophySession[]): Map<string, Trophy[]> {
  const byTeam = new Map<string, Trophy[]>();
  if (sessions.length === 0) return byTeam;

  const sessionByKey = new Map(sessions.map(s => [s.key, s]));
  const bucketed = new Map<string, { userId: string; totalPoints: number }[]>();
  scores.forEach(score => {
    if (NON_RACE_SCORE_IDS.has(score.raceId)) return;
    if (!sessionByKey.has(score.raceId)) return;
    const bucket = bucketed.get(score.raceId) ?? [];
    bucket.push({ userId: score.userId, totalPoints: score.totalPoints });
    bucketed.set(score.raceId, bucket);
  });

  // Walk sessions (not the bucket map) so the output is in season order for every team.
  sessions.forEach(session => {
    const entries = bucketed.get(session.key);
    if (!entries || entries.length === 0) return;
    assignCompetitionPlaces(entries).forEach(entry => {
      if (entry.place > 3) return;
      if (entry.totalPoints <= 0) return;
      const list = byTeam.get(entry.userId) ?? [];
      list.push({
        place: entry.place as PodiumPlace,
        urlRaceId: session.urlRaceId,
        label: session.label,
        location: session.location,
        raceName: session.raceName,
        isSprint: session.isSprint,
        points: entry.totalPoints,
      });
      byTeam.set(entry.userId, list);
    });
  });

  return byTeam;
}

// GUID: LIB_TROPHIES-003-v01
// [Intent] Convenience for callers that just want "this team's whole season", e.g. the Teams page,
//          which holds raw scores and no notion of a selected weekend.
// [Inbound Trigger] Teams page trophy cabinet.
// [Downstream Impact] Equivalent to buildSeasonSessions over every raceId present in the data.
export function computeAllTrophies(scores: TrophyScoreRow[]): Map<string, Trophy[]> {
  const ids = new Set<string>();
  scores.forEach(s => { if (!NON_RACE_SCORE_IDS.has(s.raceId)) ids.add(s.raceId); });
  return computeTrophies(scores, buildSeasonSessions(ids));
}

// GUID: LIB_TROPHIES-004-v01
// [Intent] Stable DOM id for one trophy, so the Results page podium badge can deep-link straight to
//          the matching large trophy on the Teams page and highlight it.
// [Inbound Trigger] Teams cabinet (element id) and Results badge (link fragment).
// [Downstream Impact] Must stay in sync on both sides; that is why it lives here rather than being
//          formatted inline at either call site.
export function trophyAnchorId(urlRaceId: string): string {
  return `trophy-${urlRaceId.toLowerCase()}`;
}
