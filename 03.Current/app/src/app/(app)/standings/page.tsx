// GUID: PAGE_STANDINGS-000-v03
// [Intent] Season Standings page — displays cumulative league standings after each race weekend,
//   with race-by-race selection, season progression chart, rank change indicators, and pagination.
// [Inbound Trigger] Navigation to /standings route by authenticated user.
// [Downstream Impact] Reads from Firestore scores and users collections in real-time; navigates
//   to /results page when user clicks score cells.

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus, ChevronDown, Loader2, ExternalLink, Zap, Flag, Trophy, Medal, Crown, Users, Crosshair } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ERRORS } from '@/lib/error-registry';
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

// GUID: PAGE_STANDINGS-008-v03
// [Intent] Type for a completed race weekend — tracks base, sprint, and GP race IDs along with
//   completion flags.
// [Inbound Trigger] Built from RaceSchedule cross-referenced with score raceIds that exist in Firestore.
// [Downstream Impact] Drives race weekend tab rendering and standings calculation logic.
interface RaceWeekend {
  name: string;
  baseRaceId: string; // e.g., "Chinese-Grand-Prix"
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

// GUID: PAGE_STANDINGS-010-v03
// [Intent] Main Standings page component — subscribes to scores in real-time, computes cumulative
//   standings per race weekend, renders the progression chart and sortable standings table.
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

