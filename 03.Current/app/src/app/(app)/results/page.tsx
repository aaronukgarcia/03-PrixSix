// GUID: PAGE_RESULTS-000-v03
// [Intent] Race Results page — displays per-race points breakdowns for all teams' predictions,
//   with official race results, colour-coded scoring, rank badges, sorting, and pagination.
// [Inbound Trigger] Navigation to /results route; optionally receives ?race= URL parameter from
//   Standings page navigation.
// [Downstream Impact] Reads from Firestore race_results, scores, and predictions collections.
//   No write operations — this is a read-only view.

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

// GUID: PAGE_RESULTS-001-v03
// [Intent] Type for a score document associated with a team's race performance.
// [Inbound Trigger] Used to type the scoresMap values fetched from Firestore scores collection.
// [Downstream Impact] Consumed when building TeamResult objects to display stored scores.
interface Score {
    id: string;
    oduserId: string;
    teamName: string;
    raceId: string;
    totalPoints: number;
    breakdown: string;
}

// GUID: PAGE_RESULTS-002-v03
// [Intent] Type for the official race result document — stores the actual top-6 driver finish order.
// [Inbound Trigger] Fetched from Firestore race_results collection by lowercase event ID.
// [Downstream Impact] Used to calculate per-driver scoring and determine score types (A-E).
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

// GUID: PAGE_RESULTS-003-v03
// [Intent] Score type enum for colour-coded display — maps position difference to grade (A=exact, E=miss).
// [Inbound Trigger] Computed per driver prediction against the actual result.
// [Downstream Impact] Drives the colour class applied to individual driver score displays.
type ScoreType = 'A' | 'B' | 'C' | 'D' | 'E';  // A=exact(+6), B=1off(+4), C=2off(+3), D=3+off(+2), E=notInTop6(0)

// GUID: PAGE_RESULTS-004-v03
// [Intent] Type for a single driver within a team's prediction — includes predicted/actual positions,
//   points scored, and the score type grade for colour coding.
// [Inbound Trigger] Produced by parsePredictions when comparing predictions against actual results.
// [Downstream Impact] Rendered per driver in the prediction breakdown column of the results table.
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

// GUID: PAGE_RESULTS-005-v03
// [Intent] Type for a team's complete result for a race — predictions, total points, bonus, and rank.
// [Inbound Trigger] Built from prediction documents merged with scores and race results.
// [Downstream Impact] Drives each row in the results table; sortedTeams memo depends on this.
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

// GUID: PAGE_RESULTS-006-v03
// [Intent] Page size constant for Firestore query pagination of prediction documents.
// [Inbound Trigger] Used by fetchAllData and loadMore functions.
// [Downstream Impact] Controls batch size for predictions fetched per page.
const PAGE_SIZE = 25;

// GUID: PAGE_RESULTS-007-v03
// [Intent] Race rank badge component for 1st, 2nd, 3rd place finishers in a single race event.
// [Inbound Trigger] Rendered next to team name when team.rank is 1, 2, or 3.
// [Downstream Impact] Pure presentational component — no side effects.
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

// GUID: PAGE_RESULTS-008-v03
// [Intent] Build a flat list of all race events (GP + Sprint) from the RaceSchedule, with IDs and
//   metadata for the race selector dropdown.
// [Inbound Trigger] Called once at module level to create the allRaceEvents constant.
// [Downstream Impact] allRaceEvents drives the race selector dropdown and event ID lookups.
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

// GUID: PAGE_RESULTS-009-v03
// [Intent] Module-level constant of all race events — avoids recomputation on every render.
// [Inbound Trigger] Computed once when the module is imported.
// [Downstream Impact] Used throughout ResultsContent for race selection, filtering, and ID lookups.
const allRaceEvents = buildRaceEvents();

// GUID: PAGE_RESULTS-010-v03
// [Intent] Suspense loading fallback — skeleton UI shown while ResultsContent loads (required by
//   Next.js 15 for components using useSearchParams).
// [Inbound Trigger] Rendered by the Suspense boundary in ResultsPage while ResultsContent is suspended.
// [Downstream Impact] Pure presentational component — no side effects.
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

