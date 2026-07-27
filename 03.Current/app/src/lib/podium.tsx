// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure presentational + pure ranking helper)
// Writes:      nothing
// Errors:      none — every export is total; out-of-range places render null
// Idempotent:  yes (pure functions / pure components)
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_PODIUM-000-v01
// [Intent] Single source of truth for podium (1st/2nd/3rd) presentation and for the
//          competition-ranking tie rule. Created for FEAT-TROPHY-001 (v3.19.0), which needed a
//          third copy of the gold-trophy/silver-medal/bronze-medal renderer — `RankBadge` in
//          standings/page.tsx and `RaceRankBadge` in results-utils.tsx were already byte-identical
//          duplicates of each other (GR#3). Both now delegate here.
// [Inbound Trigger] Standings page (rank badge + trophy strip), results page (race rank badge).
// [Downstream Impact] Changing a colour or icon here changes every podium indicator in the app.

import { Badge } from "@/components/ui/badge";
import { Trophy, Medal } from "lucide-react";

export type PodiumPlace = 1 | 2 | 3;

// GUID: LIB_PODIUM-001-v01
// [Intent] The palette and iconography for each podium place, in one table so the badge and the
//          bare icon cannot drift apart. Light/dark pairs match the pre-existing badge styling
//          exactly — this was lifted verbatim from the two duplicate components it replaces.
// [Inbound Trigger] PodiumBadge and PodiumIcon.
// [Downstream Impact] Single edit point for podium colours across standings and results.
const PODIUM_STYLES: Record<PodiumPlace, { label: string; badge: string; icon: string; Icon: typeof Trophy }> = {
  1: {
    label: '1st',
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700',
    icon: 'text-yellow-500 dark:text-yellow-400',
    Icon: Trophy,
  },
  2: {
    label: '2nd',
    badge: 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
    icon: 'text-gray-400 dark:text-gray-300',
    Icon: Medal,
  },
  3: {
    label: '3rd',
    badge: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700',
    icon: 'text-orange-500 dark:text-orange-400',
    Icon: Medal,
  },
};

// GUID: LIB_PODIUM-002-v01
// [Intent] Ordinal label for a podium place ("1st"/"2nd"/"3rd") — used in tooltip text so the
//          wording cannot drift from the badge wording.
// [Inbound Trigger] Standings trophy tooltips.
// [Downstream Impact] None beyond label text.
export function podiumLabel(place: PodiumPlace): string {
  return PODIUM_STYLES[place].label;
}

// GUID: LIB_PODIUM-003-v01
// [Intent] Podium badge with icon + ordinal, for ranks 1-3; null for anything else. Replaces the
//          former RankBadge (standings) and RaceRankBadge (results-utils) duplicates.
// [Inbound Trigger] Standings table team-name cell; results table team rows.
// [Downstream Impact] Pure presentational — no side effects.
export const PodiumBadge = ({ rank }: { rank: number }) => {
  const style = PODIUM_STYLES[rank as PodiumPlace];
  if (!style) return null;
  const { Icon } = style;
  return (
    <Badge variant="outline" className={`ml-2 px-1.5 py-0 text-[10px] ${style.badge}`}>
      <Icon className="h-3 w-3 mr-0.5" />
      {style.label}
    </Badge>
  );
};

// GUID: LIB_PODIUM-004-v01
// [Intent] Bare podium icon sized to the surrounding text's cap height (1em, i.e. the height of a
//          capital M) so a long strip of them sits inline with the team name and stays correct if
//          the table font size ever changes. Deliberately NOT a Badge — a strip of badges would be
//          far too wide once a team has a dozen trophies.
// [Inbound Trigger] Standings trophy strip (FEAT-TROPHY-001).
// [Downstream Impact] Pure presentational — no side effects.
export const PodiumIcon = ({ place }: { place: PodiumPlace }) => {
  const style = PODIUM_STYLES[place];
  const { Icon } = style;
  return <Icon className={`h-[1em] w-[1em] shrink-0 ${style.icon}`} aria-hidden="true" />;
};

// GUID: LIB_PODIUM-005-v01
// [Intent] Competition ranking (1-1-3): sort descending by points, teams on equal points share a
//          place, and the next place is SKIPPED. This is the convention already used by
//          cumulative-standings.ts:308-316, standings/page.tsx and results/page.tsx — extracted here
//          so the trophy calculation provably matches the tables rather than re-deriving it.
// [Inbound Trigger] Standings trophy calculation, per race.
// [Downstream Impact] Returns entries in descending points order, each with its place. Callers that
//          only want the podium filter on `place <= 3`. Zero/negative scores are NOT special-cased
//          here — the caller decides (the trophy strip excludes them; see PAGE_STANDINGS-034).
export function assignCompetitionPlaces<T extends { totalPoints: number }>(entries: T[]): (T & { place: number })[] {
  const sorted = [...entries].sort((a, b) => b.totalPoints - a.totalPoints);
  let place = 1;
  let previousPoints = Number.NaN;
  return sorted.map((entry, index) => {
    if (entry.totalPoints !== previousPoints) {
      place = index + 1;
      previousPoints = entry.totalPoints;
    }
    return { ...entry, place };
  });
}
