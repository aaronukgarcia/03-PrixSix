// GUID: ADMIN_RESULTS-000-v03
// [Intent] Admin component for entering official F1 race results and managing existing results. Provides a two-step wizard: race selection then driver picker for top-6 positions.
// [Inbound Trigger] Rendered when admin navigates to the Results management tab in the admin panel.
// [Downstream Impact] Calls /api/calculate-scores to write race_results and scores collections, and /api/send-results-email for notifications. Calls /api/delete-scores to remove results. Directly affects league standings.

"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { F1Drivers, RaceSchedule, getDriverImage, Driver } from "@/lib/data";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { useFirestore, useCollection, useAuth } from "@/firebase";
import { collection, collectionGroup, query, orderBy, where, getCountFromServer } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Trophy, Users, AlertCircle, CheckCircle2, ArrowUp, ArrowDown, X, ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRaceResultSummary } from "@/lib/scoring";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { normalizeRaceId as sharedNormalizeRaceId } from "@/lib/normalize-race-id";

// GUID: ADMIN_RESULTS-001-v04
// @TECH_DEBT: Local normalizeRaceId replaced with shared import from normalize-race-id.ts (Golden Rule #3).
// [Intent] Race ID normalisation is now handled by the shared normalizeRaceId() utility.
// [Inbound Trigger] n/a -- import at top of file.
// [Downstream Impact] See LIB_NORMALIZE_RACE_ID-000 for normalisation logic.
const normalizeRaceId = sharedNormalizeRaceId;

// GUID: ADMIN_RESULTS-002-v03
// [Intent] Convert a driver ID (e.g., "hamilton") to a 3-letter display code (e.g., "HAM") by looking up the driver in F1Drivers static data.
// [Inbound Trigger] Called to display compact driver codes in the result summary confirmation dialog.
// [Downstream Impact] Pure display helper; no side effects. Falls back to first 3 chars of ID if driver not found.
function getDriverCode(driverId: string): string {
    const driver = F1Drivers.find(d => d.id === driverId);
    if (!driver) return driverId.substring(0, 3).toUpperCase();
    // Use first 3 letters of last name
    const lastName = driver.name.split(' ').pop() || driver.name;
    return lastName.substring(0, 3).toUpperCase();
}

// GUID: ADMIN_RESULTS-003-v03
// [Intent] TypeScript interface for a race result document stored in the race_results Firestore collection.
// [Inbound Trigger] Used to type the results fetched via useCollection hook and passed to delete/display functions.
// [Downstream Impact] Changes require matching updates in the /api/calculate-scores endpoint that writes these documents.
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

// GUID: ADMIN_RESULTS-004-v03
// [Intent] Type alias for the two-step wizard flow: race selection then result entry.
// [Inbound Trigger] Used by the step state variable to control which card is displayed.
// [Downstream Impact] Adding steps requires adding matching JSX render blocks.
type Step = 'select-race' | 'enter-results';

