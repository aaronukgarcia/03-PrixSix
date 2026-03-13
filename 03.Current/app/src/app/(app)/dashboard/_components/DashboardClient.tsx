// GUID: COMPONENT_DASHBOARD_CLIENT-000-v04
// [Intent] Client-side dashboard component providing real-time countdown to qualifying,
//          deadline urgency warnings, smart pit lane status (open/closed with prediction check),
//          a dismissible how-to-play welcome card for new users, and a compact stats row.
// [Inbound Trigger] Rendered by PAGE_DASHBOARD-003 with nextRace prop.
// [Downstream Impact] Reads user prediction from Firestore to show "Submit" vs "Edit" link.
//                     Countdown timer updates every second. Deadline warnings at 24h/6h/1h.
//                     Welcome card persists dismissal via localStorage. Stats row shows prediction status.

"use client";

import { useAuth, useFirestore, useDoc } from "@/firebase";
import type { Race } from "@/lib/data";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, AlertCircle, Loader2, AlertTriangle, HelpCircle, X, Lock } from "lucide-react";
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

// GUID: COMPONENT_DASHBOARD_CLIENT-008-v01
// [Intent] localStorage key for persisting dismissal of the how-to-play welcome card (VIRGIN-005).
// [Inbound Trigger] Read on mount by DashboardClient; written when user clicks "Got it".
// [Downstream Impact] When set to "true", the welcome card is permanently hidden for that browser.
// @SECURITY_WARNING: Client-only dismissal — acceptable for non-critical informational UI.
//   See COMPONENT_WELCOME_CTA-001 for full warning on when this pattern is NOT acceptable.
const WELCOME_SEEN_KEY = "prix6_welcome_seen";

// GUID: COMPONENT_DASHBOARD_CLIENT-004-v07
// [Intent] Main client dashboard component — renders how-to-play welcome card (dismissible),
//          compact stats row, countdown timer, deadline warnings, and pit lane status card.
//          isPitlaneOpen is server-computed (admin override + clock logic) and passed as prop.
//          nextMilestone drives the countdown — it is the next upcoming session within the active
//          race weekend (qualifying → sprint → GP race) so the timer shows the actual next event,
//          not the next race's qualifying when we're mid-weekend.
//          pitLaneClosedAt is the ISO timestamp when the pit lane was actually closed (may differ
//          from scheduled qualifyingTime if admin extended the window due to weather).
//          lockedSessions is a string listing which race sessions are now locked in.
// [Inbound Trigger] Rendered by DashboardPage with nextRace + nextMilestone + isPitlaneOpen props.
// [Downstream Impact] Links to /predictions page. Shows correct open/closed pit lane status.
interface NextMilestone { targetTime: string; label: string; sessionType: string; }

