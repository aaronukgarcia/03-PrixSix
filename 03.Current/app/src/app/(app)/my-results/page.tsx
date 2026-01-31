// GUID: PAGE_MY_RESULTS-000-v01
// [Intent] My Results page — displays the logged-in user's prediction results across ALL races,
//   with colour-coded scoring breakdowns, season total, and team toggle for secondary teams.
// [Inbound Trigger] Navigation to /my-results route via sidebar.
// [Downstream Impact] Reads from Firestore race_results, scores, and user predictions subcollection.
//   No write operations — this is a read-only view.

"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth, useFirestore } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { F1Drivers } from "@/lib/data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, query, where, getDocs } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trophy, Zap, Flag, Loader2, User } from "lucide-react";
import {
    type RaceResult,
    type Score,
    type DriverPrediction,
    allRaceEvents,
    getScoreTypeColor,
    parsePredictions,
    calculateBonus,
    getBaseRaceId,
} from "@/lib/results-utils";

// GUID: PAGE_MY_RESULTS-001-v01
// [Intent] Type for a processed race card — one per race that has both results and user predictions.
interface MyRaceResult {
    eventId: string;
    eventLabel: string;
    baseName: string;
    isSprint: boolean;
    raceTime: string;
    officialTop6: string[];
    predictions: DriverPrediction[];
    totalPoints: number;
    bonusPoints: number;
    hasStoredScore: boolean;
    storedScore: number | null;
}

