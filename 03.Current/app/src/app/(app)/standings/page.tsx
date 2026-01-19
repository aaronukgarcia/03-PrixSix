"use client";

import { useState, useEffect, useCallback } from "react";
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
import { findNextRace } from "@/lib/data";
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus, ChevronDown, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

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

interface StandingEntry {
  rank: number;
  userId: string;
  teamName: string;
  totalPoints: number;
  gap: number;
  rankChange: number;
}

const PAGE_SIZE = 25;

export default function StandingsPage() {
  const firestore = useFirestore();
  const currentRace = findNextRace();

  const [standings, setStandings] = useState<StandingEntry[]>([]);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch and compute standings
  useEffect(() => {
    if (!firestore) return;

    const fetchStandings = async () => {
      setIsLoading(true);

      try {
        // Step 1: Fetch all scores (much smaller than users - just points per race)
        const scoresSnapshot = await getDocs(collection(firestore, "scores"));

        // Step 2: Aggregate scores by userId
        const userTotals = new Map<string, number>();
        scoresSnapshot.forEach((doc) => {
          const data = doc.data();
          const current = userTotals.get(data.userId) || 0;
          userTotals.set(data.userId, current + (data.totalPoints || 0));
        });

        // Step 3: Sort by total points
        const sortedEntries = Array.from(userTotals.entries())
          .sort((a, b) => b[1] - a[1]);

        const leaderPoints = sortedEntries.length > 0 ? sortedEntries[0][1] : 0;

        // Step 4: Fetch team names for all users (we need this for display)
        // Use a batch approach - fetch user docs in parallel
        const userIds = sortedEntries.map(([userId]) => userId);
        const userNames = new Map<string, string>();

        // Fetch in batches of 10 to avoid too many parallel requests
        const batchSize = 10;
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize);
          const promises = batch.map(async (userId) => {
            const userDoc = await getDoc(doc(firestore, "users", userId));
            if (userDoc.exists()) {
              userNames.set(userId, userDoc.data().teamName || "Unknown");
            } else {
              userNames.set(userId, "Unknown Team");
            }
          });
          await Promise.all(promises);
        }

        // Step 5: Build standings array
        const standingsData: StandingEntry[] = sortedEntries.map(([userId, totalPoints], index) => ({
          rank: index + 1,
          userId,
          teamName: userNames.get(userId) || "Unknown",
          totalPoints,
          gap: index > 0 ? leaderPoints - totalPoints : 0,
          rankChange: 0, // TODO: implement rank change tracking
        }));

        setStandings(standingsData);
        setLastUpdated(new Date());
      } catch (error) {
        console.error("Error fetching standings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStandings();
  }, [firestore]);

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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-2xl font-headline">Season Standings</CardTitle>
            <CardDescription>
              Overall leaderboard after the {currentRace.name}.
            </CardDescription>
          </div>
          <LastUpdated timestamp={lastUpdated} />
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
              <TableHead className="w-[80px] text-center">Rank</TableHead>
              <TableHead className="w-[50px] text-center">Move</TableHead>
              <TableHead>Team Name</TableHead>
              <TableHead className="text-right">Total Points</TableHead>
              <TableHead className="text-right">Gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-5 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : displayedStandings.length > 0 ? (
              displayedStandings.map((team) => (
                <TableRow key={team.userId}>
                  <TableCell className="text-center font-medium">{team.rank}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center">
                      <RankChangeIndicator change={team.rankChange} />
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">{team.teamName}</TableCell>
                  <TableCell className="text-right font-bold text-lg">{team.totalPoints}</TableCell>
                  <TableCell className="text-right">{team.gap > 0 ? `-${team.gap}` : '-'}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
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
