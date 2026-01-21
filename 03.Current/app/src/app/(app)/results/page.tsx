"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
import { RaceSchedule, F1Drivers } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collectionGroup, collection, query, where, doc, getDoc, getDocs, orderBy, limit, startAfter, getCountFromServer, DocumentSnapshot } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Trophy, ChevronDown, Loader2, ArrowUpDown, Zap, Flag } from "lucide-react";
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

interface DriverPrediction {
    driverId: string;
    driverName: string;
    position: number; // P1, P2, etc.
    isCorrect: boolean;
    isExactPosition: boolean;
    points: number; // 0, 3, or 5
}

interface TeamResult {
    teamName: string;
    oduserId: string;
    predictions: DriverPrediction[];
    totalPoints: number | null;
    breakdown: string;
    hasScore: boolean;
    bonusPoints: number; // 0 or 10 (all 6 correct)
}

const PAGE_SIZE = 25;

// Build list of all race events (GP + Sprint where applicable)
function buildRaceEvents() {
    return RaceSchedule.flatMap(race => {
        const events = [];
        if (race.hasSprint) {
            events.push({
                id: `${race.name.replace(/\s+/g, '-')}-Sprint`,
                label: `${race.name} - Sprint`,
                baseName: race.name,
                isSprint: true,
                raceTime: race.qualifyingTime, // Sprint happens before GP
            });
        }
        events.push({
            id: `${race.name.replace(/\s+/g, '-')}-GP`,
            label: `${race.name} - GP`,
            baseName: race.name,
            isSprint: false,
            raceTime: race.raceTime,
        });
        return events;
    });
}

const allRaceEvents = buildRaceEvents();

