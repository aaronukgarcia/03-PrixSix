// GUID: PAGE_STANDINGS-000-v05
// [Intent] Season Standings page — displays cumulative league standings after each race weekend,
//   with race-by-race selection, season progression chart, rank change indicators, and pagination.
// [Inbound Trigger] Navigation to /standings route by authenticated user.
// [Downstream Impact] Reads from Firestore scores and users collections in real-time; navigates
//   to /results page when user clicks score cells.
// @FIX GEMINI-AUDIT (Medium): Replaced mixed-format race ID shim (legacy/gp/sprint branching) with
//   normalizeRaceIdForComparison() throughout. All raceId values stored from Firestore are normalised
//   before being stored in allScores and raceIdsWithScores. All comparisons use normalised IDs on
//   both sides. The baseRaceId field is removed from RaceWeekend — it was only used as a shim to
//   handle historical scores stored without the -GP suffix. normalizeRaceId() strips the -GP suffix,
//   so both "Australian-Grand-Prix" and "Australian-Grand-Prix-GP" normalise to the same key,
//   making the double-format check unnecessary and safe to remove.

"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFirestore, useAuth } from "@/firebase";
import { useLeague } from "@/contexts/league-context";
import { LeagueSelector } from "@/components/league/LeagueSelector";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RaceSchedule } from "@/lib/data";
import { generateRaceId, normalizeRaceIdForComparison } from "@/lib/normalize-race-id";
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus, ChevronDown, Loader2, ExternalLink, Zap, Flag, Trophy, Medal, Crown, Users, Crosshair, HelpCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { collection, collectionGroup, doc, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { calculateDriverPoints, SCORING_POINTS } from "@/lib/scoring-rules";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
// @SECURITY_FIX: GEMINI-AUDIT-058 — Import from client-safe registry (no internal metadata).
import { CLIENT_ERRORS as ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: PAGE_STANDINGS-001-v03
// [Intent] Visual indicator for rank changes between race weekends — shows arrows/chevrons based
//   on the magnitude and direction of change.
// [Inbound Trigger] Rendered per row in the standings table with the team's rankChange value.
// [Downstream Impact] Pure presentational component — no side effects.
const RankChangeIndicator = ({ change }: { change: number }) => {
  if (change === 0) {
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
  if (change > 1) {
    return <ChevronsUp className="h-4 w-4 text-green-500" />;
  }
  if (change > 0) {
    return <ArrowUp className="h-4 w-4 text-green-500" />;
  }
  if (change < -1) {
    return <ChevronsDown className="h-4 w-4 text-red-500" />;
  }
  return <ArrowDown className="h-4 w-4 text-red-500" />;
};

// GUID: PAGE_STANDINGS-002-v03
// [Intent] Badge for top-3 ranked teams — gold for 1st, silver for 2nd, bronze for 3rd.
// [Inbound Trigger] Rendered next to the team name in the standings table for ranks 1-3.
// [Downstream Impact] Pure presentational component — no side effects.
const RankBadge = ({ rank }: { rank: number }) => {
  if (rank === 1) {
    return (
      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700">
        <Trophy className="h-3 w-3 mr-0.5" />
        1st
      </Badge>
    );
  }
  if (rank === 2) {
    return (
      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600">
        <Medal className="h-3 w-3 mr-0.5" />
        2nd
      </Badge>
    );
  }
  if (rank === 3) {
    return (
      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700">
        <Medal className="h-3 w-3 mr-0.5" />
        3rd
      </Badge>
    );
  }
  return null;
};

// GUID: PAGE_STANDINGS-003-v03
// [Intent] Small "Winner" badge shown next to the team(s) that scored highest in the selected race's
//   GP or Sprint event.
// [Inbound Trigger] Rendered in the Sprint/GP score cells for teams in the raceWinners sets.
// [Downstream Impact] Pure presentational component — no side effects.
const RaceWinnerBadge = () => (
  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
    Winner
  </Badge>
);

// GUID: PAGE_STANDINGS-004-v03
// [Intent] Constant identifying the 2025 season defending champion team for special badge display.
// [Inbound Trigger] Referenced in the standings table row rendering to show champion badge.
// [Downstream Impact] If the team name changes, the badge will no longer display correctly.
const DEFENDING_CHAMPION_TEAM = "Montfleur Motor Racing";

// GUID: PAGE_STANDINGS-005-v03
// [Intent] Purple badge identifying the defending 2025 season champion in the standings table.
// [Inbound Trigger] Rendered next to the team name when teamName matches DEFENDING_CHAMPION_TEAM.
// [Downstream Impact] Pure presentational component — no side effects.
const DefendingChampionBadge = () => (
  <Badge variant="outline" className="mr-1 px-1.5 py-0 text-[9px] bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700">
    <Crown className="h-3 w-3 mr-0.5 inline" />
    2025 Champion
  </Badge>
);

// GUID: PAGE_STANDINGS-006-v03
// [Intent] Type for raw score documents fetched from Firestore scores collection.
// [Inbound Trigger] Used to type the allScores state array.
// [Downstream Impact] Consumed by standings calculation and chart data memos.
interface ScoreData {
  oduserId?: string;
  userId: string;
  raceId: string;
  totalPoints: number;
}

// GUID: PAGE_STANDINGS-007-v03
// [Intent] Type for a single row in the computed standings table.
// [Inbound Trigger] Produced by the standings useMemo and consumed by the table rendering.
// [Downstream Impact] Drives the standings table rows, chart team filtering, and race winner calculation.
interface StandingEntry {
  rank: number;
  userId: string;
  teamName: string;
  oldOverall: number;
  sprintPoints: number | null; // null if race doesn't have sprint
  gpPoints: number;
  newOverall: number;
  gap: number;
  rankChange: number;
}

// GUID: PAGE_STANDINGS-008-v04
// [Intent] Type for a completed race weekend — tracks sprint and GP race IDs (Title-Case, used for
//   navigation) along with completion flags. baseRaceId removed — was only needed as a shim for
//   legacy scores; normaliseRaceIdForComparison() now handles both formats transparently.
// [Inbound Trigger] Built from RaceSchedule cross-referenced with normalised score raceIds in Firestore.
// [Downstream Impact] Drives race weekend tab rendering and standings calculation logic. gpRaceId and
//   sprintRaceId are Title-Case with suffix (e.g., "Australian-Grand-Prix-GP") for use as navigation
//   URL params — do not normalise these fields; call normalizeRaceIdForComparison() at comparison sites.
interface RaceWeekend {
  name: string;
  sprintRaceId: string | null; // e.g., "Chinese-Grand-Prix-Sprint" or null
  gpRaceId: string; // e.g., "Chinese-Grand-Prix-GP"
  hasSprint: boolean;
  index: number;
  hasSprintScores: boolean;
  hasGpScores: boolean;
}

// GUID: PAGE_STANDINGS-009-v03
// [Intent] Page size constant for client-side pagination of standings rows.
// [Inbound Trigger] Used by displayCount state and loadMore callback.
// [Downstream Impact] Controls how many standings rows are shown before "Load More".
const PAGE_SIZE = 25;

// GUID: PAGE_STANDINGS-010-v04
// [Intent] Main Standings page component — subscribes to scores in real-time, computes cumulative
//   standings per race weekend, renders the progression chart and sortable standings table.
//   Auto-focuses on latest race when new race results are added.
// [Inbound Trigger] React Router renders this component when user navigates to /standings.
// [Downstream Impact] Real-time Firestore listener on scores collection; reads users collection
//   for team names; navigates to /results page on score cell clicks.
export default function StandingsPage() {
  const firestore = useFirestore();
  const router = useRouter();
  const { selectedLeague } = useLeague();
  const { user } = useAuth(); // 7a3f1d2e — identify current user for chart filtering
  const [chartMode, setChartMode] = useState<'top10' | 'myPosition'>('top10'); // 7a3f1d2e — chart line filter toggle

  const [allScores, setAllScores] = useState<ScoreData[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [completedRaceWeekends, setCompletedRaceWeekends] = useState<RaceWeekend[]>([]);
  const [selectedRaceIndex, setSelectedRaceIndex] = useState<number>(-1);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  // Track previous completed race count for auto-focus on new races
  const prevCompletedCountRef = useRef<number>(0);

  // GUID: PAGE_STANDINGS-011-v08
  // @ARCH_CHANGE (SSOT-001): Eliminated scores collection. Scores are now computed in real-time
  //   from race_results + predictions on every snapshot update. No scores collection reads.
  // [Intent] Real-time subscription to the race_results collection. When race results change
  //   (new race scored or result deleted), fetches all predictions via collectionGroup and
  //   re-computes all team scores in memory using the full carry-forward resolution logic.
  //   Produces allScores with normalised raceId values — downstream memos are unchanged.
  // [Inbound Trigger] Fires on component mount and whenever race_results collection changes.
  // [Downstream Impact] Populates allScores (normalised raceId), completedRaceWeekends, userNames,
  //   and lastUpdated state. All downstream memos (standings, chartData, raceWinners) are unchanged.
  //   IMPORTANT: allScores.raceId values are normalised (lowercase, no -GP suffix). Any code comparing
  //   against them MUST also normalise the comparison key via normalizeRaceIdForComparison().
  useEffect(() => {
    if (!firestore) return;

    setIsLoading(true);

    // Subscribe to race_results collection — fires when admin submits or deletes race results
    const unsubscribe = onSnapshot(
      collection(firestore, "race_results"),
      async (raceResultsSnapshot) => {
        try {
          // Build race results map: resultDocId → top-6 array
          const raceResultsMap = new Map<string, string[]>();
          raceResultsSnapshot.forEach((resultDoc) => {
            const data = resultDoc.data();
            if (!data) return;
            raceResultsMap.set(resultDoc.id, [
              data.driver1, data.driver2, data.driver3,
              data.driver4, data.driver5, data.driver6,
            ]);
          });

          // No race results yet — empty standings
          if (raceResultsMap.size === 0) {
            setAllScores([]);
            setCompletedRaceWeekends([]);
            setUserNames(new Map());
            setLastUpdated(new Date());
            setIsLoading(false);
            return;
          }

          // Fetch all predictions across all users via collectionGroup
          const allPredictionsSnapshot = await getDocs(collectionGroup(firestore, "predictions"));

          // Build teamPredictionsByRace: teamId → normalizedRaceId → { predictions, timestamp }
          // Normalise stored raceId via normalizeRaceIdForComparison so both formats match:
          //   "Australian-Grand-Prix-GP" → "australian-grand-prix"
          //   "Australian-Grand-Prix"    → "australian-grand-prix"
          const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: Date }>>();
          allPredictionsSnapshot.forEach((predDoc) => {
            const predData = predDoc.data();
            if (!Array.isArray(predData.predictions) || predData.predictions.length !== 6) return;

            // Extract userId from path: users/{userId}/predictions/{predId}
            const pathParts = predDoc.ref.path.split('/');
            const userId = pathParts[1];
            const teamId: string = predData.teamId || userId;
            const timestamp = predData.submittedAt?.toDate?.() || predData.createdAt?.toDate?.() || new Date(0);
            const predRaceId = predData.raceId ? normalizeRaceIdForComparison(predData.raceId) : null;
            if (!predRaceId) return;

            if (!teamPredictionsByRace.has(teamId)) {
              teamPredictionsByRace.set(teamId, new Map());
            }
            const teamRaces = teamPredictionsByRace.get(teamId)!;
            const existing = teamRaces.get(predRaceId);
            if (!existing || timestamp > existing.timestamp) {
              teamRaces.set(predRaceId, { predictions: predData.predictions, timestamp });
            }
          });

          // Compute scores for each race result × each team (with carry-forward resolution)
          const scores: ScoreData[] = [];
          const raceIdsWithScores = new Set<string>();

          raceResultsMap.forEach((actualResults, resultDocId) => {
            // Normalise the result doc ID: "Australian-Grand-Prix-GP" → "australian-grand-prix"
            const normalizedResultId = normalizeRaceIdForComparison(resultDocId);

            teamPredictionsByRace.forEach((raceMap, teamId) => {
              // Carry-forward resolution — same logic as calculate-scores API:
              // 1. Race-specific prediction for this exact race
              // 2. For Sprint: fall back to GP prediction (base race ID)
              // 3. Fall back to latest prediction from any prior race
              let teamPredictions: string[] | null = null;

              if (raceMap.has(normalizedResultId)) {
                teamPredictions = raceMap.get(normalizedResultId)!.predictions;
              } else if (normalizedResultId.endsWith('-sprint')) {
                const baseRaceId = normalizedResultId.replace(/-sprint$/, '');
                if (raceMap.has(baseRaceId)) {
                  teamPredictions = raceMap.get(baseRaceId)!.predictions;
                }
              }
              if (!teamPredictions) {
                let latestTs = new Date(0);
                raceMap.forEach(({ predictions, timestamp }) => {
                  if (timestamp > latestTs) {
                    latestTs = timestamp;
                    teamPredictions = predictions;
                  }
                });
              }
              if (!teamPredictions) return;

              // Compute points using prix six hybrid rules
              let totalPoints = 0;
              let correctCount = 0;
              teamPredictions.forEach((driverId, predictedPosition) => {
                const actualPosition = actualResults.indexOf(driverId);
                totalPoints += calculateDriverPoints(predictedPosition, actualPosition);
                if (actualPosition !== -1) correctCount++;
              });
              if (correctCount === 6) totalPoints += SCORING_POINTS.bonusAll6;

              scores.push({ userId: teamId, raceId: normalizedResultId, totalPoints });
              raceIdsWithScores.add(normalizedResultId);
            });
          });

          setAllScores(scores);

          // Determine completed race weekends (races that have at least GP scores)
          const completed: RaceWeekend[] = [];
          RaceSchedule.forEach((race, index) => {
            const sprintRaceId = race.hasSprint ? generateRaceId(race.name, 'sprint') : null;
            const gpRaceId = generateRaceId(race.name, 'gp');
            const normalisedGpKey = normalizeRaceIdForComparison(gpRaceId);
            const normalisedSprintKey = sprintRaceId ? normalizeRaceIdForComparison(sprintRaceId) : null;
            const hasGpScores = raceIdsWithScores.has(normalisedGpKey);
            const hasSprintScores = normalisedSprintKey ? raceIdsWithScores.has(normalisedSprintKey) : false;

            if (hasGpScores) {
              completed.push({
                name: race.name,
                sprintRaceId: sprintRaceId || null,
                gpRaceId,
                hasSprint: race.hasSprint,
                index,
                hasSprintScores,
                hasGpScores,
              });
            }
          });

          setCompletedRaceWeekends(completed);

          // Auto-focus latest race when new races are added
          setSelectedRaceIndex(prev => {
            if (completed.length === 0) return -1;
            const prevCount = prevCompletedCountRef.current;
            const shouldAutoFocus = (prev < 0) || (completed.length > prevCount) || (prev >= completed.length);
            if (shouldAutoFocus) {
              prevCompletedCountRef.current = completed.length;
              return completed.length - 1;
            }
            return prev;
          });

          // Fetch team names for all scoring user IDs
          const userIds = new Set<string>();
          scores.forEach(s => userIds.add(s.userId));

          const names = new Map<string, string>();
          const batchSize = 10;
          const userIdArray = Array.from(userIds);

          for (let i = 0; i < userIdArray.length; i += batchSize) {
            const batch = userIdArray.slice(i, i + batchSize);
            const promises = batch.map(async (scoreUserId) => {
              const isSecondary = scoreUserId.endsWith('-secondary');
              const baseUserId = isSecondary ? scoreUserId.replace('-secondary', '') : scoreUserId;
              const userDoc = await getDoc(doc(firestore, "users", baseUserId));
              if (userDoc.exists()) {
                const userData = userDoc.data();
                const teamName = isSecondary
                  ? (userData.secondaryTeamName || "Unknown Secondary")
                  : (userData.teamName || "Unknown");
                names.set(scoreUserId, teamName);
              } else {
                names.set(scoreUserId, "Unknown Team");
              }
            });
            await Promise.all(promises);
          }

          setUserNames(names);
          setLastUpdated(new Date());
          setIsLoading(false);
        } catch (err: any) {
          console.error('Error computing standings from race_results:', err);
          const correlationId = generateClientCorrelationId();
          setError(`Error processing standings data: ${err?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`);
          setIsLoading(false);
        }
      },
      (error: any) => {
        console.error("Error fetching race results:", error);
        const correlationId = generateClientCorrelationId();
        let errorMsg: string;
        if (error?.code === 'failed-precondition') {
          errorMsg = `Database index required. Please contact an administrator. [${ERRORS.FIRESTORE_INDEX_REQUIRED.code}] (Ref: ${correlationId})`;
        } else if (error?.code === 'permission-denied') {
          errorMsg = `Permission denied. Please sign in again. [${ERRORS.AUTH_INVALID_TOKEN.code}] (Ref: ${correlationId})`;
        } else {
          errorMsg = `Error loading standings: ${error?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
        }
        setError(errorMsg);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore]);

  // GUID: PAGE_STANDINGS-012-v03
  // [Intent] Filter raw scores by the selected league's member user IDs (or pass all if global).
  // [Inbound Trigger] allScores or selectedLeague changes.
  // [Downstream Impact] filteredScores is consumed by standings and chartData memos.
  const filteredScores = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return allScores;
    }
    return allScores.filter(score => selectedLeague.memberUserIds.includes(score.userId));
  }, [allScores, selectedLeague]);

  // GUID: PAGE_STANDINGS-013-v04
  // [Intent] Calculate cumulative standings for the selected race weekend — computes old/new overall
  //   points, sprint/GP breakdown, rank with tie handling, rank change from previous race, and gap.
  // [Inbound Trigger] filteredScores, completedRaceWeekends, selectedRaceIndex, or userNames changes.
  // [Downstream Impact] Drives the standings table rendering, raceWinners calculation, chartTeams
  //   filtering, and maxPoints for chart Y-axis.
  // @FIX GEMINI-AUDIT: allPriorEventIds and currentWeekendEventIds now contain normalised IDs
  //   (via normalizeRaceIdForComparison) to match the normalised score.raceId values in filteredScores.
  //   baseRaceId shim removed — normalisation makes both legacy and new formats resolve to the same key.
  const standings = useMemo(() => {
    if (completedRaceWeekends.length === 0 || selectedRaceIndex < 0) return [];

    const selectedRace = completedRaceWeekends[selectedRaceIndex];

    // Build set of normalised event IDs up to and including selected race weekend.
    // score.raceId values in filteredScores are already normalised (see PAGE_STANDINGS-011).
    const allPriorEventIds = new Set<string>();
    const currentWeekendEventIds = new Set<string>();

    // Add all events from previous race weekends (normalised to match score.raceId)
    completedRaceWeekends.slice(0, selectedRaceIndex).forEach(race => {
      if (race.sprintRaceId && race.hasSprintScores) {
        allPriorEventIds.add(normalizeRaceIdForComparison(race.sprintRaceId));
      }
      allPriorEventIds.add(normalizeRaceIdForComparison(race.gpRaceId));
    });

    // Add current weekend events (normalised)
    if (selectedRace.sprintRaceId && selectedRace.hasSprintScores) {
      currentWeekendEventIds.add(normalizeRaceIdForComparison(selectedRace.sprintRaceId));
    }
    currentWeekendEventIds.add(normalizeRaceIdForComparison(selectedRace.gpRaceId));

    // Calculate totals for each user
    const userTotals = new Map<string, {
      oldOverall: number;
      sprintPoints: number;
      gpPoints: number;
      newOverall: number
    }>();

    filteredScores.forEach((score) => {
      const existing = userTotals.get(score.userId) || {
        oldOverall: 0,
        sprintPoints: 0,
        gpPoints: 0,
        newOverall: 0,
      };

      // Late joiner handicap scores should always be included as part of oldOverall
      if (score.raceId === 'late-joiner-handicap' || score.raceId === 'late-joiner-penalty') {
        existing.oldOverall += score.totalPoints;
        existing.newOverall += score.totalPoints;
      }
      // Check if score is from prior race weekends
      else if (allPriorEventIds.has(score.raceId)) {
        existing.oldOverall += score.totalPoints;
        existing.newOverall += score.totalPoints;
      }
      // Check if score is from current weekend sprint (compare normalised IDs)
      else if (selectedRace.sprintRaceId && score.raceId === normalizeRaceIdForComparison(selectedRace.sprintRaceId)) {
        existing.sprintPoints = score.totalPoints;
        existing.newOverall += score.totalPoints;
      }
      // Check if score is from current weekend GP (compare normalised IDs)
      else if (score.raceId === normalizeRaceIdForComparison(selectedRace.gpRaceId)) {
        existing.gpPoints = score.totalPoints;
        existing.newOverall += score.totalPoints;
      }

      userTotals.set(score.userId, existing);
    });

    // Sort by new overall points (descending)
    const sorted = Array.from(userTotals.entries())
      .sort((a, b) => b[1].newOverall - a[1].newOverall);

    // Calculate previous standings for rank change
    let previousRanks = new Map<string, number>();
    if (selectedRaceIndex > 0) {
      const prevTotals = new Map<string, number>();
      filteredScores.forEach((score) => {
        // Include late joiner handicaps in previous totals
        const isHandicap = score.raceId === 'late-joiner-handicap' || score.raceId === 'late-joiner-penalty';
        if (isHandicap || allPriorEventIds.has(score.raceId)) {
          prevTotals.set(score.userId, (prevTotals.get(score.userId) || 0) + score.totalPoints);
        }
      });
      const prevSorted = Array.from(prevTotals.entries())
        .sort((a, b) => b[1] - a[1]);
      // Handle ties: teams with equal points get the same rank
      let prevRank = 1;
      let prevPoints = -1;
      prevSorted.forEach(([userId, points], index) => {
        if (points !== prevPoints) {
          prevRank = index + 1;
          prevPoints = points;
        }
        previousRanks.set(userId, prevRank);
      });
    }

    // Build standings array with proper tie-breaking
    // Teams with equal points get the same rank, next team skips to their position
    let currentRank = 1;
    let lastPoints = -1;
    const standingsData: StandingEntry[] = sorted.map(([userId, data], index) => {
      // Handle ties: only increment rank if points are different from previous
      if (data.newOverall !== lastPoints) {
        currentRank = index + 1;
        lastPoints = data.newOverall;
      }
      const prevRank = previousRanks.get(userId) || currentRank;
      const rankChange = prevRank - currentRank;

      const positionAbovePoints = index > 0 ? sorted[index - 1][1].newOverall : data.newOverall;
      const gap = positionAbovePoints - data.newOverall;

      return {
        rank: currentRank,
        userId,
        teamName: userNames.get(userId) || "Unknown",
        oldOverall: data.oldOverall,
        sprintPoints: selectedRace.hasSprint && selectedRace.hasSprintScores ? data.sprintPoints : null,
        gpPoints: data.gpPoints,
        newOverall: data.newOverall,
        gap,
        rankChange,
      };
    });

    return standingsData;
  }, [filteredScores, completedRaceWeekends, selectedRaceIndex, userNames]);

  // GUID: PAGE_STANDINGS-014-v03
  // [Intent] Determine the race winners (highest GP and Sprint points) for the selected race weekend,
  //   returning Sets of userIds to handle ties — all teams with the max score get the Winner badge.
  // [Inbound Trigger] standings array changes.
  // [Downstream Impact] gpWinners and sprintWinners Sets drive RaceWinnerBadge rendering in the table.
  const raceWinners = useMemo(() => {
    if (standings.length === 0) return { gpWinners: new Set<string>(), sprintWinners: new Set<string>() };

    // Find highest GP points and all teams with that score
    let maxGpPoints = 0;
    standings.forEach(team => {
      if (team.gpPoints > maxGpPoints) {
        maxGpPoints = team.gpPoints;
      }
    });
    const gpWinners = new Set<string>();
    if (maxGpPoints > 0) {
      standings.forEach(team => {
        if (team.gpPoints === maxGpPoints) {
          gpWinners.add(team.userId);
        }
      });
    }

    // Find highest Sprint points and all teams with that score
    let maxSprintPoints = 0;
    standings.forEach(team => {
      if (team.sprintPoints !== null && team.sprintPoints > maxSprintPoints) {
        maxSprintPoints = team.sprintPoints;
      }
    });
    const sprintWinners = new Set<string>();
    if (maxSprintPoints > 0) {
      standings.forEach(team => {
        if (team.sprintPoints === maxSprintPoints) {
          sprintWinners.add(team.userId);
        }
      });
    }

    return { gpWinners, sprintWinners };
  }, [standings]);

  // GUID: PAGE_STANDINGS-015-v04
  // [Intent] Build chart data for season progression — cumulative points per team after each race
  //   weekend (including separate Sprint/GP data points for sprint weekends), up to selected race.
  // [Inbound Trigger] completedRaceWeekends, filteredScores, userNames, or selectedRaceIndex changes.
  // [Downstream Impact] chartData array is consumed by the Recharts LineChart rendering.
  // @FIX GEMINI-AUDIT: score.raceId comparisons now use normalizeRaceIdForComparison() to match the
  //   normalised IDs stored in filteredScores. baseRaceId shim removed.
  const chartData = useMemo(() => {
    if (completedRaceWeekends.length === 0 || !userNames.size || selectedRaceIndex < 0) return [];

    // Get all unique user IDs (filtered by league)
    const userIds = new Set<string>();
    filteredScores.forEach(s => userIds.add(s.userId));

    // Build data points: Start (0) + each race weekend up to selected
    const data: Record<string, any>[] = [];

    // Pre-season: show handicap points for late joiners, 0 for others
    const startPoint: Record<string, any> = { race: "Start" };
    userIds.forEach(userId => {
      const teamName = userNames.get(userId) || userId;
      // Check for late joiner handicap
      const handicap = filteredScores.find(s =>
        s.userId === userId &&
        (s.raceId === 'late-joiner-handicap' || s.raceId === 'late-joiner-penalty')
      );
      startPoint[teamName] = handicap?.totalPoints || 0;
    });
    data.push(startPoint);

    // Calculate cumulative totals after each race weekend (only up to selected)
    // Start with handicap points for late joiners
    const cumulativeTotals = new Map<string, number>();
    userIds.forEach(userId => {
      // Check for late joiner handicap
      const handicap = filteredScores.find(s =>
        s.userId === userId &&
        (s.raceId === 'late-joiner-handicap' || s.raceId === 'late-joiner-penalty')
      );
      cumulativeTotals.set(userId, handicap?.totalPoints || 0);
    });

    // Only show races up to and including the selected race
    const racesToShow = completedRaceWeekends.slice(0, selectedRaceIndex + 1);

    racesToShow.forEach((race, raceIndex) => {
      // For sprint weekends, add Sprint and GP as separate data points
      if (race.hasSprint && race.hasSprintScores) {
        // First: Add Sprint scores (compare normalised IDs)
        filteredScores.forEach(score => {
          if (race.sprintRaceId && score.raceId === normalizeRaceIdForComparison(race.sprintRaceId)) {
            const current = cumulativeTotals.get(score.userId) || 0;
            cumulativeTotals.set(score.userId, current + score.totalPoints);
          }
        });

        // Create data point after Sprint
        const sprintPoint: Record<string, any> = { race: `R${raceIndex + 1}S` };
        userIds.forEach(userId => {
          const teamName = userNames.get(userId) || userId;
          sprintPoint[teamName] = cumulativeTotals.get(userId) || 0;
        });
        data.push(sprintPoint);

        // Second: Add GP scores (compare normalised IDs)
        filteredScores.forEach(score => {
          if (score.raceId === normalizeRaceIdForComparison(race.gpRaceId)) {
            const current = cumulativeTotals.get(score.userId) || 0;
            cumulativeTotals.set(score.userId, current + score.totalPoints);
          }
        });

        // Create data point after GP
        const gpPoint: Record<string, any> = { race: `R${raceIndex + 1}` };
        userIds.forEach(userId => {
          const teamName = userNames.get(userId) || userId;
          gpPoint[teamName] = cumulativeTotals.get(userId) || 0;
        });
        data.push(gpPoint);
      } else {
        // Non-sprint weekend: just add GP scores (compare normalised IDs)
        filteredScores.forEach(score => {
          if (score.raceId === normalizeRaceIdForComparison(race.gpRaceId)) {
            const current = cumulativeTotals.get(score.userId) || 0;
            cumulativeTotals.set(score.userId, current + score.totalPoints);
          }
        });

        // Create data point for this race
        const racePoint: Record<string, any> = { race: `R${raceIndex + 1}` };
        userIds.forEach(userId => {
          const teamName = userNames.get(userId) || userId;
          racePoint[teamName] = cumulativeTotals.get(userId) || 0;
        });
        data.push(racePoint);
      }
    });

    return data;
  }, [completedRaceWeekends, filteredScores, userNames, selectedRaceIndex]);

  // GUID: PAGE_STANDINGS-016-v03
  // [Intent] Derive the current user's primary and secondary userIds for chart line filtering.
  // [Inbound Trigger] user state changes.
  // [Downstream Impact] Used by chartTeams memo to include user's teams even outside top 10.
  const userTeamIds = useMemo(() => {
    if (!user) return { primary: null, secondary: null };
    return { primary: user.id, secondary: user.secondaryTeamName ? `${user.id}-secondary` : null };
  }, [user]);

  // GUID: PAGE_STANDINGS-017-v03
  // [Intent] Filter chart lines to approximately 11 teams based on chartMode (top10 or myPosition).
  //   In top10 mode: top 10 teams + user's team(s) if outside top 10.
  //   In myPosition mode: user's team + 5 above + 5 below in standings.
  // [Inbound Trigger] standings, chartMode, or userTeamIds changes.
  // [Downstream Impact] chartTeams array controls which Line components are rendered in the chart.
  const chartTeams = useMemo(() => {
    if (standings.length === 0) return [];

    if (chartMode === 'top10') {
      // Top 10 + user's team(s) if outside top 10
      const top10Names = standings.slice(0, 10).map(s => s.teamName);
      const result = new Set(top10Names);
      if (userTeamIds.primary) {
        const primaryEntry = standings.find(s => s.userId === userTeamIds.primary);
        if (primaryEntry) result.add(primaryEntry.teamName);
      }
      if (userTeamIds.secondary) {
        const secondaryEntry = standings.find(s => s.userId === userTeamIds.secondary);
        if (secondaryEntry) result.add(secondaryEntry.teamName);
      }
      // Return in standings order
      return standings.filter(s => result.has(s.teamName)).map(s => s.teamName);
    }

    // myPosition mode: user's team + 5 above + 5 below
    const userIndex = userTeamIds.primary
      ? standings.findIndex(s => s.userId === userTeamIds.primary)
      : -1;

    if (userIndex === -1) {
      // User not found — fallback to top 11
      return standings.slice(0, 11).map(s => s.teamName);
    }

    const start = Math.max(0, Math.min(userIndex - 5, standings.length - 11));
    const end = Math.min(standings.length, start + 11);
    const windowNames = new Set(standings.slice(start, end).map(s => s.teamName));

    // Also include secondary team if outside the window
    if (userTeamIds.secondary) {
      const secondaryEntry = standings.find(s => s.userId === userTeamIds.secondary);
      if (secondaryEntry) windowNames.add(secondaryEntry.teamName);
    }

    return standings.filter(s => windowNames.has(s.teamName)).map(s => s.teamName);
  }, [standings, chartMode, userTeamIds]);

  // GUID: PAGE_STANDINGS-018-v03
  // [Intent] Generate a deterministic HSL colour for each team name — ensures the same team always
  //   gets the same colour regardless of which race is selected.
  // [Inbound Trigger] Called per team when rendering Line components in the chart.
  // [Downstream Impact] Pure function — no side effects. Drives chart line stroke colour.
  const getStableTeamColor = useCallback((name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }, []);

  // GUID: PAGE_STANDINGS-019-v03
  // [Intent] Calculate maximum points for the chart Y-axis with a 10% buffer for visual headroom.
  // [Inbound Trigger] standings array changes (specifically the top team's newOverall).
  // [Downstream Impact] Sets the YAxis domain upper bound in the Recharts LineChart.
  const maxPoints = useMemo(() => {
    if (standings.length === 0) return 100;
    // Add 10% buffer for better visualization
    return Math.ceil(standings[0].newOverall * 1.1);
  }, [standings]);

  // GUID: PAGE_STANDINGS-020-v03
  // [Intent] Client-side pagination — tracks how many standings rows to display and whether more exist.
  // [Inbound Trigger] Computed from standings.length and displayCount state.
  // [Downstream Impact] Controls the "Load More" button visibility and progress bar display.
  const totalItems = standings.length;
  const displayedStandings = standings.slice(0, displayCount);
  const hasMore = displayCount < totalItems;
  const progressPercent = totalItems > 0 ? Math.round((displayCount / totalItems) * 100) : 100;

  // GUID: PAGE_STANDINGS-021-v03
  // [Intent] Load the next page of standings rows with a small delay for smooth UX.
  // [Inbound Trigger] User clicks the "Load More" button.
  // [Downstream Impact] Increases displayCount by PAGE_SIZE, showing more rows in the table.
  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, totalItems));
      setIsLoadingMore(false);
    }, 150);
  }, [totalItems]);

  // GUID: PAGE_STANDINGS-022-v03
  // [Intent] Navigate to the Results page for a specific race, optionally filtering by team.
  // [Inbound Trigger] User clicks a score cell (Old Overall, Sprint points, or GP points) in the table.
  // [Downstream Impact] Triggers client-side navigation to /results with race and optional team params.
  const navigateToResults = (raceId: string, teamId?: string) => {
    const url = teamId
      ? `/results?race=${raceId}&team=${encodeURIComponent(teamId)}`
      : `/results?race=${raceId}`;
    router.push(url);
  };

  const selectedRace = completedRaceWeekends[selectedRaceIndex];
  const racesCompleted = selectedRaceIndex + 1;
  const showSprintColumn = selectedRace?.hasSprint && selectedRace?.hasSprintScores;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-2xl font-headline">Season Standings</CardTitle>
              <LeagueSelector className="w-[200px] mt-2" />
              <CardDescription>
                {completedRaceWeekends.length > 0 ? (
                  <>
                    After {racesCompleted} of {RaceSchedule.length} race weekends
                    {selectedRace && (
                      <span className="ml-1 text-foreground">({selectedRace.name})</span>
                    )}
                  </>
                ) : (
                  "No races completed yet"
                )}
              </CardDescription>
            </div>
            <LastUpdated timestamp={lastUpdated} />
          </div>

          {/* Race selector tabs */}
          {completedRaceWeekends.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Select race weekend to view cumulative standings:</p>
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-1 pb-2">
                  {completedRaceWeekends.map((race, index) => (
                    <Button
                      key={race.gpRaceId}
                      variant={index === selectedRaceIndex ? "default" : "outline"}
                      size="sm"
                      className={`flex-shrink-0 text-xs px-2 gap-1 ${
                        race.hasSprint
                          ? "h-10 py-2 flex-col"
                          : "h-7 py-1"
                      }`}
                      onClick={() => {
                        setSelectedRaceIndex(index);
                        setDisplayCount(PAGE_SIZE);
                      }}
                      title={race.name}
                    >
                      <span>R{index + 1}</span>
                      {race.hasSprint && (
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                          <Zap className="h-2.5 w-2.5" />
                          Sprint
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              {selectedRace && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">
                    {selectedRace.name}
                  </Badge>
                  {selectedRace.hasSprint && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Zap className="h-3 w-3" />
                      Sprint Weekend
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => navigateToResults(selectedRace.gpRaceId)}
                  >
                    View Results
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 7a3f1d2e — Season progression chart with mode toggle */}
        {!isLoading && chartData.length > 1 && chartTeams.length > 0 && (
          <div className="space-y-2 mb-4">
            {/* 7a3f1d2e — chart mode toggle buttons */}
            <div className="flex gap-1">
              <Button
                variant={chartMode === 'top10' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setChartMode('top10')}
              >
                <Users className="h-3 w-3" />
                Top 10
              </Button>
              <Button
                variant={chartMode === 'myPosition' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setChartMode('myPosition')}
              >
                <Crosshair className="h-3 w-3" />
                My Position
              </Button>
            </div>
            <div className="w-full h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart key={`chart-${selectedRaceIndex}-${chartMode}`} data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <XAxis
                    dataKey="race"
                    tick={{ fontSize: 10 }}
                    axisLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                    tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    domain={[0, maxPoints]}
                    tick={{ fontSize: 10 }}
                    axisLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                    tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                    width={35}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  {/* 7a3f1d2e — mode-aware line styling */}
                  {chartTeams.map((teamName) => {
                    const rank = standings.findIndex(s => s.teamName === teamName);
                    const entry = standings.find(s => s.teamName === teamName);
                    const isUserTeam = entry != null && (entry.userId === userTeamIds.primary || entry.userId === userTeamIds.secondary);

                    // top10: top 3 bold+opaque; myPosition: user's teams bold+opaque
                    const bold = chartMode === 'top10' ? rank < 3 : isUserTeam;

                    return (
                      <Line
                        key={teamName}
                        type="monotone"
                        dataKey={teamName}
                        stroke={getStableTeamColor(teamName)}
                        strokeWidth={bold ? 2.5 : 1}
                        dot={false}
                        opacity={bold ? 1 : 0.4}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* GUID: PAGE_STANDINGS-023-v01
            [Intent] Collapsible "Table Guide" legend explaining all visual indicators in the standings
              table: rank badges (gold/silver/bronze), rank change arrows, race winner badge, defending
              champion badge, and column definitions (Old Overall, New Overall, Sprint, Gap).
            [Inbound Trigger] User clicks the "Table Guide" trigger button to expand/collapse the legend.
            [Downstream Impact] Pure presentational — no data fetching or state side-effects beyond
              isLegendOpen toggle. Does not affect table layout or pagination. */}
        <Collapsible open={isLegendOpen} onOpenChange={setIsLegendOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Table Guide</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isLegendOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {/* Rank badges */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700 shrink-0">
                    <Trophy className="h-3 w-3 mr-0.5" />1st
                  </Badge>
                  <span className="text-muted-foreground">Gold badge — 1st place</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 shrink-0">
                    <Medal className="h-3 w-3 mr-0.5" />2nd
                  </Badge>
                  <span className="text-muted-foreground">Silver badge — 2nd place</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700 shrink-0">
                    <Medal className="h-3 w-3 mr-0.5" />3rd
                  </Badge>
                  <span className="text-muted-foreground">Bronze badge — 3rd place</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="px-1 py-0 text-[9px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700 shrink-0">
                    Winner
                  </Badge>
                  <span className="text-muted-foreground">Team with most points in that race</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[9px] bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700 shrink-0">
                    <Crown className="h-3 w-3 mr-0.5 inline" />2025 Champion
                  </Badge>
                  <span className="text-muted-foreground">Defending 2025 season champion</span>
                </div>
                {/* Rank change arrows */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5 shrink-0">
                    <ChevronsUp className="h-4 w-4 text-green-500" />
                  </span>
                  <span className="text-muted-foreground">Jumped 2+ positions up</span>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowUp className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="text-muted-foreground">Moved up 1 position</span>
                </div>
                <div className="flex items-center gap-2">
                  <Minus className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">No change in position</span>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowDown className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="text-muted-foreground">Moved down 1 position</span>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronsDown className="h-4 w-4 text-red-500 shrink-0" />
                  <span className="text-muted-foreground">Dropped 2+ positions</span>
                </div>
                {/* Column definitions */}
                <div className="flex items-start gap-2">
                  <span className="font-medium text-foreground shrink-0 w-24">Old Overall</span>
                  <span className="text-muted-foreground">Points before the selected race</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-medium text-foreground shrink-0 w-24">New Overall</span>
                  <span className="text-muted-foreground">Cumulative total including selected race</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="flex items-center gap-1 font-medium text-foreground shrink-0 w-24">
                    <Zap className="h-3 w-3" />Sprint
                  </span>
                  <span className="text-muted-foreground">Points from the sprint race (sprint weekends only)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-medium text-foreground shrink-0 w-24">Gap</span>
                  <span className="text-muted-foreground">Points behind the team directly above</span>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Progress indicator */}
        {!isLoading && totalItems > PAGE_SIZE && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Showing {displayedStandings.length} of {totalItems} teams</span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px] text-center">Rank</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead className="text-right hidden sm:table-cell">
                {selectedRaceIndex > 0 ? `Old Overall` : '-'}
              </TableHead>
              {showSprintColumn && (
                <TableHead className="text-right">
                  <span className="flex items-center justify-end gap-1">
                    <Zap className="h-3 w-3" />
                    Sprint
                  </span>
                </TableHead>
              )}
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1">
                  <Flag className="h-3 w-3" />
                  R{selectedRaceIndex + 1}
                </span>
              </TableHead>
              <TableHead className="text-right">New Overall</TableHead>
              <TableHead className="text-right">Gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                  {showSprintColumn && <TableCell><Skeleton className="h-5 w-10 ml-auto" /></TableCell>}
                  <TableCell><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-10 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : displayedStandings.length > 0 ? (
              displayedStandings.map((team) => (
                <TableRow key={team.userId}>
                  <TableCell className="text-center font-medium">
                    <div className="flex items-center justify-center gap-1">
                      <span>{team.rank}</span>
                      <RankChangeIndicator change={team.rankChange} />
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">
                    <span className="flex items-center flex-wrap gap-y-1">
                      {team.teamName === DEFENDING_CHAMPION_TEAM && <DefendingChampionBadge />}
                      {team.teamName}
                      <RankBadge rank={team.rank} />
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground hidden sm:table-cell">
                    {selectedRaceIndex > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs font-mono text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          // Navigate to previous race's GP results
                          const prevRace = completedRaceWeekends[selectedRaceIndex - 1];
                          if (prevRace) {
                            navigateToResults(prevRace.gpRaceId);
                          }
                        }}
                        title={`View ${completedRaceWeekends[selectedRaceIndex - 1]?.name} results`}
                      >
                        {team.oldOverall}
                      </Button>
                    ) : '-'}
                  </TableCell>
                  {showSprintColumn && (
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs font-mono text-amber-600"
                          onClick={() => selectedRace?.sprintRaceId && navigateToResults(selectedRace.sprintRaceId)}
                          title="View Sprint results"
                        >
                          +{team.sprintPoints ?? 0}
                        </Button>
                        {raceWinners.sprintWinners.has(team.userId) && <RaceWinnerBadge />}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <span className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs font-mono text-accent"
                        onClick={() => selectedRace && navigateToResults(selectedRace.gpRaceId)}
                        title="View GP results"
                      >
                        +{team.gpPoints}
                      </Button>
                      {raceWinners.gpWinners.has(team.userId) && <RaceWinnerBadge />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg text-accent">
                    {team.newOverall}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {team.gap > 0 ? team.gap : '-'}
                  </TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={showSprintColumn ? 7 : 6} className="text-center h-24 text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={showSprintColumn ? 7 : 6} className="text-center h-24 text-muted-foreground">
                  No standings data available yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Load more button */}
        {hasMore && !isLoading && (
          <div className="flex justify-center pt-4">
            {isLoadingMore ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <Button variant="outline" onClick={loadMore} className="gap-2">
                <ChevronDown className="h-4 w-4" />
                Load More ({totalItems - displayCount} remaining)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
