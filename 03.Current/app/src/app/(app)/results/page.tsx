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
import { RaceSchedule, F1Drivers } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, query, where, doc, getDoc, getDocs, orderBy, limit, startAfter, getCountFromServer, DocumentSnapshot } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Trophy, ChevronDown, Loader2, ArrowUpDown } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface Score {
    id: string;
    oduserId: string;
    teamName: string;
    raceId: string;
    totalPoints: number;
    breakdown: string;
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

interface TeamResult {
    teamName: string;
    oduserId: string;
    prediction: string;
    totalPoints: number | null;
    breakdown: string;
    hasScore: boolean;
}

const PAGE_SIZE = 25;

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

    // Race result state
    const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
    const [isLoadingResult, setIsLoadingResult] = useState(false);

    // Pagination state
    const [teams, setTeams] = useState<TeamResult[]>([]);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Scores cache for current race (fetched once)
    const [scoresMap, setScoresMap] = useState<Map<string, Score>>(new Map());
    const [scoresLoaded, setScoresLoaded] = useState(false);

    // Sort state
    const [sortBy, setSortBy] = useState<'teamName' | 'points'>('points');

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

    // Format predictions for display
    const formatPrediction = useCallback((predictions: any) => {
        if (!predictions) return "N/A";
        // Handle object format {P1, P2, ...}
        if (predictions.P1 !== undefined) {
            return `P1: ${predictions.P1 || '?'}, P2: ${predictions.P2 || '?'}, P3: ${predictions.P3 || '?'}, P4: ${predictions.P4 || '?'}, P5: ${predictions.P5 || '?'}, P6: ${predictions.P6 || '?'}`;
        }
        // Handle array format
        if (Array.isArray(predictions)) {
            return predictions.map((d, i) => `P${i + 1}: ${d}`).join(', ');
        }
        return String(predictions);
    }, []);

    // Fetch all data for selected race in one effect
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        const fetchAllData = async () => {
            setIsLoading(true);
            setTeams([]);
            setLastDoc(null);
            setScoresLoaded(false);

            try {
                // Fetch count, scores, and first page of submissions in parallel
                const [countResult, scoresResult, submissionsResult] = await Promise.all([
                    // Count query
                    getCountFromServer(query(
                        collection(firestore, "prediction_submissions"),
                        where("raceId", "==", selectedRaceId)
                    )),
                    // Scores query
                    getDocs(query(
                        collection(firestore, "scores"),
                        where("raceId", "==", selectedRaceId)
                    )),
                    // First page of submissions
                    getDocs(query(
                        collection(firestore, "prediction_submissions"),
                        where("raceId", "==", selectedRaceId),
                        orderBy("teamName"),
                        limit(PAGE_SIZE)
                    ))
                ]);

                // Process count
                setTotalCount(countResult.data().count);

                // Process scores into map
                const newScoresMap = new Map<string, Score>();
                scoresResult.forEach(doc => {
                    const data = doc.data();
                    newScoresMap.set(data.oduserId, {
                        id: doc.id,
                        ...data,
                    } as Score);
                });
                setScoresMap(newScoresMap);
                setScoresLoaded(true);

                // Process submissions
                if (submissionsResult.empty) {
                    setHasMore(false);
                    setTeams([]);
                } else {
                    setLastDoc(submissionsResult.docs[submissionsResult.docs.length - 1]);
                    setHasMore(submissionsResult.docs.length === PAGE_SIZE);

                    const newTeams: TeamResult[] = submissionsResult.docs.map((doc) => {
                        const data = doc.data();
                        const score = newScoresMap.get(data.oduserId);
                        return {
                            teamName: data.teamName || "Unknown Team",
                            oduserId: data.oduserId,
                            prediction: formatPrediction(data.predictions),
                            totalPoints: score?.totalPoints ?? null,
                            breakdown: score?.breakdown || '',
                            hasScore: !!score,
                        };
                    });
                    setTeams(newTeams);
                }

                setLastUpdated(new Date());
            } catch (error) {
                console.error("Error fetching data:", error);
                setTotalCount(null);
                setScoresMap(new Map());
                setTeams([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAllData();
    }, [firestore, selectedRaceId, formatPrediction]);

    // Load more function for pagination
    const loadMore = useCallback(async () => {
        if (!firestore || !lastDoc || isLoadingMore) return;

        setIsLoadingMore(true);

        try {
            const submissionsQuery = query(
                collection(firestore, "prediction_submissions"),
                where("raceId", "==", selectedRaceId),
                orderBy("teamName"),
                startAfter(lastDoc),
                limit(PAGE_SIZE)
            );

            const snapshot = await getDocs(submissionsQuery);

            if (snapshot.docs.length > 0) {
                setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
            }
            setHasMore(snapshot.docs.length === PAGE_SIZE);

            const newTeams: TeamResult[] = snapshot.docs.map((doc) => {
                const data = doc.data();
                const score = scoresMap.get(data.oduserId);
                return {
                    teamName: data.teamName || "Unknown Team",
                    oduserId: data.oduserId,
                    prediction: formatPrediction(data.predictions),
                    totalPoints: score?.totalPoints ?? null,
                    breakdown: score?.breakdown || '',
                    hasScore: !!score,
                };
            });

            setTeams((prev) => [...prev, ...newTeams]);
            setLastUpdated(new Date());
        } catch (error) {
            console.error("Error loading more:", error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [firestore, selectedRaceId, lastDoc, isLoadingMore, scoresMap, formatPrediction]);

    const progressPercent = totalCount && totalCount > 0
        ? Math.round((teams.length / totalCount) * 100)
        : 0;

    // Sort teams based on sortBy state
    const sortedTeams = [...teams].sort((a, b) => {
        if (sortBy === 'points') {
            // Sort by points descending (nulls/waiting at bottom)
            const aPoints = a.totalPoints ?? -1;
            const bPoints = b.totalPoints ?? -1;
            return bPoints - aPoints;
        } else {
            // Sort by team name ascending
            return a.teamName.localeCompare(b.teamName);
        }
    });

    const toggleSort = () => {
        setSortBy(prev => prev === 'teamName' ? 'points' : 'teamName');
    };

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
          <CardContent className="space-y-4">
          {/* Progress indicator */}
          {!isLoading && totalCount && totalCount > PAGE_SIZE && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {teams.length} of {totalCount} teams</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          {/* Sort toggle */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={toggleSort} className="gap-2">
              <ArrowUpDown className="h-4 w-4" />
              Sort by: {sortBy === 'points' ? 'Points' : 'Team Name'}
            </Button>
          </div>

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
              ) : sortedTeams.length > 0 ? (
                sortedTeams.map((team, index) => (
                    <TableRow key={`${team.teamName}-${team.oduserId}-${index}`}>
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

          {/* Load more button */}
          {hasMore && !isLoading && teams.length > 0 && (
            <div className="flex justify-center pt-4">
              {isLoadingMore ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : (
                <Button variant="outline" onClick={loadMore} className="gap-2">
                  <ChevronDown className="h-4 w-4" />
                  Load More Teams
                </Button>
              )}
            </div>
          )}
          </CardContent>
        </Card>
      </div>
    );
  }