// GUID: PAGE_RESULTS-011-v03
// [Intent] Main results content component — fetches race results, scores, and predictions from
//   Firestore, computes per-driver scoring against actual results, and renders the results table
//   with colour-coded breakdowns, sorting, and pagination.
// [Inbound Trigger] Rendered inside Suspense boundary; reads ?race= URL param for deep linking.
// [Downstream Impact] Reads from Firestore race_results, scores, and predictions (collectionGroup).
//   No write operations.
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

    // GUID: PAGE_RESULTS-012-v03
    // [Intent] Fetch all race_results documents on mount to determine which races have admin-entered
    //   results (for dropdown filtering) and which is the most recent (for default selection).
    // [Inbound Trigger] Fires on mount and when firestore or raceFromUrl changes.
    // [Downstream Impact] Populates racesWithResults set and mostRecentResultRaceId; drives the
    //   eventsWithResults filtered dropdown and default race selection.
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

    // GUID: PAGE_RESULTS-013-v03
    // [Intent] Filter the full race events list to only those with admin-entered results.
    // [Inbound Trigger] racesWithResults set changes.
    // [Downstream Impact] Drives the race selector dropdown — only shows races that have results.
    const eventsWithResults = useMemo(() => {
        return allRaceEvents.filter(event => racesWithResults.has(event.id));
    }, [racesWithResults]);

    // GUID: PAGE_RESULTS-014-v03
    // [Intent] Calculate the default race ID to display — prioritises URL parameter, then most recent
    //   result, then most recent past event, then the first event.
    // [Inbound Trigger] raceFromUrl, mostRecentResultRaceId, or pastEvents changes.
    // [Downstream Impact] Sets the initial value of selectedRaceId state.
    const defaultRaceId = useMemo(() => {
        if (raceFromUrl) return raceFromUrl;
        if (mostRecentResultRaceId) return mostRecentResultRaceId;
        if (pastEvents.length > 0) return pastEvents[pastEvents.length - 1].id;
        return allRaceEvents[0].id;
    }, [raceFromUrl, mostRecentResultRaceId, pastEvents]);

    const [selectedRaceId, setSelectedRaceId] = useState(defaultRaceId);

    // GUID: PAGE_RESULTS-015-v03
    // [Intent] Sync selectedRaceId when the most recent result is fetched (only if no URL param).
    // [Inbound Trigger] mostRecentResultRaceId changes after async fetch completes.
    // [Downstream Impact] Updates selectedRaceId which triggers data re-fetch.
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

    // GUID: PAGE_RESULTS-016-v03
    // [Intent] Sync selectedRaceId when the URL ?race= parameter changes (e.g. browser navigation).
    // [Inbound Trigger] raceFromUrl search param changes.
    // [Downstream Impact] Updates selectedRaceId which triggers race result and predictions re-fetch.
    useEffect(() => {
        if (raceFromUrl && raceFromUrl !== selectedRaceId) {
            setSelectedRaceId(raceFromUrl);
        }
    }, [raceFromUrl]);

    // GUID: PAGE_RESULTS-017-v03
    // [Intent] Convert a full event ID (with -GP or -Sprint suffix) to the base race ID in title case,
    //   matching how predictions are stored in Firestore.
    // [Inbound Trigger] Called when building Firestore queries for predictions.
    // [Downstream Impact] Incorrect normalisation would cause prediction lookups to return empty results.
    const getBaseRaceId = (eventId: string) => {
        const base = eventId.replace(/-GP$/i, '').replace(/-Sprint$/i, '');
        // Convert to title case: "spanish-grand-prix" -> "Spanish-Grand-Prix"
        return base.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join('-');
    };

    // GUID: PAGE_RESULTS-018-v03
    // [Intent] Fetch the official race result document when the selected race changes.
    // [Inbound Trigger] selectedRaceId or firestore changes.
    // [Downstream Impact] Sets raceResult state which drives scoring display and prediction comparison.
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

    // GUID: PAGE_RESULTS-019-v03
    // [Intent] Format a Firestore timestamp into a human-readable UK date-time string.
    // [Inbound Trigger] Called when displaying the "Results posted" timestamp.
    // [Downstream Impact] Pure function — no side effects.
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

    // GUID: PAGE_RESULTS-020-v03
    // [Intent] Build a formatted string of the official top-6 result (e.g. "P1: Verstappen | P2: ...").
    // [Inbound Trigger] Called when rendering the official result banner.
    // [Downstream Impact] Pure function — no side effects. Returns null if no raceResult.
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

    // GUID: PAGE_RESULTS-021-v03
    // [Intent] Map a predicted vs actual position difference to a score type grade (A-E) for colour coding.
    // [Inbound Trigger] Called per driver prediction in parsePredictions.
    // [Downstream Impact] Drives the CSS class applied to each driver's score display.
    const getScoreType = (predictedPosition: number, actualPosition: number): ScoreType => {
        if (actualPosition === -1) return 'E';  // Not in top 6
        const diff = Math.abs(predictedPosition - actualPosition);
        if (diff === 0) return 'A';  // Exact
        if (diff === 1) return 'B';  // 1 off
        if (diff === 2) return 'C';  // 2 off
        return 'D';  // 3+ off
    };

    // GUID: PAGE_RESULTS-022-v03
    // [Intent] Parse a team's raw predictions (object or array format) and compare against actual
    //   top-6 results to produce per-driver scoring with points and score types.
    // [Inbound Trigger] Called per team when building TeamResult objects from prediction documents.
    // [Downstream Impact] Produces DriverPrediction[] array used for the prediction breakdown column.
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

    // GUID: PAGE_RESULTS-023-v03
    // [Intent] Calculate bonus points — awards 10 points if all 6 predicted drivers are in the top 6.
    // [Inbound Trigger] Called per team after counting correct predictions.
    // [Downstream Impact] Bonus is added to total displayed points and highlighted in amber.
    const calculateBonus = (correctCount: number): number => {
        if (correctCount === 6) return SCORING_POINTS.bonusAll6;
        return 0;
    };

    // GUID: PAGE_RESULTS-024-v03
    // [Intent] Map score type grades (A-E) to Tailwind CSS colour classes for visual feedback.
    // [Inbound Trigger] Called per driver when rendering the prediction breakdown.
    // [Downstream Impact] Pure function — returns a CSS class string.
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

    // GUID: PAGE_RESULTS-025-v03
    // [Intent] Fetch all data for the selected race in parallel — count, scores, and first page of
    //   predictions from Firestore. Builds TeamResult objects with scoring breakdown.
    // [Inbound Trigger] selectedRaceId, raceResult, or firestore changes.
    // [Downstream Impact] Populates teams, scoresMap, totalCount, and lastUpdated state.
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

    // GUID: PAGE_RESULTS-026-v03
    // [Intent] Load the next page of prediction documents from Firestore using cursor-based pagination.
    // [Inbound Trigger] User clicks the "Load More Teams" button.
    // [Downstream Impact] Appends new TeamResult objects to the teams state array.
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

    // GUID: PAGE_RESULTS-027-v03
    // [Intent] Filter teams by the selected league's member user IDs (or show all if global).
    // [Inbound Trigger] teams or selectedLeague changes.
    // [Downstream Impact] filteredTeams feeds into sortedTeams for final display.
    const filteredTeams = useMemo(() => {
        if (!selectedLeague || selectedLeague.isGlobal) {
            return teams;
        }
        return teams.filter(team => selectedLeague.memberUserIds.includes(team.oduserId));
    }, [teams, selectedLeague]);

    const progressPercent = totalCount && totalCount > 0
        ? Math.round((filteredTeams.length / totalCount) * 100)
        : 0;

    // GUID: PAGE_RESULTS-028-v03
    // [Intent] Calculate effective points for a team — uses stored score if available, otherwise
    //   calculates from predictions + bonus when race results exist.
    // [Inbound Trigger] Called per team in sortedTeams memo.
    // [Downstream Impact] Drives sort order when sorting by points.
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

    // GUID: PAGE_RESULTS-029-v03
    // [Intent] Sort teams by points (descending) or team name (ascending), and assign race ranks
    //   (1st/2nd/3rd) with proper tie handling when sorted by points.
    // [Inbound Trigger] filteredTeams, sortBy, or getEffectivePoints changes.
    // [Downstream Impact] sortedTeams drives the final table rendering with rank badges.
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

    // GUID: PAGE_RESULTS-030-v03
    // [Intent] Toggle the sort order between points and team name.
    // [Inbound Trigger] User clicks the "Sort by" button.
    // [Downstream Impact] Changes sortBy state which triggers sortedTeams recalculation.
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

// GUID: PAGE_RESULTS-031-v03
// [Intent] Exported page component — wraps ResultsContent in a Suspense boundary as required by
//   Next.js 15 for components that use useSearchParams.
// [Inbound Trigger] React Router renders this component when user navigates to /results.
// [Downstream Impact] Delegates to ResultsContent; shows ResultsLoadingFallback during suspension.
export default function ResultsPage() {
    return (
        <Suspense fallback={<ResultsLoadingFallback />}>
            <ResultsContent />
        </Suspense>
    );
}
