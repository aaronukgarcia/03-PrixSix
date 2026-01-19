
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
import { RaceSchedule, F1Drivers } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, query, where, doc, getDoc, getDocs } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Trophy } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";

interface Score {
    id: string;
    userId: string;
    raceId: string;
    totalPoints: number;
    breakdown: string;
}

interface Prediction {
    id: string;
    userId: string;
    teamName: string;
    raceId: string;
    driver1: string;
    driver2: string;
    driver3: string;
    driver4: string;
    driver5: string;
    driver6: string;
}

interface RaceResult {
    id: string;
    raceId: string;
    driver1: string;
    driver2: string;
    driver3: string;
    driver4: string;
    driver5: string;
    driver6: string;
    submittedAt: any;
}

export default function ResultsPage() {
    const firestore = useFirestore();
    const pastRaces = RaceSchedule.filter(race => new Date(race.raceTime) < new Date());
    // Use first race if no past races yet (season hasn't started)
    const defaultRaceId = pastRaces.length > 0
        ? pastRaces[pastRaces.length - 1].name.replace(/\s+/g, '-')
        : RaceSchedule[0].name.replace(/\s+/g, '-');
    const [selectedRaceId, setSelectedRaceId] = useState(defaultRaceId);
    const selectedRaceName = RaceSchedule.find(r => r.name.replace(/\s+/g, '-') === selectedRaceId)?.name;
    const hasSeasonStarted = pastRaces.length > 0;
    const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
    const [isLoadingResult, setIsLoadingResult] = useState(false);

    // Fetch race result when selection changes
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        const fetchRaceResult = async () => {
            setIsLoadingResult(true);
            try {
                const resultId = selectedRaceId.toLowerCase();
                const resultDocRef = doc(firestore, "race_results", resultId);
                const resultDoc = await getDoc(resultDocRef);
                if (resultDoc.exists()) {
                    setRaceResult(resultDoc.data() as RaceResult);
                } else {
                    setRaceResult(null);
                }
            } catch (error) {
                console.error("Error fetching race result:", error);
                setRaceResult(null);
            } finally {
                setIsLoadingResult(false);
            }
        };

        fetchRaceResult();
    }, [firestore, selectedRaceId]);

    const formatResultTimestamp = (timestamp: any) => {
        if (!timestamp) return null;
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getOfficialResult = () => {
        if (!raceResult) return null;
        const drivers = [
            raceResult.driver1,
            raceResult.driver2,
            raceResult.driver3,
            raceResult.driver4,
            raceResult.driver5,
            raceResult.driver6
        ];
        return drivers.map((driverId, index) => {
            const driver = F1Drivers.find(d => d.id === driverId);
            return `P${index + 1}: ${driver?.name || driverId}`;
        }).join(' | ');
    };

    const scoresQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(
            collection(firestore, "scores"),
            where("raceId", "==", selectedRaceId)
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

    // Fetch predictions for all users for this race (avoiding collectionGroup query)
    const [predictions, setPredictions] = useState<Prediction[]>([]);
    const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    useEffect(() => {
        if (!firestore || !users || users.length === 0 || !selectedRaceId) {
            setPredictions([]);
            return;
        }

        const fetchPredictions = async () => {
            setIsLoadingPredictions(true);
            try {
                const allPredictions: Prediction[] = [];

                // Fetch each user's prediction for this race
                for (const user of users) {
                    const predQuery = query(
                        collection(firestore, `users/${user.id}/predictions`),
                        where("raceId", "==", selectedRaceId)
                    );
                    const predSnapshot = await getDocs(predQuery);
                    predSnapshot.forEach(predDoc => {
                        allPredictions.push({
                            id: predDoc.id,
                            ...predDoc.data(),
                            userId: user.id,
                            teamName: (predDoc.data() as any).teamName || user.teamName,
                        } as Prediction);
                    });
                }

                setPredictions(allPredictions);
                setLastUpdated(new Date());
            } catch (error) {
                console.error("Error fetching predictions:", error);
                setPredictions([]);
            } finally {
                setIsLoadingPredictions(false);
            }
        };

        fetchPredictions();
    }, [firestore, users, selectedRaceId]);

    // Format predictions for display
    const formatPrediction = (pred: Prediction) => {
        const drivers = [pred.driver1, pred.driver2, pred.driver3, pred.driver4, pred.driver5, pred.driver6];
        return drivers.map((driverId, i) => {
            const driver = F1Drivers.find(d => d.id === driverId);
            return `P${i + 1}: ${driver?.name || 'N/A'}`;
        }).join(', ');
    };

    // Combine predictions with scores to show all teams
    const teamsWithResults = useMemo(() => {
        if (!users) return [];

        const teamData: {
            teamName: string;
            prediction: string;
            totalPoints: number | null;
            breakdown: string;
            hasScore: boolean;
        }[] = [];

        // Go through all predictions for this race
        predictions?.forEach(pred => {
            const score = scores?.find(s => s.userId === pred.userId);
            const user = users.find(u => u.id === pred.userId);

            teamData.push({
                teamName: pred.teamName || user?.teamName || 'Unknown',
                prediction: formatPrediction(pred),
                totalPoints: score?.totalPoints ?? null,
                breakdown: score?.breakdown || '',
                hasScore: !!score,
            });
        });

        // Sort: scored teams first (by points desc), then unscored teams
        return teamData.sort((a, b) => {
            if (a.hasScore && !b.hasScore) return -1;
            if (!a.hasScore && b.hasScore) return 1;
            if (a.hasScore && b.hasScore) {
                return (b.totalPoints || 0) - (a.totalPoints || 0);
            }
            return a.teamName.localeCompare(b.teamName);
        });
    }, [predictions, scores, users]);

    const isLoading = isLoadingScores || isLoadingUsers || (users && users.length > 0 && isLoadingPredictions);

    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
            Race Results
          </h1>
          <p className="text-muted-foreground">
            View points breakdown and standings for each race.
          </p>
        </div>
        <Card>
          <CardHeader>
             <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="w-5 h-5" />
                    {selectedRaceName}
                  </CardTitle>
                  <CardDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span>{hasSeasonStarted ? "Points breakdown for this race." : "Season has not started yet."}</span>
                    <LastUpdated timestamp={lastUpdated} />
                  </CardDescription>
                </div>
                 <Select value={selectedRaceId} onValueChange={setSelectedRaceId}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Select a race" />
                  </SelectTrigger>
                  <SelectContent>
                    {RaceSchedule.map((race) => (
                      <SelectItem key={race.name} value={race.name.replace(/\s+/g, '-')}>
                        {race.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>

             {/* Official Result Display */}
             {isLoadingResult ? (
               <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                 <Skeleton className="h-4 w-full" />
               </div>
             ) : raceResult ? (
               <div className="mt-4 p-4 bg-muted/50 rounded-lg space-y-2">
                 <div className="flex items-center gap-2 text-sm font-medium">
                   <Trophy className="w-4 h-4 text-accent" />
                   Official Result
                 </div>
                 <p className="text-sm font-mono">{getOfficialResult()}</p>
                 <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <CalendarClock className="w-3 h-3" />
                   Results posted: {formatResultTimestamp(raceResult.submittedAt)}
                 </div>
               </div>
             ) : (
               <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                 <p className="text-sm text-muted-foreground">No official results entered for this race yet.</p>
               </div>
             )}
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Prediction (P1-P6)</TableHead>
                <TableHead className="text-center">Points</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-full"/></TableCell>
                        <TableCell><Skeleton className="h-5 w-20 mx-auto"/></TableCell>
                    </TableRow>
                ))
              ) : teamsWithResults.length > 0 ? (
                teamsWithResults.map((team, index) => (
                    <TableRow key={`${team.teamName}-${index}`}>
                        <TableCell className="font-semibold">{team.teamName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                            {team.prediction}
                        </TableCell>
                        <TableCell className="text-center">
                            {team.hasScore ? (
                                <span className="font-bold text-lg text-accent">{team.totalPoints}</span>
                            ) : (
                                <Badge variant="outline" className="text-muted-foreground">
                                    Waiting for results
                                </Badge>
                            )}
                        </TableCell>
                    </TableRow>
                ))
              ) : (
                <TableRow>
                    <TableCell colSpan={3} className="text-center h-24 text-muted-foreground">
                        No predictions found for this race yet.
                    </TableCell>
                </TableRow>
              )}
            </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }
