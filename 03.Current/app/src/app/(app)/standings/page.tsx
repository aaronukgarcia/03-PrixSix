
"use client";

import { useMemo, useState, useEffect } from "react";
import { useCollection, useFirestore } from "@/firebase";
import type { User } from "@/firebase/provider";
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
  import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Minus } from "lucide-react";
  import { Skeleton } from "@/components/ui/skeleton";
import { collection, query } from "firebase/firestore";
import { LastUpdated } from "@/components/ui/last-updated";
  
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

interface Score {
    userId: string;
    totalPoints: number;
}
  
export default function StandingsPage() {
    const firestore = useFirestore();
    const currentRace = findNextRace();

    const scoresQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "scores"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const usersQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "users"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: scores, isLoading: isLoadingScores } = useCollection<Score>(scoresQuery);
    const { data: users, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);

    // Track when data was last loaded
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    useEffect(() => {
        if (scores && users && !isLoadingScores && !isLoadingUsers) {
            setLastUpdated(new Date());
        }
    }, [scores, users, isLoadingScores, isLoadingUsers]);

    const standingsData = useMemo(() => {
        if (!scores || !users) return [];
        
        const userPoints = users.map(user => {
            const userScores = scores.filter(score => score.userId === user.id);
            const totalPoints = userScores.reduce((acc, score) => acc + score.totalPoints, 0);
            return {
                userId: user.id,
                teamName: user.teamName,
                totalPoints: totalPoints
            };
        });

        const sortedUsers = [...userPoints].sort((a, b) => b.totalPoints - a.totalPoints);
        
        const leaderPoints = sortedUsers.length > 0 ? sortedUsers[0].totalPoints : 0;

        return sortedUsers.map((user, index) => ({
            rank: index + 1,
            teamName: user.teamName,
            oldOverall: 0, // Placeholder
            racePoints: 0, // Placeholder
            newOverall: user.totalPoints,
            gap: index > 0 ? leaderPoints - user.totalPoints : 0,
            rankChange: 0, // Placeholder
        }));

    }, [scores, users]);

    const isLoading = isLoadingScores || isLoadingUsers;
  
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
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px] text-center">Rank</TableHead>
                <TableHead className="w-[50px] text-center">Move</TableHead>
                <TableHead>Team Name</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">Race Pts</TableHead>
                <TableHead className="text-right">Overall</TableHead>
                <TableHead className="text-right">Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 7 }).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-10 mx-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-5 mx-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-32"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-12 ml-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-12 ml-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-16 ml-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-12 ml-auto"/></TableCell>
                    </TableRow>
                ))
              ) : standingsData.map((team) => (
                <TableRow key={team.teamName}>
                  <TableCell className="text-center font-medium">{team.rank}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center">
                      <RankChangeIndicator change={team.rankChange} />
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">{team.teamName}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{team.oldOverall}</TableCell>
                  <TableCell className="text-right font-medium text-accent">+{team.racePoints}</TableCell>
                  <TableCell className="text-right font-bold text-lg">{team.newOverall}</TableCell>
                  <TableCell className="text-right">{team.gap > 0 ? `-${team.gap}`: '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }
