
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { F1Drivers, RaceSchedule } from "@/lib/data";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { useFirestore, useCollection, useAuth } from "@/firebase";
import { collection, serverTimestamp, doc, setDoc, deleteDoc, query, orderBy } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { logAuditEvent } from "@/lib/audit";
import { updateRaceScores, deleteRaceScores, formatRaceResultSummary } from "@/lib/scoring";

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

export function ResultsManager() {
    const firestore = useFirestore();
    const { user } = useAuth();
    const { toast } = useToast();
    const [selectedRace, setSelectedRace] = useState<string | undefined>(undefined);
    const [podium, setPodium] = useState<(string | undefined)[]>(Array(6).fill(undefined));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Fetch existing race results
    const resultsQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, "race_results"), orderBy("submittedAt", "desc"));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: existingResults, isLoading: isLoadingResults } = useCollection<RaceResult>(resultsQuery);

    const handleDriverSelect = (position: number, driverId: string) => {
        const newPodium = [...podium];
        if (newPodium[position] === driverId) {
            return;
        }

        if (newPodium.includes(driverId)) {
            toast({
                variant: "destructive",
                title: "Driver Already Selected",
                description: "This driver has already been placed in another position."
            });
            return;
        }

        newPodium[position] = driverId;
        setPodium(newPodium);
    };

    const handleSubmit = async () => {
        if (!firestore || !user) return;
        if (!selectedRace) {
            toast({ variant: "destructive", title: "Please select a race." });
            return;
        }
        if (podium.some(d => d === undefined)) {
            toast({ variant: "destructive", title: "Incomplete Podium", description: "Please fill all 6 positions." });
            return;
        }

        setIsSubmitting(true);
        try {
            const raceId = selectedRace.replace(/\s+/g, '-').toLowerCase();
            const resultDocRef = doc(firestore, "race_results", raceId);

            const raceResultData = {
                id: raceId,
                raceId: selectedRace,
                driver1: podium[0],
                driver2: podium[1],
                driver3: podium[2],
                driver4: podium[3],
                driver5: podium[4],
                driver6: podium[5],
                submittedAt: serverTimestamp(),
            };

            await setDoc(resultDocRef, raceResultData);

            // Calculate and update scores
            const scoresUpdated = await updateRaceScores(firestore, raceId, raceResultData as RaceResult);

            // Log to audit
            const resultSummary = formatRaceResultSummary(raceResultData as RaceResult);
            logAuditEvent(firestore, user.id, 'race_result_entered', {
                raceId,
                raceName: selectedRace,
                result: resultSummary,
                scoresUpdated,
                submittedAt: new Date().toISOString(),
            });

            toast({
                title: "Results Submitted!",
                description: `Results for ${selectedRace} recorded. ${scoresUpdated} scores calculated.`
            });
            setPodium(Array(6).fill(undefined));
            setSelectedRace(undefined);
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
            // Delete the race result
            const resultDocRef = doc(firestore, "race_results", result.id);
            await deleteDoc(resultDocRef);

            // Delete associated scores
            const deletedScores = await deleteRaceScores(firestore, result.id);

            // Log to audit
            const resultSummary = formatRaceResultSummary(result);
            logAuditEvent(firestore, user.id, 'race_result_deleted', {
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
            {/* Enter New Results Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Trophy className="w-5 h-5" />
                        Enter Race Results
                    </CardTitle>
                    <CardDescription>Submit the top 6 finishers for a race to trigger scoring.</CardDescription>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {podium.map((_, index) => {
                            const availableDrivers = F1Drivers.filter(
                                (driver) => !podium.includes(driver.id) || podium[index] === driver.id
                            );
                            return (
                            <div key={index} className="space-y-2">
                                <Label>P{index + 1}</Label>
                                <Select
                                    value={podium[index]}
                                    onValueChange={(driverId) => handleDriverSelect(index, driverId)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={`Select P${index + 1}...`} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableDrivers.map(driver => (
                                            <SelectItem key={driver.id} value={driver.id}>
                                                {driver.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )})}
                    </div>

                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "Submitting..." : "Submit Results"}
                    </Button>
                </CardContent>
            </Card>

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
