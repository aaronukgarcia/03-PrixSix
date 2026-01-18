
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useFirestore } from "@/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";

interface ScoringRules {
    exact: number;
    inTop6: number;
    bonus: number;
}

export function ScoringManager() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [scoring, setScoring] = useState<ScoringRules | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!firestore) return;
        const fetchScoring = async () => {
            const docRef = doc(firestore, "admin_configuration", "scoring");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setScoring(docSnap.data() as ScoringRules);
            } else {
                setScoring({ exact: 5, inTop6: 3, bonus: 10 }); // Default values
            }
            setIsLoading(false);
        }
        fetchScoring();
    }, [firestore]);


    const handleSave = async () => {
        if (!firestore || !scoring) return;
        setIsSaving(true);
        try {
            const docRef = doc(firestore, "admin_configuration", "scoring");
            await setDoc(docRef, scoring, { merge: true });
            toast({
                title: "Scoring Rules Updated",
                description: "Points have been adjusted for future races."
            });
        } catch (e: any) {
             toast({
                variant: "destructive",
                title: "Save Failed",
                description: e.message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setScoring(prev => prev ? { ...prev, [name]: Number(value) } : null);
    }

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-10 w-32" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Global Scoring</CardTitle>
                <CardDescription>Adjust the points awarded for predictions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="exact">Correct Position</Label>
                        <Input 
                            id="exact"
                            name="exact" 
                            type="number"
                            value={scoring?.exact}
                            onChange={handleChange}
                            placeholder="Points for exact position" 
                        />
                        <p className="text-sm text-muted-foreground">Points for each driver predicted in their exact finishing position.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="inTop6">Correct Driver, Wrong Position</Label>
                        <Input 
                            id="inTop6"
                            name="inTop6"
                            type="number" 
                            value={scoring?.inTop6}
                            onChange={handleChange}
                            placeholder="Points for correct driver" 
                        />
                        <p className="text-sm text-muted-foreground">Points for each driver in the top 6, but in the wrong position.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="bonus">All 6 Drivers Bonus</Label>
                        <Input 
                            id="bonus"
                            name="bonus" 
                            type="number" 
                            value={scoring?.bonus}
                            onChange={handleChange}
                            placeholder="Bonus points" 
                        />
                        <p className="text-sm text-muted-foreground">Bonus points for correctly predicting all 6 drivers in the top 6.</p>
                    </div>
                </div>

                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Update Scoring Rules"}
                </Button>
            </CardContent>
        </Card>
    );
}