// GUID: PAGE_MY_RESULTS-002-v01
// [Intent] Main page component — fetches all user predictions, race results, and scores,
//   then renders per-race cards with scoring breakdowns ordered most recent first.
export default function MyResultsPage() {
    const { user } = useAuth();
    const firestore = useFirestore();

    // GUID: PAGE_MY_RESULTS-003-v01
    // [Intent] Active team ID — primary is user.id, secondary is "${user.id}-secondary".
    const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [raceResults, setRaceResults] = useState<MyRaceResult[]>([]);

    const hasSecondaryTeam = !!user?.secondaryTeamName;

    // Set default team on mount
    useEffect(() => {
        if (user?.id && !activeTeamId) {
            setActiveTeamId(user.id);
        }
    }, [user?.id, activeTeamId]);

    const activeTeamName = useMemo(() => {
        if (!user) return "";
        if (activeTeamId === user.id) return user.teamName;
        if (activeTeamId === `${user.id}-secondary`) return user.secondaryTeamName || "";
        return user.teamName;
    }, [user, activeTeamId]);

    // GUID: PAGE_MY_RESULTS-004-v01
    // [Intent] Fetch all data when activeTeamId changes — predictions, race results, and scores
    //   are fetched in parallel, then merged into per-race card data.
    useEffect(() => {
        if (!firestore || !activeTeamId || !user?.id) return;

        let cancelled = false;

        const fetchData = async () => {
            setIsLoading(true);

            try {
                // Fetch 3 collections in parallel
                const [predictionsResult, raceResultsResult, scoresResult] = await Promise.all([
                    // User's predictions for this team
                    getDocs(query(
                        collection(firestore, "users", user.id, "predictions"),
                        where("teamId", "==", activeTeamId)
                    )),
                    // All race results (small collection — ~24 docs max per season)
                    getDocs(collection(firestore, "race_results")),
                    // User's scores for this team
                    getDocs(query(
                        collection(firestore, "scores"),
                        where("userId", "==", activeTeamId)
                    )),
                ]);

                if (cancelled) return;

                // Build race results map (lowercase ID -> RaceResult)
                const raceResultsMap = new Map<string, RaceResult>();
                raceResultsResult.forEach(doc => {
                    raceResultsMap.set(doc.id.toLowerCase(), {
                        id: doc.id,
                        ...doc.data(),
                    } as RaceResult);
                });

                // Build scores map (lowercase raceId -> Score)
                const scoresMap = new Map<string, Score>();
                scoresResult.forEach(doc => {
                    const data = doc.data();
                    scoresMap.set(data.raceId?.toLowerCase(), {
                        id: doc.id,
                        ...data,
                    } as Score);
                });

                // Build predictions map (base raceId -> prediction data)
                const predictionsMap = new Map<string, any>();
                predictionsResult.forEach(doc => {
                    const data = doc.data();
                    if (data.raceId) {
                        predictionsMap.set(data.raceId, data);
                    }
                });

                // Process each race event that has results
                const processed: MyRaceResult[] = [];

                for (const event of allRaceEvents) {
                    const resultId = event.id.toLowerCase();
                    const raceResult = raceResultsMap.get(resultId);
                    if (!raceResult) continue; // No official result for this event

                    const baseRaceId = getBaseRaceId(event.id);
                    const predData = predictionsMap.get(baseRaceId);
                    if (!predData) continue; // No prediction for this race

                    const officialTop6 = [
                        raceResult.driver1, raceResult.driver2, raceResult.driver3,
                        raceResult.driver4, raceResult.driver5, raceResult.driver6,
                    ];

                    const driverPredictions = parsePredictions(predData.predictions, officialTop6);
                    const correctCount = driverPredictions.filter(p => p.isCorrect).length;
                    const bonusPoints = calculateBonus(correctCount);
                    const calculatedPoints = driverPredictions.reduce((sum, p) => sum + p.points, 0) + bonusPoints;

                    const storedScore = scoresMap.get(resultId);

                    processed.push({
                        eventId: event.id,
                        eventLabel: event.label,
                        baseName: event.baseName,
                        isSprint: event.isSprint,
                        raceTime: event.raceTime,
                        officialTop6,
                        predictions: driverPredictions,
                        totalPoints: storedScore ? storedScore.totalPoints : calculatedPoints,
                        bonusPoints,
                        hasStoredScore: !!storedScore,
                        storedScore: storedScore?.totalPoints ?? null,
                    });
                }

                // Sort by race time descending (most recent first)
                processed.sort((a, b) => new Date(b.raceTime).getTime() - new Date(a.raceTime).getTime());

                setRaceResults(processed);
            } catch (error) {
                console.error("Error fetching my results:", error);
                setRaceResults([]);
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        fetchData();
        return () => { cancelled = true; };
    }, [firestore, activeTeamId, user?.id]);

    // GUID: PAGE_MY_RESULTS-005-v01
    // [Intent] Calculate season total points across all scored races.
    const seasonTotal = useMemo(() => {
        return raceResults.reduce((sum, r) => sum + r.totalPoints, 0);
    }, [raceResults]);

    const handleTeamChange = (value: string) => {
        if (!user) return;
        if (value === "primary") {
            setActiveTeamId(user.id);
        } else {
            setActiveTeamId(`${user.id}-secondary`);
        }
    };

    const currentTeamValue = activeTeamId === user?.id ? "primary" : "secondary";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
                        My Results
                    </h1>
                    <p className="text-muted-foreground">
                        Your prediction results across all races.
                    </p>
                </div>
                {hasSecondaryTeam && (
                    <Select value={currentTeamValue} onValueChange={handleTeamChange}>
                        <SelectTrigger className="w-full sm:w-[220px]">
                            <User className="h-4 w-4 mr-2" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="primary">{user?.teamName}</SelectItem>
                            <SelectItem value="secondary">{user?.secondaryTeamName}</SelectItem>
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* Season Summary */}
            {!isLoading && raceResults.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Trophy className="w-5 h-5 text-accent" />
                            Season Summary — {activeTeamName}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold text-accent">{seasonTotal}</span>
                            <span className="text-muted-foreground">points across {raceResults.length} {raceResults.length === 1 ? 'race' : 'races'}</span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Loading state */}
            {isLoading && (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <Card key={i}>
                            <CardHeader>
                                <Skeleton className="h-6 w-48" />
                                <Skeleton className="h-4 w-32 mt-1" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-16 w-full" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!isLoading && raceResults.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Trophy className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground text-center">
                            No race results available yet for your team.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Race Cards */}
            {!isLoading && raceResults.map((race) => (
                <Card key={race.eventId}>
                    <CardHeader className="pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-base flex-wrap">
                                {race.baseName}
                                {race.isSprint ? (
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
                            <span className="text-2xl font-bold text-accent">
                                {race.totalPoints} pts
                            </span>
                        </div>
                        {/* Official result compact */}
                        <p className="text-xs font-mono text-muted-foreground mt-1">
                            {race.officialTop6.map((driverId, i) => {
                                const driver = F1Drivers.find(d => d.id === driverId);
                                return `P${i + 1}: ${driver?.name || driverId}`;
                            }).join(' | ')}
                        </p>
                    </CardHeader>
                    <CardContent>
                        {/* Prediction breakdown */}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-mono">
                            {race.predictions.map((pred, i) => (
                                <span key={i} className="inline-flex items-center">
                                    <span className={getScoreTypeColor(pred.scoreType)}>
                                        P{pred.position}: {pred.driverName}
                                    </span>
                                    <span className={`font-bold ml-0.5 ${getScoreTypeColor(pred.scoreType)}`}>
                                        +{pred.points}
                                    </span>
                                    {i < race.predictions.length - 1 && (
                                        <span className="text-muted-foreground ml-1">,</span>
                                    )}
                                </span>
                            ))}
                            {race.bonusPoints > 0 && (
                                <span className="text-amber-400 font-bold ml-1">
                                    Bonus+{race.bonusPoints}
                                </span>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
