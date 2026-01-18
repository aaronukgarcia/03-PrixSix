
"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Driver } from "@/lib/data";
import { getDriverImage } from "@/lib/data";
import { ArrowDown, ArrowUp, X, Check, ListCollapse } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth, useFirestore, setDocumentNonBlocking } from "@/firebase";
import { doc, serverTimestamp } from "firebase/firestore";

interface PredictionEditorProps {
  allDrivers: Driver[];
  isLocked: boolean;
  initialPredictions: (Driver | null)[];
  raceName: string;
  teamName?: string;
}

export function PredictionEditor({ allDrivers, isLocked, initialPredictions, raceName, teamName }: PredictionEditorProps) {
  const { user } = useAuth();
  const firestore = useFirestore();
  const [predictions, setPredictions] = useState<(Driver | null)[]>(initialPredictions);
  const [history, setHistory] = useState<string[]>([]);
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableDrivers = allDrivers.filter(
    (d) => !predictions.some((p) => p?.id === d.id)
  );

  const addChangeToHistory = (change: string) => {
    setHistory(prev => [change, ...prev].slice(0, 5));
  }

  const handleAddDriver = (driver: Driver) => {
    if (isLocked) return;
    const newPredictions = [...predictions];
    const firstEmptyIndex = newPredictions.findIndex((p) => p === null);
    if (firstEmptyIndex !== -1) {
      newPredictions[firstEmptyIndex] = driver;
      setPredictions(newPredictions);
      addChangeToHistory(`+ ${driver.name} to P${firstEmptyIndex + 1}`);
    }
  };

  const handleRemoveDriver = (index: number) => {
    if (isLocked) return;
    const driverName = predictions[index]?.name;
    const newPredictions = [...predictions];
    newPredictions[index] = null;
    setPredictions(newPredictions);
    if(driverName) addChangeToHistory(`- ${driverName} from grid`);
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    if (isLocked) return;
    const newPredictions = [...predictions];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newPredictions.length) {
      [newPredictions[index], newPredictions[targetIndex]] = [
        newPredictions[targetIndex],
        newPredictions[index],
      ];
      setPredictions(newPredictions);
      const driver1 = newPredictions[index]?.name;
      const driver2 = newPredictions[targetIndex]?.name;
      if(driver1 && driver2) addChangeToHistory(`↔️ Swapped ${driver1} / ${driver2}`);
    }
  };

  const handleSubmit = async () => {
    if (!user || !firestore || !teamName) {
        toast({ variant: "destructive", title: "Error", description: "User or team not identified." });
        return;
    }
    const isComplete = predictions.every(p => p !== null);
    if (!isComplete) {
        toast({
            variant: "destructive",
            title: "Incomplete Grid",
            description: "You must select 6 drivers to submit your prediction."
        })
        return;
    }

    setIsSubmitting(true);
    try {
        const teamId = teamName === user.secondaryTeamName ? `${user.id}-secondary` : user.id;
        const raceId = raceName.replace(/\s+/g, '-');
        const predictionId = `${teamId}_${raceId}`;
        const predictionRef = doc(firestore, "users", user.id, "predictions", predictionId);

        const predictionData = {
            id: predictionId,
            userId: user.id, // The auth user
            teamId: teamId, // The ID of the team making the prediction
            teamName: teamName,
            raceId: raceId,
            raceName: raceName,
            driver1: predictions[0]?.id,
            driver2: predictions[1]?.id,
            driver3: predictions[2]?.id,
            driver4: predictions[3]?.id,
            driver5: predictions[4]?.id,
            driver6: predictions[5]?.id,
            submissionTimestamp: serverTimestamp(),
        };

        setDocumentNonBlocking(predictionRef, predictionData, { merge: true });

        toast({
            title: "Prediction Submitted!",
            description: `Your grid for ${teamName} is locked in. Good luck!`,
        });

    } catch (e: any) {
        toast({
            variant: "destructive",
            title: "Submission Failed",
            description: e.message
        });
    } finally {
        setIsSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your Prediction Grid for <span className="text-accent">{teamName}</span></CardTitle>
          <CardDescription>
            {isLocked ? "Your submitted grid for this race." : "Select drivers from the list to fill your grid. Your previous prediction is pre-loaded."}
          </CardDescription>
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
                        isRightLane && "mt-6" // Stagger right lane back
                      )}
                    >
                      <div className="absolute top-1 left-2 font-bold text-muted-foreground text-sm">P{index + 1}</div>
                      {!isLocked && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'up')} disabled={index === 0}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'down')} disabled={index === 5}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {driver ? (
                        <>
                          {!isLocked && (
                            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveDriver(index)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                          <Avatar className="w-16 h-16 border-4 border-primary">
                            <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait"/>
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
            <Button onClick={handleSubmit} disabled={isLocked || isSubmitting}>
                <Check className="mr-2 h-4 w-4"/>
                {isSubmitting ? "Submitting..." : "Submit Predictions"}
            </Button>
        </CardFooter>
      </Card>
      
      <div className="space-y-6">
        <Card className={cn(isLocked && "hidden")}>
            <CardHeader>
                <CardTitle>Available Drivers</CardTitle>
                <CardDescription>Click a driver to add them to your grid.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-72">
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
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ListCollapse className="h-5 w-5"/>
                    Change Log
                </CardTitle>
                <CardDescription>Your recent prediction changes.</CardDescription>
            </CardHeader>
            <CardContent>
                {history.length > 0 ? (
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        {history.map((change, index) => (
                            <li key={index} className={cn("transition-opacity", index > 0 && "opacity-70", index > 2 && "opacity-50")}>{change}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">No changes made in this session yet.</p>
                )}
            </CardContent>
        </Card>
      </div>

    </div>
  );
}
