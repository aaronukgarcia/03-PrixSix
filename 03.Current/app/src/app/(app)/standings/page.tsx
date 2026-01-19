"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFirestore } from "@/firebase";
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
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus, ChevronDown, Loader2, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

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
  oldOverall: number; // Previous cumulative total (before selected race)
  racePoints: number; // Points from the selected race
  newOverall: number; // New cumulative total (after selected race)
  gap: number; // Gap to position above (not leader)
  rankChange: number;
}

interface CompletedRace {
  name: string;
  raceId: string;
  shortName: string;
  index: number;
}

const PAGE_SIZE = 25;

export default function StandingsPage() {
  const firestore = useFirestore();
  const router = useRouter();

  const [allScores, setAllScores] = useState<ScoreData[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [completedRaces, setCompletedRaces] = useState<CompletedRace[]>([]);
  const [selectedRaceIndex, setSelectedRaceIndex] = useState<number>(-1); // -1 = latest
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch all scores and determine completed races
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

        // Determine completed races (races that have scores)
        const completed: CompletedRace[] = [];
        RaceSchedule.forEach((race, index) => {
          const raceId = race.name.replace(/\s+/g, '-');
          if (raceIdsWithScores.has(raceId)) {
            // Short name: first letters of each word
            const shortName = race.name
              .split(' ')
              .filter(w => w.toLowerCase() !== 'grand' && w.toLowerCase() !== 'prix')
              .map(w => w.substring(0, 3))
              .join('')
              .toUpperCase()
              .substring(0, 3);

            completed.push({
              name: race.name,
              raceId,
              shortName,
              index,
            });
          }
        });

        setCompletedRaces(completed);
        setSelectedRaceIndex(completed.length - 1); // Default to latest

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

  // Calculate standings up to selected race
  const standings = useMemo(() => {
    if (completedRaces.length === 0 || selectedRaceIndex < 0) return [];

    const selectedRace = completedRaces[selectedRaceIndex];

    // Get race IDs up to and including selected race (for new overall)
    const includedRaceIds = new Set(
      completedRaces.slice(0, selectedRaceIndex + 1).map(r => r.raceId)
    );

    // Get race IDs before selected race (for old overall)
    const previousRaceIds = new Set(
      completedRaces.slice(0, selectedRaceIndex).map(r => r.raceId)
    );

    // Calculate totals for each user
    const userTotals = new Map<string, { oldOverall: number; racePoints: number; newOverall: number }>();

    allScores.forEach((score) => {
      if (includedRaceIds.has(score.raceId)) {
        const existing = userTotals.get(score.userId) || {
          oldOverall: 0,
          racePoints: 0,
          newOverall: 0,
        };

        if (previousRaceIds.has(score.raceId)) {
          existing.oldOverall += score.totalPoints;
        }
        if (score.raceId === selectedRace.raceId) {
          existing.racePoints = score.totalPoints;
        }
        existing.newOverall += score.totalPoints;

        userTotals.set(score.userId, existing);
      }
    });

    // Sort by new overall points (descending)
    const sorted = Array.from(userTotals.entries())
      .sort((a, b) => b[1].newOverall - a[1].newOverall);

    // Calculate previous standings for rank change (if not on first race)
    let previousRanks = new Map<string, number>();
    if (selectedRaceIndex > 0) {
      const prevTotals = new Map<string, number>();
      allScores.forEach((score) => {
        if (previousRaceIds.has(score.raceId)) {
          prevTotals.set(score.userId, (prevTotals.get(score.userId) || 0) + score.totalPoints);
        }
      });
      const prevSorted = Array.from(prevTotals.entries())
        .sort((a, b) => b[1] - a[1]);
      prevSorted.forEach(([userId], index) => {
        previousRanks.set(userId, index + 1);
      });
    }

    // Build standings array with gap to position above
    const standingsData: StandingEntry[] = sorted.map(([userId, data], index) => {
      const currentRank = index + 1;
      const prevRank = previousRanks.get(userId) || currentRank;
      const rankChange = prevRank - currentRank; // Positive = moved up

      // Gap to position above (not leader)
      const positionAbovePoints = index > 0 ? sorted[index - 1][1].newOverall : data.newOverall;
      const gap = positionAbovePoints - data.newOverall;

      return {
        rank: currentRank,
        userId,
        teamName: userNames.get(userId) || "Unknown",
        oldOverall: data.oldOverall,
        racePoints: data.racePoints,
        newOverall: data.newOverall,
        gap,
        rankChange,
      };
    });

    return standingsData;
  }, [allScores, completedRaces, selectedRaceIndex, userNames]);

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

  // Navigate to results page for a specific race
  const navigateToResults = (raceId: string) => {
    router.push(`/results?race=${raceId}`);
  };

  const selectedRace = completedRaces[selectedRaceIndex];
  const racesCompleted = selectedRaceIndex + 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-2xl font-headline">Season Standings</CardTitle>
              <CardDescription>
                {completedRaces.length > 0 ? (
                  <>
                    After {racesCompleted} of {RaceSchedule.length} races
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
          {completedRaces.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Select race to view cumulative standings:</p>
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-1 pb-2">
                  {completedRaces.map((race, index) => (
                    <Button
                      key={race.raceId}
                      variant={index === selectedRaceIndex ? "default" : "outline"}
                      size="sm"
                      className="flex-shrink-0 text-xs px-2 py-1 h-7"
                      onClick={() => {
                        setSelectedRaceIndex(index);
                        setDisplayCount(PAGE_SIZE);
                      }}
                      title={race.name}
                    >
                      R{index + 1}
                    </Button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              {selectedRace && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {selectedRace.name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => navigateToResults(selectedRace.raceId)}
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
              <TableHead className="text-right hidden sm:table-cell">Old Overall</TableHead>
              <TableHead className="text-right">{selectedRace ? `R${selectedRaceIndex + 1}` : 'Race'}</TableHead>
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
                  <TableCell className="font-semibold">{team.teamName}</TableCell>
                  <TableCell className="text-right text-muted-foreground hidden sm:table-cell">
                    {selectedRaceIndex > 0 ? team.oldOverall : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs font-mono text-accent"
                      onClick={() => selectedRace && navigateToResults(selectedRace.raceId)}
                      title={`View ${selectedRace?.name} results`}
                    >
                      +{team.racePoints}
                    </Button>
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
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
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
