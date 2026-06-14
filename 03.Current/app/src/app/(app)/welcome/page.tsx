// GUID: PAGE_WELCOME-000-v01
// [Intent] Mid-season welcome / acknowledgement screen shown to late joiners. Explains that they are
//   joining after the season started, names their first upcoming race, explains that their prior-race
//   submissions were cloned from the current last-place team and that a one-time -5 late-joining
//   penalty was applied, signposts the Rules page where scoring is detailed, and requires the user to
//   tick a "I have read and understood" checkbox before continuing. Confirming records an audited
//   acknowledgement (POST /api/auth/acknowledge-late-joiner) and lifts the /welcome redirect gate.
// [Inbound Trigger] FirebaseProvider redirects here on first load when user.lateJoiner && !lateJoinerAcknowledged.
// [Downstream Impact] On confirm, sets users/{uid}.lateJoinerAcknowledged=true and writes a
//   LATE_JOINER_ACKNOWLEDGED audit entry, then routes to the dashboard.

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Flag, Trophy, Loader2, BookOpen } from "lucide-react";
import { generateClientCorrelationId } from "@/lib/error-codes";

export default function WelcomePage() {
  const { user, firebaseUser, isUserLoading } = useAuth();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If a non-late-joiner (or an already-acknowledged user) lands here, send them on.
  useEffect(() => {
    if (isUserLoading) return;
    if (user && (!user.lateJoiner || user.lateJoinerAcknowledged)) {
      router.replace("/dashboard");
    }
  }, [user, isUserLoading, router]);

  const info = user?.lateJoinerInfo;
  const penalty = info?.penalty ?? -5;
  const clonedCount = info?.clonedCount ?? 0;
  const clonedFrom = info?.clonedFromTeamName ?? "the last-place team";
  const nextRace = info?.nextRaceName ?? "the next race";

  const handleConfirm = async () => {
    if (!agreed || !firebaseUser) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/auth/acknowledge-late-joiner", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const ref = json?.correlationId ?? generateClientCorrelationId();
        setError(`Could not save your acknowledgement. Please try again. (Ref: ${ref})`);
        setSubmitting(false);
        return;
      }
      router.replace("/dashboard");
    } catch {
      setError(`Could not save your acknowledgement. Please check your connection and try again. (Ref: ${generateClientCorrelationId()})`);
      setSubmitting(false);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Flag className="h-7 w-7 text-primary" />
            <CardTitle className="text-2xl">Welcome to Prix Six, {user.teamName}!</CardTitle>
          </div>
          <CardDescription>You're joining mid-season — here's how your team has been set up.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm">
            The season is already under way, so to keep things fair we've set your team up like this:
          </p>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <Trophy className="h-5 w-5 text-primary flex-shrink-0" />
              <span>
                Your first race will be the <strong>{nextRace}</strong> — that's the first one you'll
                predict yourself.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Trophy className="h-5 w-5 text-primary flex-shrink-0" />
              <span>
                For every race already completed, your scores have been <strong>cloned from the team
                currently in last place</strong> ({clonedFrom}{clonedCount ? `, ${clonedCount} prior races` : ""}).
                So you start level with the back of the grid rather than on zero.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600/10 text-red-600 text-xs font-bold flex-shrink-0">−5</span>
              <span>
                A one-time <strong className="text-red-600">{penalty} point late-joining penalty</strong> has
                been applied, so you begin <strong>5 points behind last place</strong> as you head into your
                first race. Good luck — it's yours to climb from here!
              </span>
            </li>
          </ul>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm flex items-start gap-3">
            <BookOpen className="h-5 w-5 text-primary flex-shrink-0" />
            <span>
              Full details of how points are scored — including the late-joining penalty — are on the{" "}
              <Link href="/rules" className="font-semibold text-primary underline">Rules page</Link>.
              Please give it a read.
            </span>
          </div>

          <div className="flex items-start gap-3 pt-2">
            <Checkbox
              id="ack"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <label htmlFor="ack" className="text-sm font-medium leading-snug cursor-pointer">
              I have read and understood how my team was set up and how scoring works (including the
              one-time −5 late-joining penalty).
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleConfirm} disabled={!agreed || submitting} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Let's go racing"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
