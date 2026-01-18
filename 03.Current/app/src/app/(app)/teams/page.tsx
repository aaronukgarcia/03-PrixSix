
'use client';

import { useMemo, useState } from "react";
import { useCollection, useFirestore } from "@/firebase";
import type { User } from "@/firebase/provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RaceSchedule, getDriverImage, F1Drivers, Driver } from "@/lib/data";
import { collection, query, where, collectionGroup } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";

interface Prediction {
    id: string;
    userId: string;
    teamName: string;
    raceId: string;
    driver1: string;
    driver2: string;
    driver3: string;
    driver4: string;
    driver5: string;
    driver6: string;
}

export default function TeamsPage() {
  const firestore = useFirestore();
  const races = RaceSchedule.map((r) => r.name);
  const [selectedRace, setSelectedRace] = useState(races[races.length - 1]);
  const selectedRaceId = selectedRace.replace(/\s+/g, '-');

  const usersQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, "users"));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const predictionsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(
      collectionGroup(firestore, "predictions"),
      where("raceId", "==", selectedRaceId)
    );
    (q as any).__memo = true;
    return q;
  }, [firestore, selectedRaceId]);
  
  const { data: users, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);
  const { data: predictions, isLoading: isLoadingPredictions } = useCollection<Prediction>(predictionsQuery);

  const teamsWithPredictions = useMemo(() => {
    if (!users) return [];

    return users.map(user => {
      const allUserPredictions = predictions?.filter(p => p.userId === user.id) || [];
      
      const mainTeamPrediction = allUserPredictions.find(p => p.teamName === user.teamName);
      const secondaryTeamPrediction = user.secondaryTeamName ? allUserPredictions.find(p => p.teamName === user.secondaryTeamName) : undefined;

      const formatPrediction = (predictionDoc: Prediction | undefined) => {
        if (!predictionDoc) return Array(6).fill(null);
        const driverIds = [
            predictionDoc.driver1, predictionDoc.driver2, predictionDoc.driver3,
            predictionDoc.driver4, predictionDoc.driver5, predictionDoc.driver6
        ];
        return driverIds.map(id => F1Drivers.find(d => d.id === id) || null);
      }
      
      const result = [{
        teamName: user.teamName,
        predictions: formatPrediction(mainTeamPrediction),
      }];

      if (user.secondaryTeamName) {
        result.push({
            teamName: user.secondaryTeamName,
            predictions: formatPrediction(secondaryTeamPrediction),
        });
      }

      return result;
    }).flat();
  }, [users, predictions]);

  const isLoading = isLoadingUsers || isLoadingPredictions;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Team Predictions
        </h1>
        <p className="text-muted-foreground">
          See what your rivals are predicting for each race.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>All Team Submissions</CardTitle>
              <CardDescription>Select a race to view predictions.</CardDescription>
            </div>
            <Select value={selectedRace} onValueChange={setSelectedRace}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Select a race" />
              </SelectTrigger>
              <SelectContent>
                {races.map((race) => (
                  <SelectItem key={race} value={race}>
                    {race}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {isLoading ? (
                Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-14 w-full mb-2"/>)
            ) : teamsWithPredictions.map((team) => (
              <AccordionItem value={team.teamName} key={team.teamName}>
                <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                    {team.teamName}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 pt-4">
                    {team.predictions.map((driver, index) => (
                      <div key={driver?.id || index} className="flex flex-col items-center gap-2 p-2 rounded-lg border bg-card-foreground/5">
                        <div className="font-bold text-accent text-2xl">P{index + 1}</div>
                        {driver ? (
                          <>
                            <Avatar className="w-16 h-16 border-2 border-primary">
                              <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait"/>
                              <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
                            </Avatar>
                            <div className="text-center">
                              <p className="font-semibold">{driver.name}</p>
                              <p className="text-xs text-muted-foreground">{driver.team}</p>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Avatar className="w-16 h-16 border-2 border-dashed">
                               <AvatarFallback>?</AvatarFallback>
                            </Avatar>
                             <div className="text-center">
                              <p className="font-semibold text-muted-foreground">Empty</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