export default function ResultsPage() {
    const firestore = useFirestore();
    const searchParams = useSearchParams();
    const { selectedLeague } = useLeague();
    const pastEvents = allRaceEvents.filter(event => new Date(event.raceTime) < new Date());

    // Check for race query parameter from URL (e.g., from Standings page navigation)
    const raceFromUrl = searchParams.get('race');

    // Use most recent past event, or first event if season hasn't started
    const defaultRaceId = raceFromUrl || (pastEvents.length > 0
        ? pastEvents[pastEvents.length - 1].id
        : allRaceEvents[0].id);
    const [selectedRaceId, setSelectedRaceId] = useState(defaultRaceId);
    const selectedEvent = allRaceEvents.find(e => e.id === selectedRaceId);
    const selectedRaceName = selectedEvent?.label || selectedRaceId;
    const hasSeasonStarted = pastEvents.length > 0;

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

    // Update selected race when URL parameter changes
    useEffect(() => {
        if (raceFromUrl && raceFromUrl !== selectedRaceId) {
            setSelectedRaceId(raceFromUrl);
        }
    }, [raceFromUrl]);

    // Get base race ID for prediction lookups (without -GP or -Sprint suffix)
    const getBaseRaceId = (eventId: string) => {
        return eventId.replace(/-GP$/, '').replace(/-Sprint$/, '');
    };

    // Fetch race result when selection changes
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        const fetchRaceResult = async () => {
            setIsLoadingResult(true);
            try {
                // Race results are stored with lowercase ID matching the event ID format
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

    // Prix Six scoring constants
    const SCORING = {
        exactPosition: 5,  // +5 for exact position match
        wrongPosition: 3,  // +3 for correct driver but wrong position
        bonusAll6: 10,     // +10 bonus if all 6 correct
    };

    // Parse predictions and calculate per-driver scoring (Prix Six rules)
    const parsePredictions = useCallback((predictions: any, actualTop6: string[] | null): DriverPrediction[] => {
        if (!predictions) return [];

        let driverIds: string[] = [];

        // Handle object format {P1, P2, ...}
        if (predictions.P1 !== undefined) {
            driverIds = [
                predictions.P1, predictions.P2, predictions.P3,
                predictions.P4, predictions.P5, predictions.P6
            ].filter(Boolean);
        }
        // Handle array format
        else if (Array.isArray(predictions)) {
            driverIds = predictions;
        }

        // Normalize actual results to lowercase for comparison
        const normalizedActual = actualTop6 ? actualTop6.map(d => d?.toLowerCase()) : null;

        return driverIds.map((driverId, index) => {
            // Normalize prediction driver ID to lowercase for comparison
            const normalizedDriverId = driverId?.toLowerCase();
            const driver = F1Drivers.find(d => d.id === normalizedDriverId);
            const actualIndex = normalizedActual ? normalizedActual.indexOf(normalizedDriverId) : -1;
            const isCorrect = actualIndex !== -1;
            const isExactPosition = actualIndex === index;

            let points = 0;
            if (isExactPosition) {
                points = SCORING.exactPosition; // +5 for exact
            } else if (isCorrect) {
                points = SCORING.wrongPosition; // +3 for wrong position
            }

            return {
                driverId: normalizedDriverId,
                driverName: driver?.name || driverId,
                position: index + 1,
                isCorrect,
                isExactPosition,
                points,
            };
        });
    }, []);

    // Calculate bonus points (only if all 6 correct)
    const calculateBonus = (correctCount: number): number => {
        if (correctCount === 6) return SCORING.bonusAll6;
        return 0;
    };

    // Fetch all data for selected race in one effect
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        const fetchAllData = async () => {
            setIsLoading(true);
            setTeams([]);
            setLastDoc(null);
            setScoresLoaded(false);

            // Predictions are stored by base race ID, scores by full event ID (with -GP/-Sprint)
            const baseRaceId = getBaseRaceId(selectedRaceId);
            const scoreRaceId = selectedRaceId; // Scores use full ID with suffix

            try {
                // Fetch count, scores, and first page of predictions in parallel
                const [countResult, scoresResult, submissionsResult] = await Promise.all([
                    // Count query - uses base race ID
                    getCountFromServer(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", baseRaceId)
                    )),
                    // Scores query - uses full event ID (GP or Sprint)
                    getDocs(query(
                        collection(firestore, "scores"),
                        where("raceId", "==", scoreRaceId)
                    )),
                    // First page of predictions from user subcollections
                    getDocs(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", baseRaceId),
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

                    // Get actual top 6 from race result for scoring display
                    const actualTop6 = raceResult ? [
                        raceResult.driver1, raceResult.driver2, raceResult.driver3,
                        raceResult.driver4, raceResult.driver5, raceResult.driver6
                    ] : null;

                    const newTeams: TeamResult[] = submissionsResult.docs.map((doc) => {
                        const data = doc.data();
                        const oduserId = data.userId || data.oduserId; // Support both formats
                        const score = newScoresMap.get(oduserId);
                        const predictions = parsePredictions(data.predictions, actualTop6);
                        const correctCount = predictions.filter(p => p.isCorrect).length;
                        return {
                            teamName: data.teamName || "Unknown Team",
                            oduserId,
                            predictions,
                            totalPoints: score?.totalPoints ?? null,
                            breakdown: score?.breakdown || '',
                            hasScore: !!score,
                            bonusPoints: calculateBonus(correctCount),
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
    }, [firestore, selectedRaceId, raceResult, parsePredictions]);

    // Load more function for pagination
    const loadMore = useCallback(async () => {
        if (!firestore || !lastDoc || isLoadingMore) return;

        setIsLoadingMore(true);
        const baseRaceId = getBaseRaceId(selectedRaceId);

        try {
            const submissionsQuery = query(
                collectionGroup(firestore, "predictions"),
                where("raceId", "==", baseRaceId),
                orderBy("teamName"),
                startAfter(lastDoc),
                limit(PAGE_SIZE)
            );

            const snapshot = await getDocs(submissionsQuery);

            if (snapshot.docs.length > 0) {
                setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
            }
            setHasMore(snapshot.docs.length === PAGE_SIZE);

            // Get actual top 6 from race result for scoring display
            const actualTop6 = raceResult ? [
                raceResult.driver1, raceResult.driver2, raceResult.driver3,
                raceResult.driver4, raceResult.driver5, raceResult.driver6
            ] : null;

            const newTeams: TeamResult[] = snapshot.docs.map((doc) => {
                const data = doc.data();
                const oduserId = data.userId || data.oduserId; // Support both formats
                const score = scoresMap.get(oduserId);
                const predictions = parsePredictions(data.predictions, actualTop6);
                const correctCount = predictions.filter(p => p.isCorrect).length;
                return {
                    teamName: data.teamName || "Unknown Team",
                    oduserId,
                    predictions,
                    totalPoints: score?.totalPoints ?? null,
                    breakdown: score?.breakdown || '',
                    hasScore: !!score,
                    bonusPoints: calculateBonus(correctCount),
                };
            });

            setTeams((prev) => [...prev, ...newTeams]);
            setLastUpdated(new Date());
        } catch (error) {
            console.error("Error loading more:", error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [firestore, selectedRaceId, lastDoc, isLoadingMore, scoresMap, parsePredictions, raceResult]);

    // Filter teams by selected league
    const filteredTeams = useMemo(() => {
        if (!selectedLeague || selectedLeague.isGlobal) {
            return teams;
        }
        return teams.filter(team => selectedLeague.memberUserIds.includes(team.oduserId));
    }, [teams, selectedLeague]);

    const progressPercent = totalCount && totalCount > 0
        ? Math.round((filteredTeams.length / totalCount) * 100)
        : 0;

    // Sort teams based on sortBy state
    const sortedTeams = useMemo(() => {
        return [...filteredTeams].sort((a, b) => {
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
    }, [filteredTeams, sortBy]);

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
                  <CardTitle className="flex items-center gap-2 flex-wrap">
                    <Trophy className="w-5 h-5" />
                    {selectedEvent?.baseName || selectedRaceName}
                    {selectedEvent?.isSprint ? (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Sprint
                      </Badge>
                    ) : (
                      <Badge variant="default" className="flex items-center gap-1">
                        <Flag className="h-3 w-3" />
                        Grand Prix
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span>{hasSeasonStarted ? "Points breakdown for this event." : "Season has not started yet."}</span>
                    <LastUpdated timestamp={lastUpdated} />
                  </CardDescription>
                </div>
                 <div className="flex flex-col sm:flex-row gap-2">
                   <LeagueSelector className="w-full sm:w-[180px]" />
                   <Select value={selectedRaceId} onValueChange={setSelectedRaceId}>
                    <SelectTrigger className="w-full sm:w-[280px]">
                      <SelectValue placeholder="Select a race or sprint" />
                    </SelectTrigger>
                  <SelectContent>
                    {allRaceEvents.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        <span className="flex items-center gap-2">
                          {event.isSprint ? (
                            <Zap className="h-3 w-3 text-amber-500" />
                          ) : (
                            <Flag className="h-3 w-3 text-primary" />
                          )}
                          {event.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                 </div>
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
                <span>Showing {filteredTeams.length} of {totalCount} teams</span>
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
                        <TableCell className="text-xs font-mono">
                            <div className="flex flex-wrap gap-1">
                                {team.predictions.map((pred, i) => (
                                    <span key={i} className="inline-flex items-center">
                                        <span className={pred.isCorrect ? "text-foreground" : "text-muted-foreground"}>
                                            P{pred.position}: {pred.driverName}
                                        </span>
                                        {pred.points > 0 && (
                                            <span className={`font-bold ml-0.5 ${pred.isExactPosition ? "text-green-500" : "text-yellow-500"}`}>
                                                +{pred.points}
                                            </span>
                                        )}
                                        {!pred.isCorrect && (
                                            <span className="text-red-400 font-bold ml-0.5">+0</span>
                                        )}
                                        {i < team.predictions.length - 1 && <span className="text-muted-foreground mr-1">,</span>}
                                    </span>
                                ))}
                                {team.bonusPoints > 0 && (
                                    <span className="text-green-500 font-bold ml-1">
                                        BonusAll6+{team.bonusPoints}
                                    </span>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="text-center">
                            {team.hasScore ? (
                                <span className="font-bold text-lg text-accent">{team.totalPoints}</span>
                            ) : raceResult ? (
                                <span className="font-bold text-lg text-accent">
                                    {team.predictions.reduce((sum, p) => sum + p.points, 0) + team.bonusPoints}
                                </span>
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
          {hasMore && !isLoading && filteredTeams.length > 0 && (
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
