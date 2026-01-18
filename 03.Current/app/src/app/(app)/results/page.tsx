
"use client";

import { useMemo, useState } from "react";
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
import { RaceSchedule } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, query, where, orderBy } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";

interface Score {
    id: string;
    userId: string;
    raceId: string;
    totalPoints: number;
    breakdown: string;
}

export default function ResultsPage() {
    const firestore = useFirestore();
    const pastRaces = RaceSchedule.filter(race => new Date(race.raceTime) < new Date());
    const [selectedRaceId, setSelectedRaceId] = useState(pastRaces.length > 0 ? pastRaces[pastRaces.length - 1].name.replace(/\s+/g, '-') : RaceSchedule[RaceSchedule.length-1].name.replace(/\s+/g, '-'));
    const selectedRaceName = RaceSchedule.find(r => r.name.replace(/\s+/g, '-') === selectedRaceId)?.name;

    const scoresQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(
            collection(firestore, "scores"), 
            where("raceId", "==", selectedRaceId),
            orderBy("totalPoints", "desc")
        );
        (q as any).__memo = true;
        return q;
    }, [firestore, selectedRaceId]);

    const usersQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "users"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: scores, isLoading: isLoadingScores } = useCollection<Score>(scoresQuery);
    const { data: users, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);

    const resultsWithTeamNames = useMemo(() => {
        if (!scores || !users) return [];
        return scores.map(score => {
            const user = users.find(u => u.id === score.userId);
            return {
                ...score,
                teamName: user?.teamName || score.userId
            }
        });
    }, [scores, users]);

    const isLoading = isLoadingScores || isLoadingUsers;

    return (
      <Card>
        <CardHeader>
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle className="text-2xl font-headline">Race Results</CardTitle>
                <CardDescription>
                  Points breakdown for the {selectedRaceName}.
                </CardDescription>
              </div>
               <Select value={selectedRaceId} onValueChange={setSelectedRaceId}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Select a race" />
                </SelectTrigger>
                <SelectContent>
                  {[...pastRaces, RaceSchedule[RaceSchedule.length-1]].map((race) => (
                    <SelectItem key={race.name} value={race.name.replace(/\s+/g, '-')}>
                      {race.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
           </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team Name</TableHead>
                <TableHead className="text-right">Total Points</TableHead>
                <TableHead>Breakdown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-12 ml-auto"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-full"/></TableCell>
                    </TableRow>
                ))
              ) : resultsWithTeamNames.length > 0 ? (
                resultsWithTeamNames.map((result) => (
                    <TableRow key={result.id}>
                    <TableCell className="font-semibold">{result.teamName}</TableCell>
                    <TableCell className="text-right font-bold text-lg text-accent">{result.totalPoints}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{result.breakdown}</TableCell>
                    </TableRow>
                ))
              ) : (
                <TableRow>
                    <TableCell colSpan={3} className="text-center h-24">No results found for this race yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }
