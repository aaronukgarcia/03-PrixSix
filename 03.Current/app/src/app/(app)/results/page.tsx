// GUID: PAGE_RESULTS-000-v07
// [Intent] Race Results page — displays per-race points breakdowns for all teams' predictions,
//   with official race results, colour-coded scoring, rank badges, sorting, and pagination.
// [Inbound Trigger] Navigation to /results route; optionally receives ?race= URL parameter from
//   Standings page navigation.
// [Downstream Impact] Real-time listener on scores collection updates automatically when admin
//   submits race results. Reads from race_results and predictions collections. Read-only view.
// @FIX(v05) Extracted shared types, functions, and constants to @/lib/results-utils for reuse
//   by the new /my-results page. No behaviour change — imports replace inline definitions.
// @FIX(v07) Task #8: Converted scores fetch from getDocs to onSnapshot for real-time updates.

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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collectionGroup, collection, query, where, doc, getDoc, getDocs, onSnapshot, orderBy, limit, startAfter, getCountFromServer, DocumentSnapshot } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Trophy, ChevronDown, Loader2, ArrowUpDown, Zap, Flag, Lock, ExternalLink } from "lucide-react";
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
                // race_results docs are stored with Title-Case IDs (e.g. "Australian-Grand-Prix-GP").
                // Do NOT toLowerCase() — Firestore doc IDs are case-sensitive.
                const resultDocRef = doc(firestore, "race_results", selectedRaceId);
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

    // GUID: PAGE_RESULTS-025A-v06
    // @BUG_FIX: GEMINI-AUDIT-128 — Two bugs fixed:
    //   (1) scoreRaceId was lowercased but scores store Title-Case raceId (e.g., "Australian-Grand-Prix-GP")
    //       → query returned 0 results. Fixed: use selectedRaceId directly (no toLowerCase).
    //   (2) Map key used data.oduserId but scores store `userId` not `oduserId` → all lookups missed.
    //       Fixed: use data.userId as the map key.
    // [Intent] Real-time listener for scores collection - updates automatically when admin submits results.
    //          Task #8 fix: Converted from getDocs to onSnapshot for automatic score updates.
    // [Inbound Trigger] Runs when firestore or selectedRaceId changes.
    // [Downstream Impact] Keeps scoresMap in sync with Firestore scores collection in real-time.
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        // Scores are stored with Title-Case raceId (e.g., "Australian-Grand-Prix-GP") — use selectedRaceId as-is
        setScoresLoaded(false);

        const unsubscribe = onSnapshot(
            query(
                collection(firestore, "scores"),
                where("raceId", "==", selectedRaceId)
            ),
            (snapshot) => {
                const newScoresMap = new Map<string, Score>();
                snapshot.forEach(doc => {
                    const data = doc.data();
                    // Scores use userId field (not oduserId) — must match key used in teams useMemo
                    newScoresMap.set(data.userId, {
                        id: doc.id,
                        ...data,
                    } as Score);
                });
                setScoresMap(newScoresMap);
                setScoresLoaded(true);
                setLastUpdated(new Date());
            },
            (error) => {
                console.error("Error fetching scores:", error);
                setScoresMap(new Map());
                setScoresLoaded(true);
            }
        );

        return () => unsubscribe();
    }, [firestore, selectedRaceId]);

    // GUID: PAGE_RESULTS-025B-v07
    // @BUG_FIX: GEMINI-AUDIT-128 — GP predictions were never shown on results page.
    //   Root cause: user-submitted predictions store raceId as "Australian-Grand-Prix-GP" (via generateRaceId)
    //   but getBaseRaceId() returned "Australian-Grand-Prix" (strips -GP) → 0 user-submitted GP predictions found.
    //   Carry-forward predictions are stored without -GP suffix (via normalizeRaceId in calculate-scores).
    //   Fix: dual-query — primary uses selectedRaceId (user-submitted format), secondary uses getBaseRaceId()
    //   (carry-forward format). Only needed when formats differ (GP races); Sprint uses same format for both.
    // @BUG_FIX(v07): Sprint carry-forward — teams with GP predictions but no Sprint prediction were
    //   invisible on the Sprint results page. Standings applied GP→Sprint carry-forward but results did not.
    //   Fix: for Sprint races, also query for GP predictions (both "Name-GP" and "Name" formats) and
    //   merge them as carry-forward for teams that have no Sprint-specific prediction.
    // [Intent] Fetch predictions and count for the selected race (one-time fetch with pagination).
    //          Separated from scores listener to keep pagination working while scores update in real-time.
    // [Inbound Trigger] Runs when firestore or selectedRaceId changes.
    // [Downstream Impact] Loads first page of predictions and total count.
    useEffect(() => {
        if (!firestore || !selectedRaceId) return;

        let cancelled = false;

        const fetchPredictions = async () => {
            setIsLoading(true);
            setRawPredictionDocs([]);
            setLastDoc(null);

            // baseRaceId: carry-forward format (without -GP suffix). selectedRaceId: user-submitted format.
            const baseRaceId = getBaseRaceId(selectedRaceId);
            // GP races: formats differ ("Australian-Grand-Prix" vs "Australian-Grand-Prix-GP")
            // Sprint races: formats are identical ("Chinese-Grand-Prix-Sprint") → single query suffices
            const needsGpDualQuery = baseRaceId !== selectedRaceId;

            // Sprint carry-forward: also query for GP predictions (teams that submitted GP picks
            // but not Sprint-specific picks — same carry-forward logic as standings page)
            const currentEvent = allRaceEvents.find(e => e.id === selectedRaceId);
            const isSprintRace = currentEvent?.isSprint ?? selectedRaceId.toLowerCase().endsWith('-sprint');

            try {
                // Primary: user-submitted predictions (paginated)
                const [primaryCount, primaryDocs] = await Promise.all([
                    getCountFromServer(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", selectedRaceId)
                    )),
                    getDocs(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", selectedRaceId),
                        orderBy("teamName"),
                        limit(PAGE_SIZE)
                    ))
                ]);

                // Secondary: carry-forward predictions for GP races (fetch all — rare, small set)
                const carryForwardDocs = needsGpDualQuery
                    ? await getDocs(query(
                        collectionGroup(firestore, "predictions"),
                        where("raceId", "==", baseRaceId)
                    ))
                    : null;

                // GUID: PAGE_RESULTS-025C-v01
                // [Intent] Full carry-forward resolution for the results page — mirrors the
                //          3-tier logic used by the standings page:
                //          1. Race-specific prediction (primary query above)
                //          2. For Sprint: same-weekend GP prediction (both "Name-GP" and "Name" formats)
                //          3. Latest prediction from any prior race (fallback for teams with no
                //             prediction this weekend at all)
                //          This ensures every team that appears in standings also appears on the
                //          results page when the user clicks their score.

                // Tier 2: Sprint carry-forward from same-weekend GP prediction
                let sprintGpMap: Map<string, any> | null = null;
                if (isSprintRace && currentEvent) {
                    const gpBaseName = currentEvent.baseName;
                    const gpEventId = gpBaseName.replace(/\s+/g, '-') + '-GP';  // "Chinese-Grand-Prix-GP"
                    const gpBaseId = gpBaseName.replace(/\s+/g, '-');           // "Chinese-Grand-Prix"

                    const [gpEventDocs, gpBaseDocs] = await Promise.all([
                        getDocs(query(
                            collectionGroup(firestore, "predictions"),
                            where("raceId", "==", gpEventId)
                        )),
                        gpBaseId !== gpEventId
                            ? getDocs(query(
                                collectionGroup(firestore, "predictions"),
                                where("raceId", "==", gpBaseId)
                            ))
                            : null,
                    ]);

                    sprintGpMap = new Map<string, any>();
                    gpEventDocs.forEach(doc => {
                        const data = doc.data();
                        sprintGpMap!.set(data.teamId || data.userId || doc.ref.parent.parent?.id, data);
                    });
                    if (gpBaseDocs) {
                        gpBaseDocs.forEach(doc => {
                            const data = doc.data();
                            const key = data.teamId || data.userId || doc.ref.parent.parent?.id;
                            if (!sprintGpMap!.has(key)) {
                                sprintGpMap!.set(key, data);
                            }
                        });
                    }
                }

                // Tier 3: Latest prediction from any prior race — catches teams that submitted
                // nothing for this weekend. Fetches ALL predictions via collectionGroup and
                // keeps only the most recent per teamId by timestamp.
                const allPredsDocs = await getDocs(collectionGroup(firestore, "predictions"));
                const latestByTeam = new Map<string, { data: any; timestamp: Date }>();
                allPredsDocs.forEach(doc => {
                    const data = doc.data();
                    if (!Array.isArray(data.predictions) || data.predictions.length !== 6) return;
                    const teamId = data.teamId || data.userId || doc.ref.parent.parent?.id;
                    if (!teamId) return;
                    const ts = data.submittedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date(0);
                    const existing = latestByTeam.get(teamId);
                    if (!existing || ts > existing.timestamp) {
                        latestByTeam.set(teamId, { data, timestamp: ts });
                    }
                });

                if (cancelled) return;

                // Merge all tiers — race-specific wins over GP carry-forward wins over prior-race fallback
                const mergedMap = new Map<string, any>();

                // Tier 1: race-specific predictions (Sprint or GP direct match)
                primaryDocs.forEach(doc => mergedMap.set(doc.ref.path, doc.data()));
                if (carryForwardDocs) {
                    carryForwardDocs.forEach(doc => mergedMap.set(doc.ref.path, doc.data()));
                }

                // Build set of teamIds already covered by Tier 1
                const coveredTeamIds = new Set<string>();
                mergedMap.forEach((data) => {
                    coveredTeamIds.add(data.teamId || data.userId);
                });

                // Tier 2: same-weekend GP carry-forward (Sprint only)
                if (sprintGpMap) {
                    sprintGpMap.forEach((data, teamId) => {
                        if (!coveredTeamIds.has(teamId)) {
                            mergedMap.set(`carry-forward-gp-${teamId}`, data);
                            coveredTeamIds.add(teamId);
                        }
                    });
                }

                // Tier 3: latest prior prediction (any race)
                latestByTeam.forEach(({ data }, teamId) => {
                    if (!coveredTeamIds.has(teamId)) {
                        mergedMap.set(`carry-forward-prior-${teamId}`, data);
                        coveredTeamIds.add(teamId);
                    }
                });

                setTotalCount(mergedMap.size);

                if (mergedMap.size === 0) {
                    setHasMore(false);
                    setRawPredictionDocs([]);
                } else {
                    // Cursor tracks primary query for loadMore pagination
                    setLastDoc(primaryDocs.docs.length > 0 ? primaryDocs.docs[primaryDocs.docs.length - 1] : null);
                    setHasMore(primaryDocs.docs.length === PAGE_SIZE);
                    setRawPredictionDocs([...mergedMap.values()]);
                }
            } catch (error) {
                console.error("Error fetching predictions:", error);
                if (!cancelled) {
                    setTotalCount(null);
                    setRawPredictionDocs([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        fetchPredictions();
        return () => { cancelled = true; };
    }, [firestore, selectedRaceId]);

    // GUID: PAGE_RESULTS-026-v05
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
            // Golden Rule #3: breakdown is calculated in real-time from predictions vs actualTop6,
            // not stored as duplicate data in scores collection
            return {
                teamName: data.teamName || "Unknown Team",
                oduserId,
                predictions,
                totalPoints: score?.totalPoints ?? null,
                hasScore: !!score,
                bonusPoints: calculateBonus(correctCount),
            };
        });
    }, [rawPredictionDocs, raceResult, scoresMap, parsePredictions]);

    // GUID: PAGE_RESULTS-027-v05
    // @BUG_FIX: GEMINI-AUDIT-128 — Changed from getBaseRaceId() to selectedRaceId directly.
    //   loadMore paginates user-submitted predictions (selectedRaceId format). Carry-forward predictions
    //   (baseRaceId format) are fully loaded in the initial fetchPredictions call, so no pagination needed for them.
    const loadMore = useCallback(async () => {
        if (!firestore || !lastDoc || isLoadingMore) return;

        setIsLoadingMore(true);

        try {
            const submissionsQuery = query(
                collectionGroup(firestore, "predictions"),
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
                        {eventsWithResults.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Completed</SelectLabel>
                            {eventsWithResults.map((event) => (
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
                          </SelectGroup>
                        )}
                        {(() => {
                          const upcomingEvents = allRaceEvents.filter(event => !racesWithResults.has(event.id));
                          if (upcomingEvents.length === 0) return null;
                          return (
                            <SelectGroup>
                              <SelectLabel>Upcoming</SelectLabel>
                              {upcomingEvents.map((event) => (
                                <SelectItem key={event.id} value={event.id} disabled className="opacity-50">
                                  <span className="flex items-center gap-2 text-muted-foreground">
                                    <Lock className="h-3 w-3" />
                                    {event.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          );
                        })()}
                        {eventsWithResults.length === 0 && allRaceEvents.every(e => racesWithResults.has(e.id)) && (
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
                 <div className="flex items-center justify-between gap-2 flex-wrap">
                   <div className="flex items-center gap-2 text-sm font-medium">
                     <Trophy className="w-4 h-4 text-accent" />
                     Official Result
                   </div>
                   {raceResult.fiaClassificationUrl && (
                     <a
                       href={raceResult.fiaClassificationUrl}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                     >
                       <ExternalLink className="w-3 h-3" />
                       FIA Classification
                     </a>
                   )}
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
