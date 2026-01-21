"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
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
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus, ChevronDown, Loader2, ExternalLink, Zap, Flag, Trophy, Medal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

const RaceWinnerBadge = () => (
  <Badge variant="outline" className="ml-1 px-1 py-0 text-[9px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
    Winner
  </Badge>
);

interface ScoreData {
  oduserId?: string;
  userId: string;
  raceId: string;
  totalPoints: number;
}

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

const PAGE_SIZE = 25;

export default function StandingsPage() {
  const firestore = useFirestore();
  const router = useRouter();
  const { selectedLeague } = useLeague();

  const [allScores, setAllScores] = useState<ScoreData[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [completedRaceWeekends, setCompletedRaceWeekends] = useState<RaceWeekend[]>([]);
  const [selectedRaceIndex, setSelectedRaceIndex] = useState<number>(-1);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch all scores and determine completed race weekends
  useEffect(() => {
    if (!firestore) return;

    const fetchData = async () => {
      setIsLoading(true);

      try {
        // Fetch all scores
        const scoresSnapshot = await getDocs(collection(firestore, "scores"));
        const scores: ScoreData[] = [];
        const raceIdsWithScores = new Set<string>();

        scoresSnapshot.forEach((doc) => {
          const data = doc.data();
          const userId = data.oduserId || data.userId;
          scores.push({
            userId,
            raceId: data.raceId,
            totalPoints: data.totalPoints || 0,
          });
          raceIdsWithScores.add(data.raceId);
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
          const hasGpScores = raceIdsWithScores.has(gpRaceId);
          const hasSprintScores = sprintRaceId ? raceIdsWithScores.has(sprintRaceId) : false;

          // Also check for legacy format (without -GP suffix)
          const hasLegacyScores = raceIdsWithScores.has(baseRaceId);

          if (hasGpScores || hasLegacyScores) {
            completed.push({
              name: race.name,
              baseRaceId,
              sprintRaceId,
              gpRaceId: hasGpScores ? gpRaceId : baseRaceId, // Use legacy if no GP suffix
              hasSprint: race.hasSprint,
              index,
              hasSprintScores,
              hasGpScores: hasGpScores || hasLegacyScores,
            });
          }
        });

        setCompletedRaceWeekends(completed);
        setSelectedRaceIndex(completed.length - 1);

        // Get unique user IDs and fetch team names
        const userIds = new Set<string>();
        scores.forEach(s => userIds.add(s.userId));

        const names = new Map<string, string>();
        const batchSize = 10;
        const userIdArray = Array.from(userIds);

        for (let i = 0; i < userIdArray.length; i += batchSize) {
          const batch = userIdArray.slice(i, i + batchSize);
          const promises = batch.map(async (userId) => {
            const userDoc = await getDoc(doc(firestore, "users", userId));
            if (userDoc.exists()) {
              names.set(userId, userDoc.data().teamName || "Unknown");
            } else {
              names.set(userId, "Unknown Team");
            }
          });
          await Promise.all(promises);
        }

        setUserNames(names);
        setLastUpdated(new Date());
      } catch (error) {
        console.error("Error fetching standings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [firestore]);

  // Filter scores by selected league
  const filteredScores = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return allScores;
    }
    return allScores.filter(score => selectedLeague.memberUserIds.includes(score.userId));
  }, [allScores, selectedLeague]);

  // Calculate standings for selected race weekend
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

      // Check if score is from prior race weekends
      if (allPriorEventIds.has(score.raceId)) {
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
        if (allPriorEventIds.has(score.raceId)) {
          prevTotals.set(score.userId, (prevTotals.get(score.userId) || 0) + score.totalPoints);
        }
      });
      const prevSorted = Array.from(prevTotals.entries())
        .sort((a, b) => b[1] - a[1]);
      prevSorted.forEach(([userId], index) => {
        previousRanks.set(userId, index + 1);
      });
    }

    // Build standings array
    const standingsData: StandingEntry[] = sorted.map(([userId, data], index) => {
      const currentRank = index + 1;
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

  // Calculate race winners (highest GP and Sprint points for the selected race)
  const raceWinners = useMemo(() => {
    if (standings.length === 0) return { gpWinner: null, sprintWinner: null };

    // Find highest GP points
    let maxGpPoints = 0;
    let gpWinnerUserId: string | null = null;
    standings.forEach(team => {
      if (team.gpPoints > maxGpPoints) {
        maxGpPoints = team.gpPoints;
        gpWinnerUserId = team.userId;
      }
    });

    // Find highest Sprint points (if applicable)
    let maxSprintPoints = 0;
    let sprintWinnerUserId: string | null = null;
    standings.forEach(team => {
      if (team.sprintPoints !== null && team.sprintPoints > maxSprintPoints) {
        maxSprintPoints = team.sprintPoints;
        sprintWinnerUserId = team.userId;
      }
    });

    return {
      gpWinner: maxGpPoints > 0 ? gpWinnerUserId : null,
      sprintWinner: maxSprintPoints > 0 ? sprintWinnerUserId : null,
    };
  }, [standings]);

  // Calculate chart data for season progression (only up to selected race)
  const chartData = useMemo(() => {
    if (completedRaceWeekends.length === 0 || !userNames.size || selectedRaceIndex < 0) return [];

    // Get all unique user IDs (filtered by league)
    const userIds = new Set<string>();
    filteredScores.forEach(s => userIds.add(s.userId));

    // Build data points: Start (0) + each race weekend up to selected
    const data: Record<string, any>[] = [];

    // Pre-season: everyone at 0
    const startPoint: Record<string, any> = { race: "Start" };
    userIds.forEach(userId => {
      const teamName = userNames.get(userId) || userId;
      startPoint[teamName] = 0;
    });
    data.push(startPoint);

    // Calculate cumulative totals after each race weekend (only up to selected)
    const cumulativeTotals = new Map<string, number>();
    userIds.forEach(userId => cumulativeTotals.set(userId, 0));

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

  // Get team names for chart lines (sorted by final position)
  const chartTeams = useMemo(() => {
    if (standings.length === 0) return [];
    return standings.map(s => s.teamName);
  }, [standings]);

  // Generate colors for teams (top 3 get distinct colors, rest are grey)
  const getTeamColor = (index: number) => {
    if (index === 0) return "hsl(45, 100%, 50%)";  // Gold
    if (index === 1) return "hsl(0, 0%, 75%)";     // Silver
    if (index === 2) return "hsl(30, 60%, 50%)";   // Bronze
    return "hsl(0, 0%, 40%)";                       // Grey for others
  };

  // Get max points for Y-axis (based on selected race standings)
  const maxPoints = useMemo(() => {
    if (standings.length === 0) return 100;
    // Add 10% buffer for better visualization
    return Math.ceil(standings[0].newOverall * 1.1);
  }, [standings]);

  // Pagination
  const totalItems = standings.length;
  const displayedStandings = standings.slice(0, displayCount);
  const hasMore = displayCount < totalItems;
  const progressPercent = totalItems > 0 ? Math.round((displayCount / totalItems) * 100) : 100;

  const loadMore = useCallback(() => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, totalItems));
      setIsLoadingMore(false);
    }, 150);
  }, [totalItems]);

  const navigateToResults = (raceId: string) => {
    router.push(`/results?race=${raceId}`);
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
        {/* Season progression chart */}
        {!isLoading && chartData.length > 1 && chartTeams.length > 0 && (
          <div className="w-full h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
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
                {chartTeams.map((teamName, index) => (
                  <Line
                    key={teamName}
                    type="monotone"
                    dataKey={teamName}
                    stroke={getTeamColor(index)}
                    strokeWidth={index < 3 ? 2 : 1}
                    dot={false}
                    opacity={index < 3 ? 1 : 0.4}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
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
                        {raceWinners.sprintWinner === team.userId && <RaceWinnerBadge />}
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
                      {raceWinners.gpWinner === team.userId && <RaceWinnerBadge />}
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
