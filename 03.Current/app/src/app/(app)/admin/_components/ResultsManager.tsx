
"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { F1Drivers, RaceSchedule, getDriverImage, Driver } from "@/lib/data";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { useFirestore, useCollection, useAuth } from "@/firebase";
import { collection, serverTimestamp, doc, setDoc, deleteDoc, query, orderBy, where, getCountFromServer } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Trophy, Users, AlertCircle, CheckCircle2, ArrowUp, ArrowDown, X, ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { logAuditEvent } from "@/lib/audit";
import { updateRaceScores, deleteRaceScores, formatRaceResultSummary } from "@/lib/scoring";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// Helper to normalize raceId to match prediction format
function normalizeRaceId(raceId: string): string {
    let baseName = raceId
        .replace(/\s*-\s*GP$/i, '')
        .replace(/\s*-\s*Sprint$/i, '');
    return baseName.replace(/\s+/g, '-');
}

// Helper to format driver code (e.g., "hamilton" -> "HAM")
function getDriverCode(driverId: string): string {
    const driver = F1Drivers.find(d => d.id === driverId);
    if (!driver) return driverId.substring(0, 3).toUpperCase();
    // Use first 3 letters of last name
    const lastName = driver.name.split(' ').pop() || driver.name;
    return lastName.substring(0, 3).toUpperCase();
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

type Step = 'select-race' | 'enter-results';

export function ResultsManager() {
    const firestore = useFirestore();
    const { user } = useAuth();
    const { toast } = useToast();

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

    // Fetch submission count when race is selected
    useEffect(() => {
        if (!firestore || !selectedRace) {
            setSubmissionCount(null);
            return;
        }

        const fetchSubmissionCount = async () => {
            setIsLoadingCount(true);
            try {
                const normalizedId = normalizeRaceId(selectedRace);
                const countQuery = query(
                    collection(firestore, "prediction_submissions"),
                    where("raceId", "==", normalizedId)
                );
                const countSnapshot = await getCountFromServer(countQuery);
                setSubmissionCount(countSnapshot.data().count);
            } catch (error) {
                console.error("Error fetching submission count:", error);
                setSubmissionCount(null);
            } finally {
                setIsLoadingCount(false);
            }
        };

        fetchSubmissionCount();
    }, [firestore, selectedRace]);

    // Fetch existing race results
    const resultsQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "race_results"), orderBy("submittedAt", "desc"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: existingResults, isLoading: isLoadingResults } = useCollection<RaceResult>(resultsQuery);

    // Available drivers (not yet selected)
    const availableDrivers = F1Drivers.filter(
        (d) => !predictions.some((p) => p?.id === d.id)
    );

    const handleAddDriver = (driver: Driver) => {
        const newPredictions = [...predictions];
        const firstEmptyIndex = newPredictions.findIndex((p) => p === null);
        if (firstEmptyIndex !== -1) {
            newPredictions[firstEmptyIndex] = driver;
            setPredictions(newPredictions);
        }
    };

    const handleRemoveDriver = (index: number) => {
        const newPredictions = [...predictions];
        newPredictions[index] = null;
        setPredictions(newPredictions);
    };

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

    const handleProceedToResults = () => {
        if (!selectedRace) {
            toast({ variant: "destructive", title: "Please select a race." });
            return;
        }
        setStep('enter-results');
    };

    const handleBack = () => {
        setStep('select-race');
        setPredictions(Array(6).fill(null));
    };

    const handleSubmitClick = () => {
        if (predictions.some(d => d === null)) {
            toast({ variant: "destructive", title: "Incomplete Podium", description: "Please fill all 6 positions." });
            return;
        }
        setShowConfirmDialog(true);
    };

    const getResultSummary = () => {
        return predictions
            .map((driver, index) => `${index + 1}-${driver ? getDriverCode(driver.id) : '???'}`)
            .join(', ');
    };

    const handleConfirmedSubmit = async () => {
        if (!firestore || !user || !selectedRace) return;

        setShowConfirmDialog(false);
        setIsSubmitting(true);

        try {
            const raceId = selectedRace.replace(/\s+/g, '-').toLowerCase();
            const resultDocRef = doc(firestore, "race_results", raceId);

            const raceResultData = {
                id: raceId,
                raceId: selectedRace,
                driver1: predictions[0]?.id,
                driver2: predictions[1]?.id,
                driver3: predictions[2]?.id,
                driver4: predictions[3]?.id,
                driver5: predictions[4]?.id,
                driver6: predictions[5]?.id,
                submittedAt: serverTimestamp(),
            };

            await setDoc(resultDocRef, raceResultData);

            // Calculate and update scores
            const { scoresUpdated, scores, standings } = await updateRaceScores(firestore, raceId, raceResultData as RaceResult);

            // Log to audit
            const resultSummary = formatRaceResultSummary(raceResultData as RaceResult);
            logAuditEvent(firestore, user.id, 'RACE_RESULTS_SUBMITTED', {
                raceId,
                raceName: selectedRace,
                result: resultSummary,
                scoresUpdated,
                submittedAt: new Date().toISOString(),
            });

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

    const handleDelete = async (result: RaceResult) => {
        if (!firestore || !user) return;

        setDeletingId(result.id);
        try {
            const resultDocRef = doc(firestore, "race_results", result.id);
            await deleteDoc(resultDocRef);

            const deletedScores = await deleteRaceScores(firestore, result.id);

            const resultSummary = formatRaceResultSummary(result);
            logAuditEvent(firestore, user.id, 'RACE_RESULTS_DELETED', {
                raceId: result.id,
                raceName: result.raceId,
                result: resultSummary,
                scoresDeleted: deletedScores,
                deletedAt: new Date().toISOString(),
            });

            toast({
                title: "Result Deleted",
                description: `Results for ${result.raceId} have been removed. ${deletedScores} scores deleted.`
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
                                    {RaceSchedule.flatMap(race => {
                                        const raceEvents = [];
                                        if (race.hasSprint) {
                                            raceEvents.push({ value: `${race.name} - Sprint`, label: `${race.name} - Sprint` });
                                        }
                                        raceEvents.push({ value: `${race.name} - GP`, label: `${race.name} - GP` });
                                        return raceEvents;
                                    }).map(event => (
                                        <SelectItem key={event.value} value={event.value}>{event.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Submission count alert */}
                        {selectedRace && (
                            <Alert variant={submissionCount === 0 ? "destructive" : "default"} className={submissionCount && submissionCount > 0 ? "border-green-500 bg-green-50 dark:bg-green-950" : ""}>
                                {isLoadingCount ? (
                                    <Skeleton className="h-4 w-48" />
                                ) : submissionCount === 0 ? (
                                    <>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>No Submissions Found</AlertTitle>
                                        <AlertDescription>
                                            No teams have submitted predictions for this race yet.
                                        </AlertDescription>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        <AlertTitle className="text-green-700 dark:text-green-400">
                                            <Users className="inline h-4 w-4 mr-1" />
                                            {submissionCount} Team{submissionCount !== 1 ? 's' : ''} Submitted
                                        </AlertTitle>
                                        <AlertDescription className="text-green-600 dark:text-green-400">
                                            Ready to enter results and calculate scores.
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
                                            {submissionCount} Team{submissionCount !== 1 ? 's' : ''} Submitted Predictions
                                        </AlertTitle>
                                        <AlertDescription className="text-blue-600 dark:text-blue-400">
                                            Scores will be calculated for all submissions when you confirm.
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