// GUID: ADMIN_RESULTS-005-v03
// [Intent] Main admin component for entering and managing official F1 race results via a two-step wizard (select race, then pick top-6 drivers).
// [Inbound Trigger] Rendered by the admin page when the Results management tab is selected.
// [Downstream Impact] Triggers server-side score calculation via /api/calculate-scores, sends result notification emails via /api/send-results-email, and can delete results via /api/delete-scores. Directly modifies race_results, scores, and standings collections.
export function ResultsManager() {
    const firestore = useFirestore();
    const { user, firebaseUser } = useAuth();
    const { toast } = useToast();

    // GUID: ADMIN_RESULTS-006-v03
    // [Intent] State management for the two-step wizard flow, driver selections, submission status, and deletion tracking.
    // [Inbound Trigger] Initialised on component mount; updated by user interactions and API responses.
    // [Downstream Impact] State drives which step is rendered, which drivers are selected, and whether buttons are disabled during async operations.

    // Step-based flow
    const [step, setStep] = useState<Step>('select-race');
    const [selectedRace, setSelectedRace] = useState<string | undefined>(undefined);
    const [predictions, setPredictions] = useState<(Driver | null)[]>(Array(6).fill(null));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);

    // Submission count for selected race
    const [submissionCount, setSubmissionCount] = useState<number | null>(null);
    const [isLoadingCount, setIsLoadingCount] = useState(false);

    // GUID: ADMIN_RESULTS-007-v03
    // [Intent] Fetch the count of unique team predictions when a race is selected, to show how many teams will be scored. Counts ALL predictions (carry-forward model).
    // [Inbound Trigger] Fires when selectedRace changes. Queries collectionGroup predictions across all users.
    // [Downstream Impact] Sets submissionCount displayed in the confirmation dialog and the submission count alert. Uses collectionGroup query which requires matching Firestore index.
    useEffect(() => {
        if (!firestore || !selectedRace) {
            setSubmissionCount(null);
            return;
        }

        const fetchSubmissionCount = async () => {
            setIsLoadingCount(true);
            try {
                // Count unique users who have at least one prediction (any race)
                // Their latest prediction will be used for scoring
                const predictionsQuery = query(collectionGroup(firestore, "predictions"));
                const { getDocs } = await import("firebase/firestore");
                const snapshot = await getDocs(predictionsQuery);

                // Count unique user IDs (each user can have primary + secondary team)
                const uniqueTeams = new Set<string>();
                snapshot.docs.forEach(doc => {
                    // Path is users/{userId}/predictions/{predId}
                    const pathParts = doc.ref.path.split('/');
                    const userId = pathParts[1];
                    const teamName = doc.data().teamName;
                    // Create unique key for each team (primary vs secondary)
                    uniqueTeams.add(`${userId}_${teamName || 'primary'}`);
                });

                setSubmissionCount(uniqueTeams.size);
            } catch (error) {
                console.error("Error fetching submission count:", error);
                setSubmissionCount(null);
            } finally {
                setIsLoadingCount(false);
            }
        };

        fetchSubmissionCount();
    }, [firestore, selectedRace]);

    // GUID: ADMIN_RESULTS-008-v03
    // [Intent] Memoised Firestore query for fetching all existing race results, ordered by submission date descending.
    // [Inbound Trigger] Evaluated when firestore reference changes. Fed into useCollection hook for real-time data.
    // [Downstream Impact] Drives the "Entered Race Results" table and the race selection dropdown (marking races with existing results in red).
    const resultsQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "race_results"), orderBy("submittedAt", "desc"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: existingResults, isLoading: isLoadingResults } = useCollection<RaceResult>(resultsQuery);

    // GUID: ADMIN_RESULTS-009-v03
    // [Intent] Derived list of F1 drivers not yet placed in any of the 6 result positions, available for selection.
    // [Inbound Trigger] Recalculated on every render when predictions state changes.
    // [Downstream Impact] Drives the "Available Drivers" grid in step 2. Prevents duplicate driver selection.
    const availableDrivers = F1Drivers.filter(
        (d) => !predictions.some((p) => p?.id === d.id)
    );

    // GUID: ADMIN_RESULTS-010-v03
    // [Intent] Add a driver to the first empty position slot in the predictions array.
    // [Inbound Trigger] Called when admin clicks a driver button in the Available Drivers grid.
    // [Downstream Impact] Updates predictions state, which removes the driver from availableDrivers and shows them in the result grid.
    const handleAddDriver = (driver: Driver) => {
        const newPredictions = [...predictions];
        const firstEmptyIndex = newPredictions.findIndex((p) => p === null);
        if (firstEmptyIndex !== -1) {
            newPredictions[firstEmptyIndex] = driver;
            setPredictions(newPredictions);
        }
    };

    // GUID: ADMIN_RESULTS-011-v03
    // [Intent] Remove a driver from a specific position slot, making them available again.
    // [Inbound Trigger] Called when admin clicks the X button on a placed driver in the result grid.
    // [Downstream Impact] Updates predictions state, returning the driver to the Available Drivers grid.
    const handleRemoveDriver = (index: number) => {
        const newPredictions = [...predictions];
        newPredictions[index] = null;
        setPredictions(newPredictions);
    };

    // GUID: ADMIN_RESULTS-012-v03
    // [Intent] Swap a driver with the adjacent position (up or down) to reorder the result.
    // [Inbound Trigger] Called when admin clicks the up/down arrow buttons on a placed driver.
    // [Downstream Impact] Updates predictions state, changing the finishing order which directly affects score calculation.
    const handleMove = (index: number, direction: "up" | "down") => {
        const newPredictions = [...predictions];
        const targetIndex = direction === "up" ? index - 1 : index + 1;

        if (targetIndex >= 0 && targetIndex < newPredictions.length) {
            [newPredictions[index], newPredictions[targetIndex]] = [
                newPredictions[targetIndex],
                newPredictions[index],
            ];
            setPredictions(newPredictions);
        }
    };

    // GUID: ADMIN_RESULTS-013-v03
    // [Intent] Transition from step 1 (race selection) to step 2 (driver entry) after validating a race is selected.
    // [Inbound Trigger] Called when admin clicks "Continue to Enter Results" button.
    // [Downstream Impact] Changes step state to 'enter-results', rendering the driver picker UI.
    const handleProceedToResults = () => {
        if (!selectedRace) {
            toast({ variant: "destructive", title: "Please select a race." });
            return;
        }
        setStep('enter-results');
    };

    // GUID: ADMIN_RESULTS-014-v03
    // [Intent] Navigate back to step 1 (race selection) and reset the driver selections.
    // [Inbound Trigger] Called when admin clicks "Back to Race Selection" button in step 2.
    // [Downstream Impact] Resets predictions array to empty, clearing any partial driver selections.
    const handleBack = () => {
        setStep('select-race');
        setPredictions(Array(6).fill(null));
    };

    // GUID: ADMIN_RESULTS-015-v03
    // [Intent] Validate all 6 positions are filled and open the confirmation dialog before submitting results.
    // [Inbound Trigger] Called when admin clicks "Review & Submit Results" button.
    // [Downstream Impact] Shows confirmation dialog with result summary. Does NOT submit; submission happens in handleConfirmedSubmit.
    const handleSubmitClick = () => {
        if (predictions.some(d => d === null)) {
            toast({ variant: "destructive", title: "Incomplete Podium", description: "Please fill all 6 positions." });
            return;
        }
        setShowConfirmDialog(true);
    };

    // GUID: ADMIN_RESULTS-016-v03
    // [Intent] Generate a compact text summary of the result (e.g., "1-HAM, 2-VER, 3-NOR, ...") for the confirmation dialog.
    // [Inbound Trigger] Called when rendering the confirmation dialog content.
    // [Downstream Impact] Pure display helper; no side effects.
    const getResultSummary = () => {
        return predictions
            .map((driver, index) => `${index + 1}-${driver ? getDriverCode(driver.id) : '???'}`)
            .join(', ');
    };

    // GUID: ADMIN_RESULTS-017-v03
    // [Intent] Submit the confirmed race results to the server-side /api/calculate-scores endpoint for secure score calculation, then trigger email notifications via /api/send-results-email.
    // [Inbound Trigger] Called when admin clicks "Yes, Submit Results" in the confirmation dialog.
    // [Downstream Impact] Creates race_results document, calculates and writes scores for all teams, updates standings, and sends email notifications. This is the critical scoring pipeline trigger.
    const handleConfirmedSubmit = async () => {
        if (!firestore || !user || !firebaseUser || !selectedRace) return;

        setShowConfirmDialog(false);
        setIsSubmitting(true);

        try {
            const raceId = selectedRace.replace(/\s+/g, '-').toLowerCase();

            // SECURITY: Get Firebase ID token for server-side verification
            const idToken = await firebaseUser.getIdToken();

            // Call server-side API for secure score calculation
            const response = await fetch('/api/calculate-scores', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    raceId,
                    raceName: selectedRace,
                    driver1: predictions[0]?.id,
                    driver2: predictions[1]?.id,
                    driver3: predictions[2]?.id,
                    driver4: predictions[3]?.id,
                    driver5: predictions[4]?.id,
                    driver6: predictions[5]?.id,
                }),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Score calculation failed');
            }

            const { scoresUpdated, scores, standings } = result;

            // Send email notifications to users who opted in
            try {
                const officialResult = predictions
                    .map(driver => driver?.name || 'Unknown');

                await fetch('/api/send-results-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        raceId,
                        raceName: selectedRace,
                        officialResult,
                        scores,
                        standings,
                    }),
                });
            } catch (emailError) {
                console.error('Failed to send results emails:', emailError);
            }

            toast({
                title: "Results Submitted!",
                description: `Results for ${selectedRace} recorded. ${scoresUpdated} scores calculated.`,
                duration: 10000,
            });

            // Reset to initial state
            setPredictions(Array(6).fill(null));
            setSelectedRace(undefined);
            setStep('select-race');

        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Submission Failed",
                description: e.message,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // GUID: ADMIN_RESULTS-018-v03
    // [Intent] Delete a race result and its associated scores via the server-side /api/delete-scores endpoint.
    // [Inbound Trigger] Called when admin clicks the trash icon on an existing race result row.
    // [Downstream Impact] Removes race_results document and all associated score documents. Recalculates standings. This is destructive and cannot be undone.
    const handleDelete = async (result: RaceResult) => {
        if (!firestore || !user || !firebaseUser) return;

        setDeletingId(result.id);
        try {
            // SECURITY: Get Firebase ID token for server-side verification
            const idToken = await firebaseUser.getIdToken();

            // Call server-side API for secure score deletion
            const response = await fetch('/api/delete-scores', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    raceId: result.id,
                    raceName: result.raceId,
                }),
            });

            const deleteResult = await response.json();

            if (!deleteResult.success) {
                throw new Error(deleteResult.error || 'Delete failed');
            }

            toast({
                title: "Result Deleted",
                description: `Results for ${result.raceId} have been removed. ${deleteResult.scoresDeleted} scores deleted.`
            });
        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Delete Failed",
                description: e.message,
            });
        } finally {
            setDeletingId(null);
        }
    };

    // GUID: ADMIN_RESULTS-019-v03
    // [Intent] Format a Firestore Timestamp or Date to a human-readable en-GB string (DD Mon YYYY, HH:MM).
    // [Inbound Trigger] Called for each row in the Entered Race Results table.
    // [Downstream Impact] Pure formatting helper; no side effects.
    const formatTimestamp = (timestamp: any) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="space-y-6">
            {/* Confirmation Dialog */}
            <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Race Results</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-4">
                                <p>You are about to submit the following official results:</p>
                                <div className="p-4 bg-muted rounded-lg font-mono text-sm">
                                    <p className="font-bold text-foreground">{selectedRace}</p>
                                    <p className="mt-2 text-foreground">{getResultSummary()}</p>
                                </div>
                                <p className="text-amber-600 dark:text-amber-400">
                                    This will trigger scoring for all {submissionCount || 0} team submissions.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmedSubmit}>
                            Yes, Submit Results
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Step 1: Select Race */}
            {step === 'select-race' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Trophy className="w-5 h-5" />
                            Enter Race Results
                        </CardTitle>
                        <CardDescription>Select a race to enter the official top 6 finishers.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label>Select Race or Sprint</Label>
                            <Select value={selectedRace} onValueChange={setSelectedRace}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a race or sprint..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {(() => {
                                        // Build a set of race IDs that have results
                                        const resultsSet = new Set(
                                            (existingResults || []).map(r => r.id.toLowerCase())
                                        );

                                        // Generate all race events with their status
                                        const raceEvents = RaceSchedule.flatMap(race => {
                                            const events = [];
                                            if (race.hasSprint) {
                                                const sprintId = `${race.name.toLowerCase().replace(/\s+/g, '-')}-sprint`;
                                                events.push({
                                                    value: `${race.name} - Sprint`,
                                                    label: `${race.name} - Sprint`,
                                                    hasResult: resultsSet.has(sprintId),
                                                    raceTime: race.qualifyingTime, // Sprint is before GP
                                                });
                                            }
                                            const gpId = `${race.name.toLowerCase().replace(/\s+/g, '-')}-gp`;
                                            events.push({
                                                value: `${race.name} - GP`,
                                                label: `${race.name} - GP`,
                                                hasResult: resultsSet.has(gpId),
                                                raceTime: race.raceTime,
                                            });
                                            return events;
                                        });

                                        // Find the first race without results (the "next" race)
                                        const nextRaceValue = raceEvents.find(e => !e.hasResult)?.value;

                                        return raceEvents.map(event => {
                                            const isNext = event.value === nextRaceValue;
                                            const hasResult = event.hasResult;

                                            return (
                                                <SelectItem
                                                    key={event.value}
                                                    value={event.value}
                                                    className={cn(
                                                        hasResult && "text-red-600 dark:text-red-400",
                                                        isNext && "text-green-600 dark:text-green-400 font-semibold"
                                                    )}
                                                >
                                                    {hasResult && "✓ "}
                                                    {isNext && "→ "}
                                                    {event.label}
                                                </SelectItem>
                                            );
                                        });
                                    })()}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                <span className="text-green-600 dark:text-green-400">Green</span> = Next race to enter |
                                <span className="text-red-600 dark:text-red-400 ml-1">Red</span> = Results already entered
                            </p>
                        </div>

                        {/* Submission count alert */}
                        {selectedRace && (
                            <Alert variant={submissionCount === 0 ? "destructive" : "default"} className={submissionCount && submissionCount > 0 ? "border-green-500 bg-green-50 dark:bg-green-950" : ""}>
                                {isLoadingCount ? (
                                    <Skeleton className="h-4 w-48" />
                                ) : submissionCount === 0 ? (
                                    <>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>No Predictions Found</AlertTitle>
                                        <AlertDescription>
                                            No teams have any predictions to score.
                                        </AlertDescription>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        <AlertTitle className="text-green-700 dark:text-green-400">
                                            <Users className="inline h-4 w-4 mr-1" />
                                            {submissionCount} Team{submissionCount !== 1 ? 's' : ''} Will Be Scored
                                        </AlertTitle>
                                        <AlertDescription className="text-green-600 dark:text-green-400">
                                            Each team's current prediction will be used.
                                        </AlertDescription>
                                    </>
                                )}
                            </Alert>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleProceedToResults} disabled={!selectedRace || isLoadingCount}>
                            Continue to Enter Results
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {/* Step 2: Enter Results with Driver Picker */}
            {step === 'enter-results' && (
                <div className="space-y-6">
                    <Button variant="ghost" onClick={handleBack} className="mb-2">
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Back to Race Selection
                    </Button>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle className="text-xl flex items-center gap-2">
                                    <Trophy className="w-5 h-5" />
                                    {selectedRace}
                                </CardTitle>
                                <CardDescription className="text-base">
                                    Select the top 6 finishers in order. Click a driver to add them to the results.
                                </CardDescription>
                                {submissionCount !== null && (
                                    <Alert className="mt-4 border-blue-500 bg-blue-50 dark:bg-blue-950">
                                        <Users className="h-4 w-4 text-blue-600" />
                                        <AlertTitle className="text-blue-700 dark:text-blue-400">
                                            {submissionCount} Team{submissionCount !== 1 ? 's' : ''} Will Be Scored
                                        </AlertTitle>
                                        <AlertDescription className="text-blue-600 dark:text-blue-400">
                                            Each team's current prediction will be scored when you confirm.
                                        </AlertDescription>
                                    </Alert>
                                )}
                            </CardHeader>
                            <CardContent>
                                {/* F1-style staggered grid: 2 lanes x 3 rows */}
                                <div className="flex flex-col gap-2 max-w-md mx-auto">
                                    {[0, 1, 2].map((row) => (
                                        <div key={row} className="grid grid-cols-2 gap-4">
                                            {[0, 1].map((col) => {
                                                const index = row * 2 + col;
                                                const driver = predictions[index];
                                                const isRightLane = col === 1;
                                                return (
                                                    <div
                                                        key={index}
                                                        className={cn(
                                                            "relative group flex flex-col items-center gap-2 p-3 rounded-lg border-2 border-dashed bg-card-foreground/5 transition-colors",
                                                            isRightLane && "mt-6"
                                                        )}
                                                    >
                                                        <div className="absolute top-1 left-2 font-bold text-muted-foreground text-sm">P{index + 1}</div>
                                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'up')} disabled={index === 0}>
                                                                <ArrowUp className="h-3 w-3" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'down')} disabled={index === 5}>
                                                                <ArrowDown className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                        {driver ? (
                                                            <>
                                                                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveDriver(index)}>
                                                                    <X className="h-3 w-3" />
                                                                </Button>
                                                                <Avatar className="w-16 h-16 border-4 border-primary">
                                                                    <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait" />
                                                                    <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
                                                                </Avatar>
                                                                <div className="text-center">
                                                                    <p className="font-bold text-sm">{driver.name}</p>
                                                                    <p className="text-xs text-muted-foreground">{driver.team}</p>
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-6">
                                                                <p className="text-xs">Select driver</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button onClick={handleSubmitClick} disabled={isSubmitting || predictions.some(p => p === null)}>
                                    {isSubmitting ? "Submitting..." : "Review & Submit Results"}
                                </Button>
                            </CardFooter>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Available Drivers</CardTitle>
                                <CardDescription>Click a driver to add them to the results.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-96">
                                    <div className="grid grid-cols-2 gap-2">
                                        {availableDrivers.map(driver => (
                                            <Button key={driver.id} variant="secondary" className="h-auto p-2 flex items-center gap-2 justify-start" onClick={() => handleAddDriver(driver)}>
                                                <Avatar className="w-8 h-8">
                                                    <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait" />
                                                    <AvatarFallback>{driver.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <span className="text-sm font-medium">{driver.name}</span>
                                            </Button>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Existing Results Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Entered Race Results</CardTitle>
                    <CardDescription>Results that have been entered and scored. Delete to recalculate standings.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Race</TableHead>
                                <TableHead>Result (P1-P6)</TableHead>
                                <TableHead>Entered At</TableHead>
                                <TableHead className="w-[80px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingResults ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                                    </TableRow>
                                ))
                            ) : existingResults && existingResults.length > 0 ? (
                                existingResults.map((result) => (
                                    <TableRow key={result.id}>
                                        <TableCell className="font-medium">{result.raceId}</TableCell>
                                        <TableCell className="font-mono text-sm">
                                            {formatRaceResultSummary(result)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {formatTimestamp(result.submittedAt)}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleDelete(result)}
                                                disabled={deletingId === result.id}
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        No race results have been entered yet.
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
