"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
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
import { calculateDriverPoints, SCORING_POINTS } from "@/lib/scoring-rules";
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
import { CalendarClock, Trophy, ChevronDown, Loader2, ArrowUpDown, Zap, Flag, Medal } from "lucide-react";
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

// Score types for color coding
type ScoreType = 'A' | 'B' | 'C' | 'D' | 'E';  // A=exact(+6), B=1off(+4), C=2off(+3), D=3+off(+2), E=notInTop6(0)

interface DriverPrediction {
    driverId: string;
    driverName: string;
    position: number; // P1, P2, etc.
    actualPosition: number; // -1 if not in top 6
    isCorrect: boolean;
    isExactPosition: boolean;
    points: number;
    scoreType: ScoreType;
}

interface TeamResult {
    teamName: string;
    oduserId: string;
    predictions: DriverPrediction[];
    totalPoints: number | null;
    breakdown: string;
    hasScore: boolean;
    bonusPoints: number; // 0 or 10 (all 6 correct)
    rank?: number; // Rank for this race (1st, 2nd, 3rd get badges)
}

const PAGE_SIZE = 25;

// Race Result Rank Badge Component (1st, 2nd, 3rd place badges)
const RaceRankBadge = ({ rank }: { rank: number }) => {
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

// Loading fallback for Suspense boundary
function ResultsLoadingFallback() {
    return (
        <div className="container mx-auto py-6">
            <div className="flex items-center justify-between mb-6">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-10 w-40" />
            </div>
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-64" />
                    <Skeleton className="h-4 w-48 mt-2" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map(i => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function ResultsContent() {
    const firestore = useFirestore();
    const searchParams = useSearchParams();
    const { selectedLeague } = useLeague();
    const pastEvents = allRaceEvents.filter(event => new Date(event.raceTime) < new Date());

    // Check for race query parameter from URL (e.g., from Standings page navigation)
    const raceFromUrl = searchParams.get('race');

    // Track the most recent race with admin-entered results
    const [mostRecentResultRaceId, setMostRecentResultRaceId] = useState<string | null>(null);
    const [racesWithResults, setRacesWithResults] = useState<Set<string>>(new Set());
    const [isLoadingMostRecent, setIsLoadingMostRecent] = useState(!raceFromUrl); // Only load if no URL param

    // Fetch all race results to know which races to show in dropdown
    useEffect(() => {
        if (!firestore) return;

        const fetchRacesWithResults = async () => {
            try {
                const resultsSnapshot = await getDocs(collection(firestore, "race_results"));
                const resultIds = new Set<string>();
                let mostRecentId: string | null = null;
                let mostRecentTime: any = null;

                resultsSnapshot.forEach(doc => {
                    // Convert result ID to event ID format
                    const eventId = allRaceEvents.find(e => e.id.toLowerCase() === doc.id.toLowerCase())?.id;
                    if (eventId) {
                        resultIds.add(eventId);
                        // Track most recent by submittedAt
                        const data = doc.data();
                        if (!mostRecentTime || (data.submittedAt && data.submittedAt > mostRecentTime)) {
                            mostRecentTime = data.submittedAt;
                            mostRecentId = eventId;
                        }
                    }
                });

                setRacesWithResults(resultIds);
                if (!raceFromUrl && mostRecentId) {
                    setMostRecentResultRaceId(mostRecentId);
                }
            } catch (error) {
                console.error("Error fetching races with results:", error);
            } finally {
                setIsLoadingMostRecent(false);
            }
        };

        fetchRacesWithResults();
    }, [firestore, raceFromUrl]);

    // Filter events to only show those with results
    const eventsWithResults = useMemo(() => {
        return allRaceEvents.filter(event => racesWithResults.has(event.id));
    }, [racesWithResults]);

    // Calculate default race ID: URL param > most recent result > most recent past event > first event
    const defaultRaceId = useMemo(() => {
        if (raceFromUrl) return raceFromUrl;
        if (mostRecentResultRaceId) return mostRecentResultRaceId;
        if (pastEvents.length > 0) return pastEvents[pastEvents.length - 1].id;
        return allRaceEvents[0].id;
    }, [raceFromUrl, mostRecentResultRaceId, pastEvents]);

    const [selectedRaceId, setSelectedRaceId] = useState(defaultRaceId);

    // Update selected race when default changes (e.g., after fetching most recent result)
    useEffect(() => {
        if (!raceFromUrl && mostRecentResultRaceId && selectedRaceId !== mostRecentResultRaceId) {
            setSelectedRaceId(mostRecentResultRaceId);
        }
    }, [mostRecentResultRaceId, raceFromUrl, selectedRaceId]);
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
    // Normalize to title case to match how predictions are stored
    const getBaseRaceId = (eventId: string) => {
        const base = eventId.replace(/-GP$/i, '').replace(/-Sprint$/i, '');
        // Convert to title case: "spanish-grand-prix" -> "Spanish-Grand-Prix"
        return base.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join('-');
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

    // Helper to get score type based on position difference
    const getScoreType = (predictedPosition: number, actualPosition: number): ScoreType => {
        if (actualPosition === -1) return 'E';  // Not in top 6
        const diff = Math.abs(predictedPosition - actualPosition);
        if (diff === 0) return 'A';  // Exact
        if (diff === 1) return 'B';  // 1 off
        if (diff === 2) return 'C';  // 2 off
        return 'D';  // 3+ off
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

            // Use the correct position-based scoring from scoring-rules.ts
            const points = calculateDriverPoints(index, actualIndex);
            const scoreType = getScoreType(index, actualIndex);

            return {
                driverId: normalizedDriverId,
                driverName: driver?.name || driverId,
                position: index + 1,
                actualPosition: actualIndex,
                isCorrect,
                isExactPosition,
                points,
                scoreType,
            };
        });
    }, []);

    // Calculate bonus points (only if all 6 correct)
    const calculateBonus = (correctCount: number): number => {
        if (correctCount === 6) return SCORING_POINTS.bonusAll6;
        return 0;
    };

    // Get color class for score type
    const getScoreTypeColor = (scoreType: ScoreType): string => {
        switch (scoreType) {
            case 'A': return 'text-green-500';      // Exact (+6)
            case 'B': return 'text-lime-500';       // 1 off (+4)
            case 'C': return 'text-yellow-500';     // 2 off (+3)
            case 'D': return 'text-orange-500';     // 3+ off (+2)
            case 'E': return 'text-red-400';        // Not in top 6 (0)
            default: return 'text-muted-foreground';
        }
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
            const scoreRaceId = selectedRaceId.toLowerCase(); // Scores stored with lowercase raceId

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

    // Calculate effective points for a team (uses stored score or calculates from predictions)
    const getEffectivePoints = useCallback((team: TeamResult): number => {
        if (team.hasScore && team.totalPoints !== null) {
            return team.totalPoints;
        }
        if (raceResult) {
            // Calculate points from predictions + bonus
            return team.predictions.reduce((sum, p) => sum + p.points, 0) + team.bonusPoints;
        }
        return -1; // No score and no results yet - sort to bottom
    }, [raceResult]);

    // Sort teams based on sortBy state and assign ranks (for badges)
    const sortedTeams = useMemo(() => {
        const sorted = [...filteredTeams].sort((a, b) => {
            if (sortBy === 'points') {
                // Sort by effective points descending (no results at bottom)
                const aPoints = getEffectivePoints(a);
                const bPoints = getEffectivePoints(b);
                return bPoints - aPoints;
            } else {
                // Sort by team name ascending
                return a.teamName.localeCompare(b.teamName);
            }
        });

        // Assign ranks with proper tie handling (only when sorted by points)
        if (sortBy === 'points') {
            let currentRank = 1;
            let lastPoints = -Infinity;
            return sorted.map((team, index) => {
                const teamPoints = getEffectivePoints(team);
                // Only increment rank if points are different from previous
                if (teamPoints !== lastPoints) {
                    currentRank = index + 1;
                    lastPoints = teamPoints;
                }
                return { ...team, rank: teamPoints >= 0 ? currentRank : undefined };
            });
        }

        // When sorted by name, no ranks
        return sorted.map(team => ({ ...team, rank: undefined }));
    }, [filteredTeams, sortBy, getEffectivePoints]);

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
                 <div className="flex flex-col sm:flex-row gap-2 items-center">
                   <LeagueSelector className="w-full sm:w-[180px]" />
                   <div className="relative w-full sm:w-[280px]">
                     <Select value={selectedRaceId} onValueChange={setSelectedRaceId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a race or sprint" />
                      </SelectTrigger>
                      <SelectContent>
                        {eventsWithResults.length > 0 ? (
                          eventsWithResults.map((event) => (
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
                          ))
                        ) : (
                          <SelectItem value="none" disabled>
                            No results available yet
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {isLoading && (
                      <div className="absolute right-10 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                   </div>
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
                        <TableCell className="font-semibold">
                            <span className="flex items-center">
                                {team.teamName}
                                {team.rank && <RaceRankBadge rank={team.rank} />}
                            </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                            <div className="flex flex-wrap gap-1">
                                {team.predictions.map((pred, i) => (
                                    <span key={i} className="inline-flex items-center">
                                        <span className={pred.isCorrect ? "text-foreground" : "text-muted-foreground"}>
                                            P{pred.position}: {pred.driverName}
                                        </span>
                                        <span className={`font-bold ml-0.5 ${getScoreTypeColor(pred.scoreType)}`}>
                                            +{pred.points}
                                        </span>
                                        {i < team.predictions.length - 1 && <span className="text-muted-foreground mr-1">,</span>}
                                    </span>
                                ))}
                                {team.bonusPoints > 0 && (
                                    <span className="text-amber-400 font-bold ml-1">
                                        Bonus+{team.bonusPoints}
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

// Wrap ResultsContent in Suspense to handle useSearchParams
export default function ResultsPage() {
    return (
        <Suspense fallback={<ResultsLoadingFallback />}>
            <ResultsContent />
        </Suspense>
    );
}
