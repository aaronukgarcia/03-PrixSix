// GUID: PAGE_RESULTS-000-v05
// [Intent] Race Results page — displays per-race points breakdowns for all teams' predictions,
//   with official race results, colour-coded scoring, rank badges, sorting, and pagination.
// [Inbound Trigger] Navigation to /results route; optionally receives ?race= URL parameter from
//   Standings page navigation.
// [Downstream Impact] Reads from Firestore race_results, scores, and predictions collections.
//   No write operations — this is a read-only view.
// @FIX(v05) Extracted shared types, functions, and constants to @/lib/results-utils for reuse
//   by the new /my-results page. No behaviour change — imports replace inline definitions.

"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
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
import { F1Drivers } from "@/lib/data";
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
import {
    type ScoreType,
    type DriverPrediction,
    type RaceResult,
    type Score,
    type TeamResult,
    allRaceEvents,
    getScoreType,
    getScoreTypeColor,
    parsePredictions as parsePredictionsPure,
    calculateBonus,
    getEffectivePoints as getEffectivePointsPure,
    formatResultTimestamp,
    getBaseRaceId,
    RaceRankBadge,
} from "@/lib/results-utils";

// GUID: PAGE_RESULTS-006-v03
// [Intent] Page size constant for Firestore query pagination of prediction documents.
const PAGE_SIZE = 25;

// GUID: PAGE_RESULTS-010-v03
// [Intent] Suspense loading fallback — skeleton UI shown while ResultsContent loads.
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

