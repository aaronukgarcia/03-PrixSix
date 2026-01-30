// GUID: COMPONENT_DASHBOARD_CLIENT-000-v03
// [Intent] Client-side dashboard component providing real-time countdown to qualifying,
//          deadline urgency warnings, and smart pit lane status (open/closed with prediction check).
// [Inbound Trigger] Rendered by PAGE_DASHBOARD-003 with nextRace prop.
// [Downstream Impact] Reads user prediction from Firestore to show "Submit" vs "Edit" link.
//                     Countdown timer updates every second. Deadline warnings at 24h/6h/1h.

"use client";

import { useAuth, useFirestore, useDoc } from "@/firebase";
import type { Race } from "@/lib/data";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Clock, CheckCircle2, AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import { doc } from "firebase/firestore";
import Link from "next/link";

// GUID: COMPONENT_DASHBOARD_CLIENT-001-v03
// [Intent] Determines deadline urgency level based on time remaining until qualifying.
//          Returns null if > 24h, 'notice' < 24h, 'warning' < 6h, 'critical' < 1h.
// [Inbound Trigger] Called during render with current timeLeft state.
// [Downstream Impact] Drives the colour-coded deadline warning banner inside the countdown card.
const getDeadlineWarning = (timeLeft: TimeLeft | null): { message: string; severity: 'critical' | 'warning' | 'notice' } | null => {
  if (!timeLeft) return null;

  const totalHours = timeLeft.days * 24 + timeLeft.hours;
  const totalMinutes = totalHours * 60 + timeLeft.minutes;

  if (totalMinutes < 60) {
    return { message: "Less than 1 hour remaining!", severity: 'critical' };
  }
  if (totalHours < 6) {
    return { message: "Less than 6 hours remaining!", severity: 'warning' };
  }
  if (totalHours < 24) {
    return { message: "Less than 24 hours remaining!", severity: 'notice' };
  }
  return null;
};

// GUID: COMPONENT_DASHBOARD_CLIENT-002-v03
// [Intent] TypeScript interface for the countdown time breakdown (days/hours/minutes/seconds).
// [Inbound Trigger] Used by calculateTimeLeft return type and component state.
// [Downstream Impact] Consumed by countdown display and getDeadlineWarning.
interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

// GUID: COMPONENT_DASHBOARD_CLIENT-003-v03
// [Intent] Pure function to compute remaining time from now until targetDate.
//          Returns null if the target date is in the past (qualifying has started).
// [Inbound Trigger] Called every second by the useEffect timer and on initial state.
// [Downstream Impact] Returns TimeLeft used by countdown display and deadline warning logic.
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

// GUID: COMPONENT_DASHBOARD_CLIENT-004-v03
// [Intent] Main client dashboard component — renders countdown timer, deadline warnings,
//          and pit lane status card with smart "Submit/Edit Prediction" link.
// [Inbound Trigger] Rendered by DashboardPage with nextRace prop containing schedule data.
// [Downstream Impact] Subscribes to user's prediction doc in Firestore via useDoc.
//                     Links to /predictions page. Shows open/closed pit lane status.
export function DashboardClient({ nextRace }: { nextRace: Race }) {
  const { user } = useAuth();
  const firestore = useFirestore();
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(() => calculateTimeLeft(nextRace.qualifyingTime));

  const raceId = nextRace.name.replace(/\s+/g, '-');
  const isPitlaneOpen = new Date(nextRace.qualifyingTime) > new Date();

  // GUID: COMPONENT_DASHBOARD_CLIENT-005-v03
  // [Intent] Memoised prediction document ID constructed from user ID and race ID.
  // [Inbound Trigger] user or raceId changes.
  // [Downstream Impact] Used to construct the Firestore document reference for prediction lookup.
  const predictionDocId = useMemo(() => {
    if (!user) return null;
    return `${user.id}_${raceId}`;
  }, [user, raceId]);

  // GUID: COMPONENT_DASHBOARD_CLIENT-006-v03
  // [Intent] Memoised Firestore document reference for the user's prediction for this race.
  // [Inbound Trigger] firestore, user, or predictionDocId changes.
  // [Downstream Impact] Passed to useDoc hook to subscribe to real-time prediction data.
  const predictionRef = useMemo(() => {
    if (!firestore || !user || !predictionDocId) return null;
    const ref = doc(firestore, "users", user.id, "predictions", predictionDocId);
    (ref as any).__memo = true;
    return ref;
  }, [firestore, user, predictionDocId]);

  const { data: predictionData, isLoading: isPredictionLoading } = useDoc(predictionRef);

  const hasPrediction = predictionData?.predictions && Array.isArray(predictionData.predictions) && predictionData.predictions.length > 0;

  // GUID: COMPONENT_DASHBOARD_CLIENT-007-v03
  // [Intent] Recurring 1-second timer that recalculates the countdown to qualifying.
  //          Runs indefinitely (no dependency array) to ensure real-time updates.
  // [Inbound Trigger] Every render triggers a new 1-second timeout.
  // [Downstream Impact] Updates timeLeft state, which re-renders countdown display and deadline warnings.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimeLeft(calculateTimeLeft(nextRace.qualifyingTime));
    }, 1000);

    return () => clearTimeout(timer);
  });

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
              {/* Deadline warning */}
              {timeLeft && (() => {
                const warning = getDeadlineWarning(timeLeft);
                if (!warning) return null;

                const severityClasses = {
                  critical: 'bg-red-500/20 text-red-100 border-red-400',
                  warning: 'bg-yellow-500/20 text-yellow-100 border-yellow-400',
                  notice: 'bg-blue-500/20 text-blue-100 border-blue-400',
                };

                return (
                  <div className={`mt-3 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${severityClasses[warning.severity]}`}>
                    <AlertTriangle className="h-4 w-4" />
                    {warning.message}
                  </div>
                );
              })()}
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
              {isPredictionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <AlertTitle className="font-bold">Open</AlertTitle>
              <AlertDescription>
                {isPredictionLoading ? (
                  "Checking your predictions..."
                ) : (
                  <Link
                    href="/predictions"
                    className="underline hover:text-green-400 transition-colors"
                  >
                    {hasPrediction ? "Edit Prediction" : "Submit Prediction"} →
                  </Link>
                )}
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