  // GUID: PAGE_STANDINGS-011-v04
  // [Intent] Real-time subscription to the entire scores collection — processes raw score documents,
  //   determines which race weekends are completed, and fetches team names for all scoring users.
  // [Inbound Trigger] Fires on component mount and whenever firestore reference changes; re-fires
  //   on any score document change in the scores collection.
  // [Downstream Impact] Populates allScores, completedRaceWeekends, userNames, and lastUpdated state.
  //   All downstream memos (standings, chartData, raceWinners) depend on these.
  useEffect(() => {
    if (!firestore) return;

    setIsLoading(true);

    // Subscribe to scores collection for real-time updates
    const unsubscribe = onSnapshot(
      collection(firestore, "scores"),
      async (scoresSnapshot) => {
        try {
          const scores: ScoreData[] = [];
          const raceIdsWithScores = new Set<string>();

          scoresSnapshot.forEach((doc) => {
            try {
              const data = doc.data();
              if (!data) return;
              const userId = data.oduserId || data.userId;
              if (!userId) return; // Skip invalid scores
              const raceId = (data.raceId || '').toLowerCase();
              scores.push({
                userId,
                raceId,
                totalPoints: data.totalPoints || 0,
              });
              if (raceId) {
                raceIdsWithScores.add(raceId);
              }
            } catch (docErr) {
              console.error('Error processing score doc:', doc.id, docErr);
            }
          });

        setAllScores(scores);

        // Determine completed race weekends (races that have at least GP scores)
        const completed: RaceWeekend[] = [];
        RaceSchedule.forEach((race, index) => {
          const baseRaceId = race.name.replace(/\s+/g, '-');
          const sprintRaceId = race.hasSprint ? `${baseRaceId}-Sprint` : null;
          const gpRaceId = `${baseRaceId}-GP`;

          // Check if we have scores for this race weekend
          // A race weekend is "completed" if it has GP scores
          // Note: Scores are stored with lowercase raceId, so we lowercase for comparison
          const hasGpScores = raceIdsWithScores.has(gpRaceId.toLowerCase());
          const hasSprintScores = sprintRaceId ? raceIdsWithScores.has(sprintRaceId.toLowerCase()) : false;

          // Also check for legacy format (without -GP suffix)
          const hasLegacyScores = raceIdsWithScores.has(baseRaceId.toLowerCase());

          if (hasGpScores || hasLegacyScores) {
            // Store lowercase IDs to match against score.raceId which is lowercase
            completed.push({
              name: race.name,
              baseRaceId: baseRaceId.toLowerCase(),
              sprintRaceId: sprintRaceId?.toLowerCase() || null,
              gpRaceId: hasGpScores ? gpRaceId.toLowerCase() : baseRaceId.toLowerCase(),
              hasSprint: race.hasSprint,
              index,
              hasSprintScores,
              hasGpScores: hasGpScores || hasLegacyScores,
            });
          }
        });

        setCompletedRaceWeekends(completed);
        // Only set selectedRaceIndex if it's not already set or if there are no completed races
        setSelectedRaceIndex(prev => {
          if (completed.length === 0) return -1;
          if (prev < 0 || prev >= completed.length) return completed.length - 1;
          return prev;
        });

        // Get unique user IDs and fetch team names
        // Handle secondary teams: userId ends with "-secondary", use secondaryTeamName field
        const userIds = new Set<string>();
        scores.forEach(s => userIds.add(s.userId));

        const names = new Map<string, string>();
        const batchSize = 10;
        const userIdArray = Array.from(userIds);

        for (let i = 0; i < userIdArray.length; i += batchSize) {
          const batch = userIdArray.slice(i, i + batchSize);
          const promises = batch.map(async (scoreUserId) => {
            // Check if this is a secondary team
            const isSecondary = scoreUserId.endsWith('-secondary');
            const baseUserId = isSecondary ? scoreUserId.replace('-secondary', '') : scoreUserId;

            const userDoc = await getDoc(doc(firestore, "users", baseUserId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              // Use secondaryTeamName for secondary teams, teamName for primary
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
          console.error('Error in scores snapshot handler:', err);
          const correlationId = generateClientCorrelationId();
          setError(`Error processing standings data: ${err?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`);
          setIsLoading(false);
        }
      },
      (error: any) => {
        console.error("Error fetching standings:", error);
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

    // Cleanup subscription on unmount
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

  // GUID: PAGE_STANDINGS-013-v03
  // [Intent] Calculate cumulative standings for the selected race weekend — computes old/new overall
  //   points, sprint/GP breakdown, rank with tie handling, rank change from previous race, and gap.
  // [Inbound Trigger] filteredScores, completedRaceWeekends, selectedRaceIndex, or userNames changes.
  // [Downstream Impact] Drives the standings table rendering, raceWinners calculation, chartTeams
  //   filtering, and maxPoints for chart Y-axis.
  const standings = useMemo(() => {
    if (completedRaceWeekends.length === 0 || selectedRaceIndex < 0) return [];

    const selectedRace = completedRaceWeekends[selectedRaceIndex];

    // Build set of all event IDs up to and including selected race weekend
    const allPriorEventIds = new Set<string>();
    const currentWeekendEventIds = new Set<string>();

    // Add all events from previous race weekends
    completedRaceWeekends.slice(0, selectedRaceIndex).forEach(race => {
      if (race.sprintRaceId && race.hasSprintScores) {
        allPriorEventIds.add(race.sprintRaceId);
      }
      allPriorEventIds.add(race.gpRaceId);
      // Also add legacy format
      allPriorEventIds.add(race.baseRaceId);
    });

    // Add current weekend events
    if (selectedRace.sprintRaceId && selectedRace.hasSprintScores) {
      currentWeekendEventIds.add(selectedRace.sprintRaceId);
    }
    currentWeekendEventIds.add(selectedRace.gpRaceId);
    currentWeekendEventIds.add(selectedRace.baseRaceId); // Legacy format

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
      // Check if score is from current weekend sprint
      else if (selectedRace.sprintRaceId && score.raceId === selectedRace.sprintRaceId) {
        existing.sprintPoints = score.totalPoints;
        existing.newOverall += score.totalPoints;
      }
      // Check if score is from current weekend GP
      else if (score.raceId === selectedRace.gpRaceId || score.raceId === selectedRace.baseRaceId) {
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

  // GUID: PAGE_STANDINGS-015-v03
  // [Intent] Build chart data for season progression — cumulative points per team after each race
  //   weekend (including separate Sprint/GP data points for sprint weekends), up to selected race.
  // [Inbound Trigger] completedRaceWeekends, filteredScores, userNames, or selectedRaceIndex changes.
  // [Downstream Impact] chartData array is consumed by the Recharts LineChart rendering.
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
        // First: Add Sprint scores
        filteredScores.forEach(score => {
          if (race.sprintRaceId && score.raceId === race.sprintRaceId) {
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

        // Second: Add GP scores
        filteredScores.forEach(score => {
          if (score.raceId === race.gpRaceId || score.raceId === race.baseRaceId) {
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
        // Non-sprint weekend: just add GP scores
        filteredScores.forEach(score => {
          if (score.raceId === race.gpRaceId || score.raceId === race.baseRaceId) {
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
                      key={race.baseRaceId}
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
