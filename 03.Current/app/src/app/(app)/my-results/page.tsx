// GUID: PAGE_MY_RESULTS-000-v01
// [Intent] My Results page — displays the logged-in user's prediction results across ALL races,
//   with colour-coded scoring breakdowns, season total, and team toggle for secondary teams.
//   Includes bar chart, narrative stats, and team search to view other teams.
// [Inbound Trigger] Navigation to /my-results route via sidebar.
// [Downstream Impact] Reads from Firestore race_results, scores, and user predictions subcollection.
//   No write operations — this is a read-only view.

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
import { collection, collectionGroup, query, where, getDocs, orderBy, getDoc, doc } from "firebase/firestore";
import { calculateDriverPoints, SCORING_POINTS } from "@/lib/scoring-rules";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trophy, Zap, Flag, Loader2, User, Search, X, TrendingUp, Target, BarChart3 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
    ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
    type RaceResult,
    type Score,
    type DriverPrediction,
    type ScoreType,
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

interface TeamSearchResult {
    userId: string;
    teamName: string;
    isSecondary: boolean;
}

/** Returns ordinal suffix string, e.g. 1→"1st", 2→"2nd", 3→"3rd", 5→"5th" */
function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// GUID: PAGE_MY_RESULTS-002-v02
// [Intent] Main page component — fetches all user predictions, race results, and scores,
//   then renders per-race cards with scoring breakdowns ordered most recent first.
//   v02: Added mobile window-width tracking to hide XAxis labels on narrow screens
//   (MANICURE-AUDIT-005), and removed hardcoded white Legend label colour (MANICURE-AUDIT-004).
// [Inbound Trigger] Navigation to /my-results route via sidebar.
// [Downstream Impact] Chart display only — no data or scoring logic changed.
export default function MyResultsPage() {
    const { user } = useAuth();
    const firestore = useFirestore();

    // GUID: PAGE_MY_RESULTS-003-v01
    // [Intent] Active team ID — primary is user.id, secondary is "${user.id}-secondary".
    const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [raceResults, setRaceResults] = useState<MyRaceResult[]>([]);

    // Team search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<TeamSearchResult[]>([]);
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [viewingTeam, setViewingTeam] = useState<TeamSearchResult | null>(null);
    const [otherTeamResults, setOtherTeamResults] = useState<MyRaceResult[]>([]);
    const [isLoadingOtherTeam, setIsLoadingOtherTeam] = useState(false);
    const [allTeams, setAllTeams] = useState<TeamSearchResult[]>([]);

    // Season leader state
    const [leaderData, setLeaderData] = useState<{
        teamId: string;
        teamName: string;
        perRacePoints: Map<string, number>;
    } | null>(null);

    // All teams' season totals for ranking (userId → totalPoints)
    const [allTeamTotals, setAllTeamTotals] = useState<Map<string, number>>(new Map());

    // GUID: PAGE_MY_RESULTS-010-v04
    // [Intent] Track viewport width so the XAxis labels can be hidden on narrow screens
    //   (MANICURE-AUDIT-005). On mobile (< 640px) the rotated labels overlap; hiding them
    //   keeps the chart readable — the tooltip still shows full race names on tap/hover.
    //   Initialised as null (not 1024) so SSR and first client render both produce identical
    //   output (labels shown), avoiding a React hydration mismatch on mobile devices.
    // [Inbound Trigger] useEffect sets real width on mount; window resize event updates it.
    // [Downstream Impact] Drives the `hide` prop on the ComposedChart XAxis only.
    const [windowWidth, setWindowWidth] = useState<number | null>(null);
    useEffect(() => {
        setWindowWidth(window.innerWidth);
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);
    const hideXAxisLabels = windowWidth !== null && windowWidth < 640;

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

    // Load all teams on mount for client-side search
    useEffect(() => {
        if (!firestore) return;

        const fetchAllTeams = async () => {
            try {
                const usersQuery = query(
                    collection(firestore, "users"),
                    orderBy("teamName"),
                );
                const snapshot = await getDocs(usersQuery);
                const teams: TeamSearchResult[] = [];

                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data.teamName) {
                        teams.push({
                            userId: docSnap.id,
                            teamName: data.teamName,
                            isSecondary: false,
                        });
                    }
                    if (data.secondaryTeamName) {
                        teams.push({
                            userId: docSnap.id,
                            teamName: data.secondaryTeamName,
                            isSecondary: true,
                        });
                    }
                });

                setAllTeams(teams);
            } catch (error) {
                console.error("Error loading all teams:", error);
            }
        };

        fetchAllTeams();
    }, [firestore]);

    // GUID: PAGE_MY_RESULTS-011-v01
    // @ARCH_CHANGE (SSOT-001): Compute season leader from race_results + predictions in real-time.
    //   No scores collection read. Carry-forward resolution applied per team per race.
    // [Intent] Computes total season points for all teams by replaying the scoring engine over
    //   all race_results and predictions. Used to display the leader line on the chart and the
    //   user's season rank.
    useEffect(() => {
        if (!firestore) return;

        const fetchLeader = async () => {
            try {
                const [raceResultsSnap, allPredictionsSnap] = await Promise.all([
                    getDocs(collection(firestore, "race_results")),
                    getDocs(collectionGroup(firestore, "predictions")),
                ]);

                if (raceResultsSnap.size === 0) return;

                // Build race results map: resultDocId → top-6 array
                const raceResultsMap = new Map<string, string[]>();
                raceResultsSnap.forEach(rDoc => {
                    const d = rDoc.data();
                    raceResultsMap.set(rDoc.id.toLowerCase(), [d.driver1, d.driver2, d.driver3, d.driver4, d.driver5, d.driver6]);
                });

                // Build teamPredictionsByRace: teamId → normalizedRaceId → { predictions, timestamp }
                const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: Date }>>();
                allPredictionsSnap.forEach(predDoc => {
                    const predData = predDoc.data();
                    if (!Array.isArray(predData.predictions) || predData.predictions.length !== 6) return;
                    const pathParts = predDoc.ref.path.split('/');
                    const userId = pathParts[1];
                    const teamId: string = predData.teamId || userId;
                    const timestamp = predData.submittedAt?.toDate?.() || predData.createdAt?.toDate?.() || new Date(0);
                    const rawRaceId = predData.raceId as string | undefined;
                    if (!rawRaceId) return;
                    const predRaceId = rawRaceId.toLowerCase().replace(/-gp$/i, '');
                    if (!teamPredictionsByRace.has(teamId)) teamPredictionsByRace.set(teamId, new Map());
                    const teamRaces = teamPredictionsByRace.get(teamId)!;
                    const existing = teamRaces.get(predRaceId);
                    if (!existing || timestamp > existing.timestamp) {
                        teamRaces.set(predRaceId, { predictions: predData.predictions, timestamp });
                    }
                });

                // Compute totals and per-race points for every team
                const totals = new Map<string, number>();
                const perRace = new Map<string, Map<string, number>>();

                raceResultsMap.forEach((actualResults, resultDocId) => {
                    const normalizedResultId = resultDocId.replace(/-gp$/i, '');
                    teamPredictionsByRace.forEach((raceMap, teamId) => {
                        let teamPredictions: string[] | null = null;
                        if (raceMap.has(normalizedResultId)) {
                            teamPredictions = raceMap.get(normalizedResultId)!.predictions;
                        } else if (normalizedResultId.endsWith('-sprint')) {
                            const baseRaceId = normalizedResultId.replace(/-sprint$/, '');
                            if (raceMap.has(baseRaceId)) teamPredictions = raceMap.get(baseRaceId)!.predictions;
                        }
                        if (!teamPredictions) {
                            let latestTs = new Date(0);
                            raceMap.forEach(({ predictions, timestamp }) => {
                                if (timestamp > latestTs) { latestTs = timestamp; teamPredictions = predictions; }
                            });
                        }
                        if (!teamPredictions) return;

                        let totalPoints = 0;
                        let correctCount = 0;
                        (teamPredictions as string[]).forEach((driverId, predictedPosition) => {
                            const actualPosition = actualResults.indexOf(driverId);
                            totalPoints += calculateDriverPoints(predictedPosition, actualPosition);
                            if (actualPosition !== -1) correctCount++;
                        });
                        if (correctCount === 6) totalPoints += SCORING_POINTS.bonusAll6;

                        totals.set(teamId, (totals.get(teamId) || 0) + totalPoints);
                        if (!perRace.has(teamId)) perRace.set(teamId, new Map());
                        perRace.get(teamId)!.set(normalizedResultId, totalPoints);
                    });
                });

                if (totals.size === 0) return;

                setAllTeamTotals(totals);

                // Find leader (highest total)
                let leaderId = "";
                let leaderTotal = -1;
                for (const [uid, total] of totals) {
                    if (total > leaderTotal) { leaderTotal = total; leaderId = uid; }
                }

                // Resolve leader's team name
                const isSecondaryLeader = leaderId.endsWith('-secondary');
                const baseLeaderId = isSecondaryLeader ? leaderId.replace('-secondary', '') : leaderId;
                const leaderDoc = await getDoc(doc(firestore, "users", baseLeaderId));
                const leaderTeamName = leaderDoc.exists()
                    ? isSecondaryLeader
                        ? ((leaderDoc.data().secondaryTeamName as string) || leaderId)
                        : ((leaderDoc.data().teamName as string) || leaderId)
                    : leaderId;

                setLeaderData({
                    teamId: leaderId,
                    teamName: leaderTeamName,
                    perRacePoints: perRace.get(leaderId) || new Map(),
                });
            } catch (error) {
                console.error("Error computing season leader:", error);
            }
        };

        fetchLeader();
    }, [firestore]);

    // GUID: PAGE_MY_RESULTS-004-v02
    // @BUG_FIX: GEMINI-AUDIT-128 — User-submitted GP predictions were never found.
    //   Root cause: predictionsMap.get(baseRaceId) used "Australian-Grand-Prix" (getBaseRaceId strips -GP)
    //   but user-submitted predictions are stored with raceId "Australian-Grand-Prix-GP" (via generateRaceId).
    //   Fix: predictionsMap now stores both raceId formats as keys; lookup tries event.id first (user-submitted
    //   format with -GP/-Sprint suffix), falls back to getBaseRaceId() (carry-forward format without -GP).
    // [Intent] Shared processing function to build MyRaceResult[] from Firestore data.
    const processResults = useCallback((
        predictionsResult: any[],
        raceResultsResult: any[],
        scoresResult: any[],
    ): MyRaceResult[] => {
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

        // Build predictions map keyed by actual stored raceId (user-submitted: with -GP/-Sprint suffix;
        // carry-forward: without -GP suffix). Storing both allows lookup by either format.
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
            if (!raceResult) continue;

            // Try full event ID first (user-submitted format: "Australian-Grand-Prix-GP"),
            // fall back to getBaseRaceId (carry-forward format: "Australian-Grand-Prix").
            // For Sprint races: also fall back to GP prediction (both "Name-GP" and "Name" formats)
            // matching the carry-forward logic used by the standings page.
            const baseRaceId = getBaseRaceId(event.id);
            let predData = predictionsMap.get(event.id) ?? predictionsMap.get(baseRaceId);
            if (!predData && event.isSprint) {
                const gpEventId = event.baseName.replace(/\s+/g, '-') + '-GP';
                const gpBaseId = event.baseName.replace(/\s+/g, '-');
                predData = predictionsMap.get(gpEventId) ?? predictionsMap.get(gpBaseId);
            }
            if (!predData) continue;

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
        return processed;
    }, []);

    // GUID: PAGE_MY_RESULTS-005-v01
    // [Intent] Fetch own team data when activeTeamId changes.
    useEffect(() => {
        if (!firestore || !activeTeamId || !user?.id) return;

        let cancelled = false;

        const fetchData = async () => {
            setIsLoading(true);

            try {
                const [predictionsResult, raceResultsResult] = await Promise.all([
                    getDocs(query(
                        collection(firestore, "users", user.id, "predictions"),
                        where("teamId", "==", activeTeamId)
                    )),
                    getDocs(collection(firestore, "race_results")),
                ]);

                if (cancelled) return;

                // Pass empty array for scoresResult — scores are computed in real-time from
                // race_results + predictions (SSOT-001: no scores collection).
                const processed = processResults(
                    predictionsResult.docs,
                    raceResultsResult.docs,
                    [],
                );

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
    }, [firestore, activeTeamId, user?.id, processResults]);

    // GUID: PAGE_MY_RESULTS-006-v01
    // [Intent] Fetch other team's data when viewingTeam changes.
    useEffect(() => {
        if (!firestore || !viewingTeam) {
            setOtherTeamResults([]);
            return;
        }

        let cancelled = false;

        const fetchOtherTeam = async () => {
            setIsLoadingOtherTeam(true);

            try {
                const teamId = viewingTeam.isSecondary
                    ? `${viewingTeam.userId}-secondary`
                    : viewingTeam.userId;

                const [predictionsResult, raceResultsResult] = await Promise.all([
                    getDocs(query(
                        collection(firestore, "users", viewingTeam.userId, "predictions"),
                        where("teamId", "==", teamId)
                    )),
                    getDocs(collection(firestore, "race_results")),
                ]);

                if (cancelled) return;

                const processed = processResults(
                    predictionsResult.docs,
                    raceResultsResult.docs,
                    [],
                );

                setOtherTeamResults(processed);
            } catch (error) {
                console.error("Error fetching other team results:", error);
                setOtherTeamResults([]);
            } finally {
                if (!cancelled) {
                    setIsLoadingOtherTeam(false);
                }
            }
        };

        fetchOtherTeam();
        return () => { cancelled = true; };
    }, [firestore, viewingTeam, processResults]);

    // GUID: PAGE_MY_RESULTS-007-v02
    // [Intent] Client-side team search — case-insensitive substring filter on allTeams.
    const handleSearch = useCallback((input: string) => {
        setSearchQuery(input);
        const needle = input.trim().toLowerCase();
        if (!needle) {
            setSearchResults(allTeams);
            return;
        }
        const filtered = allTeams.filter(t => t.teamName.toLowerCase().includes(needle));
        setSearchResults(filtered);
    }, [allTeams]);

    // Computed display variables
    const displayResults = viewingTeam ? otherTeamResults : raceResults;
    const displayTeamName = viewingTeam ? viewingTeam.teamName : activeTeamName;
    const displaySeasonTotal = useMemo(() => {
        return displayResults.reduce((sum, r) => sum + r.totalPoints, 0);
    }, [displayResults]);

    // Determine the effective team ID being displayed (for leader comparison)
    const displayTeamId = useMemo(() => {
        if (viewingTeam) {
            return viewingTeam.isSecondary
                ? `${viewingTeam.userId}-secondary`
                : viewingTeam.userId;
        }
        return activeTeamId;
    }, [viewingTeam, activeTeamId]);

    // Whether to show the leader overlay (skip if viewing the leader themselves)
    const showLeaderLine = leaderData && displayTeamId !== leaderData.teamId;

    // Compute the displayed team's season rank from allTeamTotals
    const displaySeasonRank = useMemo(() => {
        if (allTeamTotals.size === 0 || !displayTeamId) return null;
        const teamTotal = allTeamTotals.get(displayTeamId);
        if (teamTotal === undefined) return null;
        // Count how many teams have strictly more points
        let rank = 1;
        for (const [, total] of allTeamTotals) {
            if (total > teamTotal) rank++;
        }
        return rank;
    }, [allTeamTotals, displayTeamId]);

    // GUID: PAGE_MY_RESULTS-008-v02
    // [Intent] Chart data — sort chronologically, compute running average, merge leader per-race scores.
    const chartData = useMemo(() => {
        if (displayResults.length === 0) return [];

        const sorted = [...displayResults].sort(
            (a, b) => new Date(a.raceTime).getTime() - new Date(b.raceTime).getTime()
        );

        let cumulative = 0;
        return sorted.map((r, i) => {
            cumulative += r.totalPoints;
            const truncatedName = r.baseName.length > 6
                ? r.baseName.slice(0, 6) + "…"
                : r.baseName;
            const entry: Record<string, any> = {
                race: truncatedName + (r.isSprint ? " (S)" : ""),
                fullName: r.eventLabel,
                points: r.totalPoints,
                average: Math.round((cumulative / (i + 1)) * 10) / 10,
                cumulative,
            };

            // Merge leader's score for this race event
            if (showLeaderLine && leaderData) {
                const leaderPts = leaderData.perRacePoints.get(r.eventId.toLowerCase());
                if (leaderPts !== undefined) {
                    entry.leaderPoints = leaderPts;
                }
            }

            return entry;
        });
    }, [displayResults, showLeaderLine, leaderData]);

    // GUID: PAGE_MY_RESULTS-009-v01
    // [Intent] Narrative stats — score-type breakdown, best race, bonus total, top drivers.
    const narrativeStats = useMemo(() => {
        if (displayResults.length === 0) return null;

        const breakdown = { A: 0, B: 0, C: 0, D: 0, E: 0, totalBonus: 0 };
        let exactCount = 0;
        let bestRace: { label: string; points: number } = { label: "", points: 0 };
        const driverPointsMap = new Map<string, { name: string; points: number; picks: number }>();

        for (const race of displayResults) {
            // Track best race
            if (race.totalPoints > bestRace.points) {
                bestRace = { label: race.eventLabel, points: race.totalPoints };
            }

            // Aggregate bonus
            breakdown.totalBonus += race.bonusPoints;

            for (const pred of race.predictions) {
                // Score-type aggregation
                const pts = pred.points;
                switch (pred.scoreType) {
                    case 'A':
                        breakdown.A += pts;
                        exactCount++;
                        break;
                    case 'B':
                        breakdown.B += pts;
                        break;
                    case 'C':
                        breakdown.C += pts;
                        break;
                    case 'D':
                        breakdown.D += pts;
                        break;
                    case 'E':
                        breakdown.E += pts;
                        break;
                }

                // Driver aggregation
                const existing = driverPointsMap.get(pred.driverId);
                if (existing) {
                    existing.points += pts;
                    existing.picks++;
                } else {
                    driverPointsMap.set(pred.driverId, {
                        name: pred.driverName,
                        points: pts,
                        picks: 1,
                    });
                }
            }
        }

        const topDrivers = Array.from(driverPointsMap.values())
            .sort((a, b) => b.points - a.points)
            .slice(0, 5);

        return { breakdown, exactCount, bestRace, topDrivers };
    }, [displayResults]);

    const handleTeamChange = (value: string) => {
        if (!user) return;
        if (value === "primary") {
            setActiveTeamId(user.id);
        } else {
            setActiveTeamId(`${user.id}-secondary`);
        }
    };

    const handleSelectTeam = (team: TeamSearchResult) => {
        setViewingTeam(team);
        setIsPopoverOpen(false);
        setSearchQuery("");
        setSearchResults([]);
    };

    const handleClearViewingTeam = () => {
        setViewingTeam(null);
        setOtherTeamResults([]);
    };

    const currentTeamValue = activeTeamId === user?.id ? "primary" : "secondary";

    // Custom tooltip for chart
    const ChartTooltip = ({ active, payload }: any) => {
        if (!active || !payload?.length) return null;
        const data = payload[0].payload;
        return (
            <div className="rounded-lg border bg-background p-2 shadow-md text-sm">
                <p className="font-medium">{data.fullName}</p>
                <p className="text-accent">{data.points} pts</p>
                <p className="text-muted-foreground">Avg: {data.average}</p>
                {data.leaderPoints !== undefined && (
                    <p className="text-destructive">Leader ({leaderData?.teamName}): {data.leaderPoints} pts</p>
                )}
            </div>
        );
    };

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

            {/* Team Search Bar */}
            <div className="flex items-center gap-3 flex-wrap">
                <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                    <PopoverTrigger asChild>
                        <div className="relative w-full sm:w-[300px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search for a team..."
                                value={searchQuery}
                                onChange={(e) => {
                                    handleSearch(e.target.value);
                                    setIsPopoverOpen(true);
                                }}
                                onFocus={() => {
                                    if (!searchQuery.trim()) {
                                        setSearchResults(allTeams);
                                    }
                                    setIsPopoverOpen(true);
                                }}
                                className="pl-9"
                            />
                        </div>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-[300px] p-0"
                        align="start"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                        <div className="max-h-[300px] overflow-y-auto">
                            {searchResults.length === 0 && searchQuery.trim() && (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    No teams found
                                </p>
                            )}
                            {searchResults.map((result, i) => (
                                <button
                                    key={`${result.userId}-${result.isSecondary}-${i}`}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0"
                                    onClick={() => handleSelectTeam(result)}
                                >
                                    {result.teamName}
                                    {result.isSecondary && (
                                        <span className="text-muted-foreground ml-1">(2nd team)</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>

                {viewingTeam && (
                    <Badge variant="secondary" className="flex items-center gap-1.5 py-1.5 px-3">
                        Viewing: {viewingTeam.teamName}
                        <button
                            onClick={handleClearViewingTeam}
                            className="ml-1 hover:text-destructive transition-colors"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </Badge>
                )}
            </div>

            {/* Season Summary */}
            {!isLoading && !isLoadingOtherTeam && displayResults.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Trophy className="w-5 h-5 text-accent" />
                            Season Summary — {displayTeamName}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold text-accent">{displaySeasonTotal}</span>
                            <span className="text-muted-foreground">points across {displayResults.length} {displayResults.length === 1 ? 'race' : 'races'}{displaySeasonRank ? ` — ${ordinal(displaySeasonRank)} overall` : ''}</span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Loading state for other team */}
            {isLoadingOtherTeam && (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                    <span className="text-muted-foreground">Loading {viewingTeam?.teamName} results...</span>
                </div>
            )}

            {/* Bar Chart */}
            {!isLoading && !isLoadingOtherTeam && chartData.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <BarChart3 className="w-5 h-5 text-accent" />
                            Points Per Race
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                                    <XAxis
                                        dataKey="race"
                                        tick={hideXAxisLabels ? false : { fontSize: 11 }}
                                        angle={hideXAxisLabels ? 0 : -45}
                                        textAnchor={hideXAxisLabels ? "middle" : "end"}
                                        height={hideXAxisLabels ? 20 : 60}
                                    />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Legend verticalAlign="top" height={30} formatter={(value: string) => <span>{value}</span>} />
                                    <Bar
                                        dataKey="points"
                                        fill="hsl(var(--accent))"
                                        radius={[4, 4, 0, 0]}
                                        name="Race Points"
                                    />
                                    <Bar
                                        dataKey="average"
                                        fill="hsl(var(--primary) / 0.3)"
                                        radius={[4, 4, 0, 0]}
                                        name="Running Avg"
                                    />
                                    {showLeaderLine && (
                                        <Line
                                            type="monotone"
                                            dataKey="leaderPoints"
                                            stroke="hsl(var(--destructive))"
                                            dot={false}
                                            strokeWidth={2}
                                            name={leaderData ? `Leader (${leaderData.teamName})` : "Leader"}
                                            connectNulls
                                        />
                                    )}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Narrative Stats */}
            {!isLoading && !isLoadingOtherTeam && narrativeStats && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <TrendingUp className="w-5 h-5 text-accent" />
                            Season Breakdown — {displayTeamName}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        {/* Score-type grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="rounded-lg border p-3 text-center">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Exact</p>
                                <p className="text-2xl font-bold text-green-500">{narrativeStats.breakdown.A}</p>
                                <p className="text-xs text-muted-foreground">{narrativeStats.exactCount} picks</p>
                            </div>
                            <div className="rounded-lg border p-3 text-center">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">1-Off</p>
                                <p className="text-2xl font-bold text-emerald-400">{narrativeStats.breakdown.B}</p>
                                <p className="text-xs text-muted-foreground">+{SCORING_POINTS.onePositionOff} each</p>
                            </div>
                            <div className="rounded-lg border p-3 text-center">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">2-Off</p>
                                <p className="text-2xl font-bold text-yellow-400">{narrativeStats.breakdown.C}</p>
                                <p className="text-xs text-muted-foreground">+{SCORING_POINTS.twoPositionsOff} each</p>
                            </div>
                            <div className="rounded-lg border p-3 text-center">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Bonus</p>
                                <p className="text-2xl font-bold text-amber-400">{narrativeStats.breakdown.totalBonus}</p>
                                <p className="text-xs text-muted-foreground">all-6 bonus</p>
                            </div>
                        </div>

                        {/* Prose paragraph */}
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            <span className="font-medium text-foreground">{displayTeamName}</span> scored{" "}
                            <span className="text-green-500 font-medium">{narrativeStats.breakdown.A} pts</span> from exact predictions,{" "}
                            <span className="text-emerald-400 font-medium">{narrativeStats.breakdown.B} pts</span> from 1-off,{" "}
                            <span className="text-yellow-400 font-medium">{narrativeStats.breakdown.C} pts</span> from 2-off, and{" "}
                            <span className="text-orange-500 font-medium">{narrativeStats.breakdown.D} pts</span> from 3+ off predictions.
                        </p>

                        {/* Best race callout */}
                        {narrativeStats.bestRace.points > 0 && (
                            <div className="flex items-center gap-2 text-sm">
                                <Target className="h-4 w-4 text-accent shrink-0" />
                                <span>
                                    Best race: <span className="font-medium">{narrativeStats.bestRace.label}</span>
                                    {" "}with <span className="font-bold text-accent">{narrativeStats.bestRace.points} pts</span>
                                </span>
                            </div>
                        )}

                        {/* Bonus callout */}
                        {narrativeStats.breakdown.totalBonus > 0 && (
                            <div className="flex items-center gap-2 text-sm">
                                <Zap className="h-4 w-4 text-amber-400 shrink-0" />
                                <span>
                                    All-6 bonus earned: <span className="font-bold text-amber-400">{narrativeStats.breakdown.totalBonus} pts</span>
                                </span>
                            </div>
                        )}

                        {/* Top 5 drivers */}
                        {narrativeStats.topDrivers.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground uppercase tracking-wide">Top Scoring Drivers</p>
                                <div className="flex flex-wrap gap-2">
                                    {narrativeStats.topDrivers.map((d) => (
                                        <Badge key={d.name} variant="outline" className="text-xs">
                                            {d.name}: {d.points} pts
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
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
            {!isLoading && !isLoadingOtherTeam && displayResults.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Trophy className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <p className="text-muted-foreground text-center">
                            {viewingTeam
                                ? `No race results available yet for ${viewingTeam.teamName}.`
                                : "No race results available yet for your team."
                            }
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Race Cards */}
            {!isLoading && !isLoadingOtherTeam && displayResults.map((race) => (
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