export function DashboardClient({
  nextRace,
  nextMilestone,
  isPitlaneOpen,
  pitLaneClosedAt,
  lockedSessions,
}: {
  nextRace: Race;
  nextMilestone: NextMilestone;
  isPitlaneOpen: boolean;
  pitLaneClosedAt: string | null;
  lockedSessions: string;
}) {
  const { user } = useAuth();
  const firestore = useFirestore();
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(() => calculateTimeLeft(nextMilestone.targetTime));
  const [didExpire, setDidExpire] = useState(false);

  const raceId = nextRace.name.replace(/\s+/g, '-');

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

  // GUID: COMPONENT_DASHBOARD_CLIENT-007-v04
  // [Intent] Recurring 1-second timer that recalculates the countdown to qualifying.
  //          When the countdown reaches zero (qualifying starts), schedules a page reload
  //          after 5 seconds so the server re-renders with the next race's data.
  // [Inbound Trigger] Every render triggers a new 1-second timeout.
  // [Downstream Impact] Updates timeLeft state. When timeLeft transitions to null (countdown
  //   expired), triggers window.location.reload() after 5s so dashboard advances to next race.
  useEffect(() => {
    const timer = setTimeout(() => {
      const newTimeLeft = calculateTimeLeft(nextMilestone.targetTime);
      setTimeLeft(newTimeLeft);
      // Auto-reload once when milestone expires so server re-computes the next session
      if (!newTimeLeft && !didExpire) {
        setDidExpire(true);
        setTimeout(() => window.location.reload(), 5000);
      }
    }, 1000);

    return () => clearTimeout(timer);
  });

  // GUID: COMPONENT_DASHBOARD_CLIENT-009-v01
  // [Intent] Controls visibility of the how-to-play welcome card (VIRGIN-005).
  //          Initialised from localStorage on mount to prevent flash of content for returning users.
  //          Defaults to false (hidden) before hydration to avoid SSR mismatch.
  // [Inbound Trigger] Component mounts; user clicks "Got it" dismiss button.
  // [Downstream Impact] When false, the welcome card renders. When true, it is removed from the DOM.
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeChecked, setWelcomeChecked] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(WELCOME_SEEN_KEY);
    if (seen !== "true") {
      setShowWelcome(true);
    }
    setWelcomeChecked(true);
  }, []);

  const handleDismissWelcome = () => {
    localStorage.setItem(WELCOME_SEEN_KEY, "true");
    setShowWelcome(false);
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

      {/* GUID: COMPONENT_DASHBOARD_CLIENT-008 — How-to-play welcome card (VIRGIN-005) */}
      {welcomeChecked && showWelcome && (
        <Card className="relative border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 shrink-0 text-primary mt-0.5" />
              <CardTitle className="text-base font-semibold leading-tight">
                Welcome to Prix Six
              </CardTitle>
            </div>
            <button
              onClick={handleDismissWelcome}
              aria-label="Dismiss welcome message"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3 text-sm">
              Here is how to play:
            </CardDescription>
            <ol className="space-y-2 text-sm text-muted-foreground list-none">
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">1</span>
                <span>Before each race, predict which 6 drivers will qualify P1&ndash;P6.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">2</span>
                <span>Earn points when your predictions match the real qualifying results.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">3</span>
                <span>Compete with friends in private leagues and climb the standings.</span>
              </li>
            </ol>
            <div className="mt-4">
              <button
                onClick={handleDismissWelcome}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Got it
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* GUID: COMPONENT_DASHBOARD_CLIENT-009 — Compact stats row (VIRGIN-006) */}
      <div className="flex flex-wrap items-center gap-3">
        {isPredictionLoading ? (
          <Badge variant="outline" className="flex items-center gap-1.5 py-1 px-3 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Checking prediction...</span>
          </Badge>
        ) : hasPrediction ? (
          <Badge variant="outline" className="flex items-center gap-1.5 py-1 px-3 text-xs border-green-500/50 text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            <span>Prediction submitted</span>
          </Badge>
        ) : (
          <Badge variant="outline" className="flex items-center gap-1.5 py-1 px-3 text-xs border-muted-foreground/40 text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            <span>No prediction yet</span>
          </Badge>
        )}
      </div>

       <Card className="bg-gradient-to-r from-primary/80 to-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2 text-primary-foreground">
              <CardTitle className="text-sm font-medium">Next: {nextMilestone.label}</CardTitle>
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
                  <div className="text-center text-primary-foreground text-2xl font-bold">{nextMilestone.label} is underway!</div>
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

      {/* Pit Lane Status Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Pit Lane Status</CardTitle>
          {isPitlaneOpen ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Lock className="h-4 w-4 text-amber-500" />
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
            <div className="rounded-lg border-2 border-amber-500/70 bg-amber-500/10 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="shrink-0 rounded-full bg-amber-500 p-2">
                  <Lock className="h-4 w-4 text-black" />
                </div>
                <div>
                  <div className="font-bold text-amber-400 text-base leading-tight">
                    {nextRace.name} — Locked
                  </div>
                  {pitLaneClosedAt && (
                    <div className="text-xs text-amber-300/80 mt-0.5">
                      Closed at{' '}
                      <span className="font-semibold">
                        {new Date(pitLaneClosedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                      </span>
                      {' · '}
                      {new Date(pitLaneClosedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              </div>
              {lockedSessions && (
                <p className="text-sm text-amber-200/80 mb-2">
                  Now locked for: <span className="font-medium text-amber-300">{lockedSessions}</span>
                </p>
              )}
              <p className="text-sm font-bold text-amber-400">
                All predictions are locked in — good luck! 🏁
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
