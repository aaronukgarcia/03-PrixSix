// GUID: PAGE_PREDICTIONS-000-v03
// [Intent] Predictions page — allows users to view, submit, and edit their driver predictions
//          for the next open race. Supports multiple teams, prediction carry-over from previous
//          races, and pit lane open/closed status based on qualifying time and race results.
// [Inbound Trigger] User navigates to /predictions from dashboard or navigation.
// [Downstream Impact] Renders PredictionEditor with driver data, lock state, and initial predictions.
//                     Reads from Firestore: race_results, user predictions. Writes via PredictionEditor.

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
import { generateRaceId, generateRaceIdLowercase } from "@/lib/normalize-race-id";

// GUID: PAGE_PREDICTIONS-001-v03
// [Intent] Inner content component encapsulating all prediction logic — determines next open race,
//          checks pit lane status, loads current/previous predictions, and renders the editor.
// [Inbound Trigger] Rendered by PredictionsPage wrapper component.
// [Downstream Impact] Fetches race_results collection to find next unscored race. Loads user prediction
//                     doc and previous predictions for carry-over. Passes data to PredictionEditor.
function PredictionsContent() {
  const { user, isUserLoading } = useAuth();
  const firestore = useFirestore();
  const [selectedTeam, setSelectedTeam] = useState(user?.teamName);

  // GUID: PAGE_PREDICTIONS-002-v03
  // [Intent] Real-time query for all race_results documents to determine which races are complete.
  // [Inbound Trigger] firestore becomes available.
  // [Downstream Impact] Used by nextRace and isPitlaneOpen computations to find the first unscored race.
  const raceResultsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'race_results'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: raceResults, isLoading: isResultsLoading } = useCollection<{ id: string }>(raceResultsQuery);

  // GUID: PAGE_PREDICTIONS-003-v03
  // [Intent] Computes the next open race by finding the first race in the schedule without
  //          GP results in Firestore. Falls back to findNextRace() if all races have results.
  // [Inbound Trigger] raceResults collection data changes.
  // [Downstream Impact] Determines which race the predictions page targets (raceId, name, times).
  const nextRace = useMemo(() => {
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));

    // Find first race in schedule without GP results
    for (const race of RaceSchedule) {
      const gpResultId = generateRaceIdLowercase(race.name, 'gp');
      if (!resultIds.has(gpResultId)) {
        return race;
      }
    }
    // If all races have results, fall back to findNextRace logic
    return findNextRace();
  }, [raceResults]);

  // @CASE_FIX: Use generateRaceId() for Title-Case consistency (Golden Rule #3)
  const raceId = generateRaceId(nextRace.name, 'gp');

  // GUID: PAGE_PREDICTIONS-004-v03
  // [Intent] Determines if the pit lane is open (predictions allowed) by checking both
  //          race results existence and qualifying start time.
  // [Inbound Trigger] raceResults or nextRace changes.
  // [Downstream Impact] Controls PredictionEditor lock state and "Pit Lane Closed" alert display.
  const isPitlaneOpen = useMemo(() => {
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
    const gpResultId = generateRaceIdLowercase(nextRace.name, 'gp');
    const hasResults = resultIds.has(gpResultId);

    if (hasResults) return false; // Results entered = closed
    return new Date(nextRace.qualifyingTime) > new Date(); // Otherwise check qualifying time
  }, [raceResults, nextRace]);

  // GUID: PAGE_PREDICTIONS-005-v03
  // [Intent] Constructs the Firestore prediction document ID from team ID and race ID.
  //          Handles primary vs secondary team distinction using "-secondary" suffix.
  // [Inbound Trigger] user, selectedTeam, or raceId changes.
  // [Downstream Impact] Used to build the Firestore document reference for the current prediction.
  const predictionDocId = useMemo(() => {
    if (!user || !selectedTeam) return null;
    // Determine if the selected team is the primary or secondary
    const teamId = selectedTeam === user.secondaryTeamName ? `${user.id}-secondary` : user.id;
    return `${teamId}_${raceId}`;
  }, [user, selectedTeam, raceId]);

  // GUID: PAGE_PREDICTIONS-006-v03
  // [Intent] Memoised Firestore document reference for the user's prediction for the current race/team.
  // [Inbound Trigger] firestore, user, or predictionDocId changes.
  // [Downstream Impact] Passed to useDoc for real-time prediction data subscription.
  const predictionRef = useMemo(() => {
    if (!firestore || !user || !predictionDocId) return null;
    const ref = doc(firestore, "users", user.id, "predictions", predictionDocId);
    (ref as any).__memo = true;
    return ref;
  }, [firestore, user, predictionDocId]);

  const { data: predictionData, isLoading: isPredictionLoading } = useDoc(predictionRef);

  // GUID: PAGE_PREDICTIONS-007-v03
  // [Intent] Query to fetch recent predictions for the selected team, used for carry-over logic
  //          when no prediction exists for the current race.
  // [Inbound Trigger] firestore, user, or selectedTeam changes.
  // [Downstream Impact] Provides allPredictions data used by previousPrediction carry-over memo.
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

  const { data: allPredictions, isLoading: isAllPredictionsLoading, error: allPredictionsError } = useCollection<{
    id: string;
    predictions: string[];
    raceId: string;
    submittedAt: any;
  }>(allPredictionsQuery);

  // GUID: PAGE_PREDICTIONS-008-v03
  // [Intent] Logs errors from the allPredictions query (e.g., missing composite index, permissions).
  // [Inbound Trigger] allPredictionsError changes.
  // [Downstream Impact] Console error for debugging; does not block page rendering.
  useEffect(() => {
    if (allPredictionsError) {
      console.error('[Predictions] Error fetching all predictions:', allPredictionsError);
    }
  }, [allPredictionsError]);

  // Determine if we have a current prediction or need to carry over
  const hasPredictionForCurrentRace = Boolean(
    predictionData?.predictions && Array.isArray(predictionData.predictions) && predictionData.predictions.length > 0
  );

  // GUID: PAGE_PREDICTIONS-009-v03
  // [Intent] Finds the most recent previous prediction (not for the current race) to carry over
  //          when the user has no prediction for this race. Skips if query failed.
  // [Inbound Trigger] hasPredictionForCurrentRace, allPredictions, allPredictionsError, or raceId changes.
  // [Downstream Impact] If found, previousPrediction populates initialPredictions for PredictionEditor.
  const previousPrediction = useMemo(() => {
    if (hasPredictionForCurrentRace) return null;
    if (allPredictionsError) return null; // Skip if query failed
    if (!allPredictions || allPredictions.length === 0) return null;
    // Find the most recent prediction that's NOT for the current race
    return allPredictions.find(p => p.raceId !== raceId) || null;
  }, [hasPredictionForCurrentRace, allPredictions, allPredictionsError, raceId]);

  // Track if we're using carried-over predictions
  const isCarriedOver = Boolean(previousPrediction && !hasPredictionForCurrentRace);

  // GUID: PAGE_PREDICTIONS-010-v03
  // [Intent] Builds the initial 6-slot driver prediction array from either the current race
  //          prediction or the carried-over previous prediction. Resolves driver IDs to Driver objects.
  // [Inbound Trigger] predictionData or previousPrediction changes.
  // [Downstream Impact] Passed as initialPredictions to PredictionEditor for grid display.
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

  // GUID: PAGE_PREDICTIONS-011-v03
  // [Intent] Ensures selectedTeam is set once user data loads (handles initial mount race condition).
  // [Inbound Trigger] user or selectedTeam changes.
  // [Downstream Impact] Sets selectedTeam to user's primary team if not already set.
  useEffect(() => {
    if(user && !selectedTeam) {
      setSelectedTeam(user.teamName);
    }
  }, [user, selectedTeam]);

  // Don't block on allPredictions loading/error - it's only for carry-over which is optional
  const isLoading = isUserLoading || isResultsLoading || (predictionRef && isPredictionLoading);

  // GUID: PAGE_PREDICTIONS-012-v03
  // [Intent] Determines why the pit lane is closed — either race results entered or qualifying started.
  //          Used for more specific messaging in the closure alert.
  // [Inbound Trigger] isPitlaneOpen, raceResults, or nextRace changes.
  // [Downstream Impact] Controls the text in the "Pit Lane Closed" alert description.
  const closureReason = useMemo(() => {
    if (isPitlaneOpen) return null;
    const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
    const gpResultId = generateRaceIdLowercase(nextRace.name, 'gp');
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

// GUID: PAGE_PREDICTIONS-013-v03
// [Intent] Exported page wrapper that renders PredictionsContent.
// [Inbound Trigger] Route navigation to /predictions.
// [Downstream Impact] Mounts PredictionsContent which handles all prediction logic and UI.
export default function PredictionsPage() {
  return <PredictionsContent />;
}