// GUID: PAGE_RESULTS-011-v05
// [Intent] Main results content component — fetches race results, scores, and predictions from
//   Firestore, computes per-driver scoring against actual results, and renders the results table
//   with colour-coded breakdowns, sorting, and pagination.
function ResultsContent() {
    const firestore = useFirestore();
    const searchParams = useSearchParams();
    const { selectedLeague } = useLeague();
    const pastEvents = allRaceEvents.filter(event => new Date(event.raceTime) < new Date());

    const rawRaceFromUrl = searchParams.get('race');
    const raceFromUrl = rawRaceFromUrl
        ? allRaceEvents.find(e => e.id.toLowerCase() === rawRaceFromUrl.toLowerCase())?.id ?? rawRaceFromUrl
        : null;

    const [mostRecentResultRaceId, setMostRecentResultRaceId] = useState<string | null>(null);
    const [racesWithResults, setRacesWithResults] = useState<Set<string>>(new Set());
    const [isLoadingMostRecent, setIsLoadingMostRecent] = useState(!raceFromUrl);

    // GUID: PAGE_RESULTS-012-v03
    useEffect(() => {
        if (!firestore) return;

        const fetchRacesWithResults = async () => {
            try {
                const resultsSnapshot = await getDocs(collection(firestore, "race_results"));
                const resultIds = new Set<string>();
                let mostRecentId: string | null = null;
                let mostRecentTime: any = null;

                resultsSnapshot.forEach(doc => {
                    const eventId = allRaceEvents.find(e => e.id.toLowerCase() === doc.id.toLowerCase())?.id;
                    if (eventId) {
                        resultIds.add(eventId);
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

    // GUID: PAGE_RESULTS-013-v03
    const eventsWithResults = useMemo(() => {
        return allRaceEvents.filter(event => racesWithResults.has(event.id));
    }, [racesWithResults]);

    // GUID: PAGE_RESULTS-014-v03
    const defaultRaceId = useMemo(() => {
        if (raceFromUrl) return raceFromUrl;
        if (mostRecentResultRaceId) return mostRecentResultRaceId;
        if (pastEvents.length > 0) return pastEvents[pastEvents.length - 1].id;
        return allRaceEvents[0].id;
    }, [raceFromUrl, mostRecentResultRaceId, pastEvents]);

    const [selectedRaceId, setSelectedRaceId] = useState(defaultRaceId);
    const initialRaceApplied = useRef(!!raceFromUrl);

    // GUID: PAGE_RESULTS-015-v04
    useEffect(() => {
        if (!initialRaceApplied.current && mostRecentResultRaceId) {
            setSelectedRaceId(mostRecentResultRaceId);
            initialRaceApplied.current = true;
        }
    }, [mostRecentResultRaceId]);
    const selectedEvent = allRaceEvents.find(e => e.id === selectedRaceId);
    const selectedRaceName = selectedEvent?.label || selectedRaceId;
    const hasSeasonStarted = pastEvents.length > 0;

    // Race result state
    const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
    const [isLoadingResult, setIsLoadingResult] = useState(false);

    // Pagination state
    const [rawPredictionDocs, setRawPredictionDocs] = useState<any[]>([]);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Scores cache
    const [scoresMap, setScoresMap] = useState<Map<string, Score>>(new Map());
    const [scoresLoaded, setScoresLoaded] = useState(false);

    // Sort state
    const [sortBy, setSortBy] = useState<'teamName' | 'points'>('points');

    // GUID: PAGE_RESULTS-016-v03
    useEffect(() => {
        if (raceFromUrl && raceFromUrl !== selectedRaceId) {
            setSelectedRaceId(raceFromUrl);
        }
    }, [raceFromUrl]);

    // GUID: PAGE_RESULTS-018-v03
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

    // GUID: PAGE_RESULTS-020-v03
    const getOfficialResult = () => {
        if (!raceResult) return null;
        const drivers = [
            raceResult.driver1, raceResult.driver2, raceResult.driver3,
            raceResult.driver4, raceResult.driver5, raceResult.driver6
        ];
        return drivers.map((driverId, index) => {
            const driver = F1Drivers.find(d => d.id === driverId);
            return `P${index + 1}: ${driver?.name || driverId}`;
        }).join(' | ');
    };

    // GUID: PAGE_RESULTS-022-v05
    // [Intent] Wrap the pure parsePredictions function in useCallback for memoisation stability.
    const parsePredictions = useCallback((predictions: any, actualTop6: string[] | null): DriverPrediction[] => {
        return parsePredictionsPure(predictions, actualTop6);
    }, []);

    // GUID: PAGE_RESULTS-025-v04
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        let cancelled = false;

        const fetchAllData = async () => {
            setIsLoading(true);
            setRawPredictionDocs([]);
            setLastDoc(null);
            setScoresLoaded(false);

            const baseRaceId = getBaseRaceId(selectedRaceId);
            const scoreRaceId = selectedRaceId.toLowerCase();

            try {
                const [countResult, scoresResult, submissionsResult] = await Promise.all([
                    getCountFromServer(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", baseRaceId)
                    )),
                    getDocs(query(
                        collection(firestore, "scores"),
                        where("raceId", "==", scoreRaceId)
                    )),
                    getDocs(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", baseRaceId),
                        orderBy("teamName"),
                        limit(PAGE_SIZE)
                    ))
                ]);

                if (cancelled) return;

                setTotalCount(countResult.data().count);

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

                if (submissionsResult.empty) {
                    setHasMore(false);
                    setRawPredictionDocs([]);
                } else {
                    setLastDoc(submissionsResult.docs[submissionsResult.docs.length - 1]);
                    setHasMore(submissionsResult.docs.length === PAGE_SIZE);
                    setRawPredictionDocs(submissionsResult.docs.map(d => d.data()));
                }

                setLastUpdated(new Date());
            } catch (error) {
                console.error("Error fetching data:", error);
                if (!cancelled) {
                    setTotalCount(null);
                    setScoresMap(new Map());
                    setRawPredictionDocs([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        fetchAllData();
        return () => { cancelled = true; };
    }, [firestore, selectedRaceId]);

    // GUID: PAGE_RESULTS-025B-v04
    const teams = useMemo(() => {
        if (rawPredictionDocs.length === 0) return [] as TeamResult[];

        const actualTop6 = raceResult ? [
            raceResult.driver1, raceResult.driver2, raceResult.driver3,
            raceResult.driver4, raceResult.driver5, raceResult.driver6
        ] : null;

        return rawPredictionDocs.map((data) => {
            const oduserId = data.userId || data.oduserId;
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
    }, [rawPredictionDocs, raceResult, scoresMap, parsePredictions]);

    // GUID: PAGE_RESULTS-026-v04
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

            setRawPredictionDocs(prev => [...prev, ...snapshot.docs.map(d => d.data())]);
            setLastUpdated(new Date());
        } catch (error) {
            console.error("Error loading more:", error);
        } finally {
            setIsLoadingMore(false);
        }
    }, [firestore, selectedRaceId, lastDoc, isLoadingMore]);

    // GUID: PAGE_RESULTS-027-v03
    const filteredTeams = useMemo(() => {
        if (!selectedLeague || selectedLeague.isGlobal) {
            return teams;
        }
        return teams.filter(team => selectedLeague.memberUserIds.includes(team.oduserId));
    }, [teams, selectedLeague]);

    const progressPercent = totalCount && totalCount > 0
        ? Math.round((filteredTeams.length / totalCount) * 100)
        : 0;

    // GUID: PAGE_RESULTS-028-v05
    // [Intent] Wrap the pure getEffectivePoints with raceResult context for sorting.
    const getEffectivePointsForTeam = useCallback((team: TeamResult): number => {
        return getEffectivePointsPure(team, !!raceResult);
    }, [raceResult]);

    // GUID: PAGE_RESULTS-029-v03
    const sortedTeams = useMemo(() => {
        const sorted = [...filteredTeams].sort((a, b) => {
            if (sortBy === 'points') {
                const aPoints = getEffectivePointsForTeam(a);
                const bPoints = getEffectivePointsForTeam(b);
                return bPoints - aPoints;
            } else {
                return a.teamName.localeCompare(b.teamName);
            }
        });

        if (sortBy === 'points') {
            let currentRank = 1;
            let lastPoints = -Infinity;
            return sorted.map((team, index) => {
                const teamPoints = getEffectivePointsForTeam(team);
                if (teamPoints !== lastPoints) {
                    currentRank = index + 1;
                    lastPoints = teamPoints;
                }
                return { ...team, rank: teamPoints >= 0 ? currentRank : undefined };
            });
        }

        return sorted.map(team => ({ ...team, rank: undefined }));
    }, [filteredTeams, sortBy, getEffectivePointsForTeam]);

    // GUID: PAGE_RESULTS-030-v03
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
                                        <span className={getScoreTypeColor(pred.scoreType)}>
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

// GUID: PAGE_RESULTS-031-v03
export default function ResultsPage() {
    return (
        <Suspense fallback={<ResultsLoadingFallback />}>
            <ResultsContent />
        </Suspense>
    );
}
