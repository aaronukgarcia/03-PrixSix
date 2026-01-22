
'use client';

import { findNextRace, RaceSchedule, F1Drivers, Driver } from "@/lib/data";
import { PredictionEditor } from "./_components/PredictionEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, Users, Info } from "lucide-react";
import { useAuth, useDoc, useFirestore, useCollection } from "@/firebase";
import { useState, useMemo, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { doc, collection, query, orderBy, limit, where } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";

function PredictionsContent() {
  const { user, isUserLoading } = useAuth();
  const firestore = useFirestore();
  const [selectedTeam, setSelectedTeam] = useState(user?.teamName);

  // Fetch all race results to determine which races are closed
  const raceResultsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'race_results'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: raceResults, isLoading: isResultsLoading } = useCollection<{ id: string }>(raceResultsQuery);

  // Find the next open race (first race without GP results entered)
  const nextRace = useMemo(() => {
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));

    // Find first race in schedule without GP results
    for (const race of RaceSchedule) {
      const gpResultId = `${race.name.toLowerCase().replace(/\s+/g, '-')}-gp`;
      if (!resultIds.has(gpResultId)) {
        return race;
      }
    }
    // If all races have results, fall back to findNextRace logic
    return findNextRace();
  }, [raceResults]);

  const raceId = nextRace.name.replace(/\s+/g, '-');

  // Check if pitlane is open: no results AND qualifying hasn't started
  const isPitlaneOpen = useMemo(() => {
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
    const gpResultId = `${nextRace.name.toLowerCase().replace(/\s+/g, '-')}-gp`;
    const hasResults = resultIds.has(gpResultId);

    if (hasResults) return false; // Results entered = closed
    return new Date(nextRace.qualifyingTime) > new Date(); // Otherwise check qualifying time
  }, [raceResults, nextRace]);

  const predictionDocId = useMemo(() => {
    if (!user || !selectedTeam) return null;
    // Determine if the selected team is the primary or secondary
    const teamId = selectedTeam === user.secondaryTeamName ? `${user.id}-secondary` : user.id;
    return `${teamId}_${raceId}`;
  }, [user, selectedTeam, raceId]);

  const predictionRef = useMemo(() => {
    if (!firestore || !user || !predictionDocId) return null;
    const ref = doc(firestore, "users", user.id, "predictions", predictionDocId);
    (ref as any).__memo = true;
    return ref;
  }, [firestore, user, predictionDocId]);

  const { data: predictionData, isLoading: isPredictionLoading } = useDoc(predictionRef);

  // Query to fetch all predictions for this user/team for carry-over logic
  const allPredictionsQuery = useMemo(() => {
    if (!firestore || !user || !selectedTeam) return null;
    const teamId = selectedTeam === user.secondaryTeamName ? `${user.id}-secondary` : user.id;
    const q = query(
      collection(firestore, "users", user.id, "predictions"),
      where("teamId", "==", teamId),
      orderBy("submittedAt", "desc"),
      limit(10) // Get recent predictions for carry-over
    );
    (q as any).__memo = true;
    return q;
  }, [firestore, user, selectedTeam]);

  const { data: allPredictions, isLoading: isAllPredictionsLoading } = useCollection<{
    id: string;
    predictions: string[];
    raceId: string;
    submittedAt: any;
  }>(allPredictionsQuery);

  // Determine if we have a current prediction or need to carry over
  const hasPredictionForCurrentRace = Boolean(
    predictionData?.predictions && Array.isArray(predictionData.predictions) && predictionData.predictions.length > 0
  );

  // Find the previous prediction to carry over (if no current prediction exists)
  const previousPrediction = useMemo(() => {
    if (hasPredictionForCurrentRace) return null;
    if (!allPredictions || allPredictions.length === 0) return null;
    // Find the most recent prediction that's NOT for the current race
    return allPredictions.find(p => p.raceId !== raceId) || null;
  }, [hasPredictionForCurrentRace, allPredictions, raceId]);

  // Track if we're using carried-over predictions
  const isCarriedOver = Boolean(previousPrediction && !hasPredictionForCurrentRace);

  const initialPredictions: (Driver | null)[] = useMemo(() => {
    const filledPredictions: (Driver | null)[] = Array(6).fill(null);

    // First, try to use the current race's prediction
    if (predictionData?.predictions && Array.isArray(predictionData.predictions)) {
      predictionData.predictions.forEach((driverId: string, index: number) => {
        if (driverId && index < 6) {
          filledPredictions[index] = F1Drivers.find(d => d.id === driverId) || null;
        }
      });
      return filledPredictions;
    }

    // If no current prediction, carry over from most recent previous prediction
    if (previousPrediction?.predictions && Array.isArray(previousPrediction.predictions)) {
      previousPrediction.predictions.forEach((driverId: string, index: number) => {
        if (driverId && index < 6) {
          filledPredictions[index] = F1Drivers.find(d => d.id === driverId) || null;
        }
      });
      return filledPredictions;
    }

    return filledPredictions;
  }, [predictionData, previousPrediction]);

  const userTeams = [user?.teamName, user?.secondaryTeamName].filter(Boolean) as string[];

  // This effect ensures selectedTeam is updated if the user prop changes (e.g. on first load)
  useEffect(() => {
    if(user && !selectedTeam) {
      setSelectedTeam(user.teamName);
    }
  }, [user, selectedTeam]);

  const isLoading = isUserLoading || isResultsLoading || (predictionRef && isPredictionLoading) || isAllPredictionsLoading;

  // Determine closure reason for better messaging
  const closureReason = useMemo(() => {
    if (isPitlaneOpen) return null;
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
    const gpResultId = `${nextRace.name.toLowerCase().replace(/\s+/g, '-')}-gp`;
    if (resultIds.has(gpResultId)) return 'results';
    return 'qualifying';
  }, [isPitlaneOpen, raceResults, nextRace]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
            My Predictions
          </h1>
          <p className="text-muted-foreground">
            Set your grid for the {nextRace.name}.
          </p>
        </div>
        {userTeams.length > 1 && (
            <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground"/>
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                        {userTeams.map((teamName) => (
                            <SelectItem key={teamName} value={teamName}>
                                {teamName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        )}
      </div>
      
      {!isPitlaneOpen && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pit Lane Closed!</AlertTitle>
          <AlertDescription>
            {closureReason === 'results'
              ? 'Race results have been entered. Predictions are now locked. You can view your submission below.'
              : 'Qualifying has started, and predictions are now locked. You can view your submission below.'}
          </AlertDescription>
        </Alert>
      )}

      {isPitlaneOpen && isCarriedOver && !isLoading && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Predictions Carried Over</AlertTitle>
          <AlertDescription>
            Your predictions from the previous race have been loaded. Review and submit them for the {nextRace.name}, or make changes before the deadline.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                  <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
                  </CardContent>
              </Card>
            </div>
             <Card>
                <CardHeader><Skeleton className="h-8 w-3/4" /></CardHeader>
                <CardContent><Skeleton className="h-64 w-full" /></CardContent>
            </Card>
        </div>
      ) : (
        <PredictionEditor
          allDrivers={F1Drivers}
          isLocked={!isPitlaneOpen}
          initialPredictions={initialPredictions}
          raceName={nextRace.name}
          teamName={selectedTeam}
          qualifyingTime={nextRace.qualifyingTime}
          allTeamNames={userTeams}
        />
      )}
    </div>
  );
}

export default function PredictionsPage() {
  return <PredictionsContent />;
}
