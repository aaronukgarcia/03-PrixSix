
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { F1Drivers, RaceSchedule } from "@/lib/data";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { useFirestore, addDocumentNonBlocking } from "@/firebase";
import { collection, serverTimestamp } from "firebase/firestore";

export function ResultsManager() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [selectedRace, setSelectedRace] = useState<string | undefined>(undefined);
    const [podium, setPodium] = useState<(string | undefined)[]>(Array(6).fill(undefined));
    const [isSubmitting, setIsSubmitting] = useState(false);

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
        if (!firestore) return;
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
            const resultsRef = collection(firestore, "race_results");
            
            await addDocumentNonBlocking(resultsRef, {
                id: raceId,
                raceId: selectedRace,
                driver1: podium[0],
                driver2: podium[1],
                driver3: podium[2],
                driver4: podium[3],
                driver5: podium[4],
                driver6: podium[5],
                submittedAt: serverTimestamp(),
            });

            toast({
                title: "Results Submitted!",
                description: `Results for the ${selectedRace} have been recorded and scoring will be processed.`
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


    return (
        <Card>
            <CardHeader>
                <CardTitle>Enter Race Results</CardTitle>
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
    );
}
