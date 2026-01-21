
"use client";

import { useAuth, useFirestore, useDoc } from "@/firebase";
import type { Race } from "@/lib/data";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { doc } from "firebase/firestore";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const calculateTimeLeft = (targetDate: string): TimeLeft | null => {
  const difference = +new Date(targetDate) - +new Date();
  if (difference > 0) {
    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
    };
  }
  return null;
};

export function DashboardClient({ nextRace }: { nextRace: Race }) {
  const { user } = useAuth();
  const firestore = useFirestore();
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(() => calculateTimeLeft(nextRace.qualifyingTime));

  const raceId = nextRace.name.replace(/\s+/g, '-');
  const isPitlaneOpen = new Date(nextRace.qualifyingTime) > new Date();

  // Check if user has a prediction for this race
  const predictionDocId = useMemo(() => {
    if (!user) return null;
    return `${user.id}_${raceId}`;
  }, [user, raceId]);

  const predictionRef = useMemo(() => {
    if (!firestore || !user || !predictionDocId) return null;
    const ref = doc(firestore, "users", user.id, "predictions", predictionDocId);
    (ref as any).__memo = true;
    return ref;
  }, [firestore, user, predictionDocId]);

  const { data: predictionData, isLoading: isPredictionLoading } = useDoc(predictionRef);

  const hasPrediction = predictionData?.predictions && Array.isArray(predictionData.predictions) && predictionData.predictions.length > 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimeLeft(calculateTimeLeft(nextRace.qualifyingTime));
    }, 1000);

    return () => clearTimeout(timer);
  });

  // Determine action text based on prediction status
  const getActionText = () => {
    if (isPredictionLoading) return "Checking...";
    return hasPrediction ? "Edit Prediction" : "Submit Prediction";
  };

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Welcome, Team Principal!
        </h1>
        <p className="text-muted-foreground">
          You are leading <span className="font-semibold text-accent">{user?.teamName}</span> for the {nextRace.name}.
        </p>
      </div>

       <Card className="bg-gradient-to-r from-primary/80 to-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2 text-primary-foreground">
              <CardTitle className="text-sm font-medium">Time to Qualifying</CardTitle>
              <Clock className="h-4 w-4 text-primary-foreground/80" />
          </CardHeader>
          <CardContent>
              {timeLeft ? (
              <div className="grid grid-cols-4 gap-2 text-center text-primary-foreground">
                  <div>
                      <div className="text-4xl font-bold">{String(timeLeft.days).padStart(2, '0')}</div>
                      <div className="text-xs uppercase opacity-80">Days</div>
                  </div>
                  <div>
                      <div className="text-4xl font-bold">{String(timeLeft.hours).padStart(2, '0')}</div>
                      <div className="text-xs uppercase opacity-80">Hours</div>
                  </div>
                  <div>
                      <div className="text-4xl font-bold">{String(timeLeft.minutes).padStart(2, '0')}</div>
                      <div className="text-xs uppercase opacity-80">Minutes</div>
                  </div>
                  <div>
                      <div className="text-4xl font-bold">{String(timeLeft.seconds).padStart(2, '0')}</div>
                      <div className="text-xs uppercase opacity-80">Seconds</div>
                  </div>
              </div>
              ) : (
                  <div className="text-center text-primary-foreground text-2xl font-bold">Qualifying has started!</div>
              )}
          </CardContent>
      </Card>

      {/* Pit Lane Status Card - Smart status based on user prediction */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Pit Lane Status</CardTitle>
          {isPitlaneOpen ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          {isPitlaneOpen ? (
            <Alert className="border-green-500/50 text-green-500 [&>svg]:text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle className="font-bold">Open</AlertTitle>
              <AlertDescription>
                {getActionText()}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="font-bold">Closed</AlertTitle>
              <AlertDescription>
                Qualifying has started. Predictions are locked.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </>
  );
}
