// GUID: PAGE_ONBOARDING-000
// [Intent] Onboarding checklist page. Guides new users through four steps to get started:
//          verify email, make a prediction, explore the paddock, and join a league.
//          Steps 1-2 auto-detect from auth/Firestore state; steps 3-4 are manual.
// [Inbound Trigger] User navigates to /onboarding (typically via WelcomeCTA on dashboard).
// [Downstream Impact] Reads auth state and predictions subcollection. Writes progress to localStorage.

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MailCheck,
  Target,
  Compass,
  Users,
  Check,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import { collection, query, limit } from "firebase/firestore";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth, useCollection, useFirestore } from "@/firebase";
import { ERRORS } from "@/lib/error-registry";
import { createTracedError, logTracedError } from "@/lib/traced-error";

// GUID: PAGE_ONBOARDING-001
// [Intent] localStorage key for persisting manual checklist progress.
// [Inbound Trigger] Read on mount, written when manual steps are completed.
// [Downstream Impact] Stores JSON object with boolean flags for each checklist item.
const PROGRESS_KEY = "prix-six-onboarding-progress";

// GUID: PAGE_ONBOARDING-002
// [Intent] Type definition for onboarding progress state.
interface OnboardingProgress {
  emailVerified: boolean;
  predictionMade: boolean;
  paddockExplored: boolean;
  gridJoined: boolean;
}

const DEFAULT_PROGRESS: OnboardingProgress = {
  emailVerified: false,
  predictionMade: false,
  paddockExplored: false,
  gridJoined: false,
};

// GUID: PAGE_ONBOARDING-003
// [Intent] Checklist item configuration. Defines label, description, icon, links, and
//          whether the step is auto-detected or requires manual completion.
// [Inbound Trigger] Rendered by the checklist map.
// [Downstream Impact] Determines UI rendering and completion logic for each step.
interface ChecklistItem {
  id: keyof OnboardingProgress;
  label: string;
  description: string;
  icon: React.ElementType;
  links: { href: string; label: string }[];
  autoDetect: boolean;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: "emailVerified",
    label: "Verify Email",
    description: "Confirm your email address to unlock full access to predictions and leagues.",
    icon: MailCheck,
    links: [{ href: "/profile", label: "Go to Profile" }],
    autoDetect: true,
  },
  {
    id: "predictionMade",
    label: "Make a Prediction",
    description: "Submit your first race prediction and start earning points on the grid.",
    icon: Target,
    links: [{ href: "/predictions", label: "Make Prediction" }],
    autoDetect: true,
  },
  {
    id: "paddockExplored",
    label: "Explore the Paddock",
    description: "Read the rules, check the standings, and learn how scoring works.",
    icon: Compass,
    links: [
      { href: "/about", label: "About" },
      { href: "/rules", label: "Rules" },
      { href: "/standings", label: "Standings" },
    ],
    autoDetect: false,
  },
  {
    id: "gridJoined",
    label: "Join the Grid",
    description: "Create or join a league to compete with friends and other racers.",
    icon: Users,
    links: [{ href: "/leagues", label: "Browse Leagues" }],
    autoDetect: false,
  },
];

// GUID: PAGE_ONBOARDING-004
// [Intent] Main onboarding page component. Renders hero, progress bar, and interactive checklist.
// [Inbound Trigger] Route navigation to /onboarding.
// [Downstream Impact] Reads auth state (isEmailVerified), queries predictions subcollection,
//                     persists manual completion to localStorage.
export default function OnboardingPage() {
  const router = useRouter();
  const { user, isEmailVerified } = useAuth();
  const firestore = useFirestore();

  const [progress, setProgress] = useState<OnboardingProgress>(DEFAULT_PROGRESS);
  const [hasLoaded, setHasLoaded] = useState(false);

  // GUID: PAGE_ONBOARDING-005
  // [Intent] Load persisted progress from localStorage on mount.
  // [Inbound Trigger] Component mount.
  // [Downstream Impact] Restores previously completed manual steps.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROGRESS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<OnboardingProgress>;
        setProgress((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore corrupt localStorage
    }
    setHasLoaded(true);
  }, []);

  // GUID: PAGE_ONBOARDING-006
  // [Intent] Auto-detect email verification from auth state and sync to progress.
  // [Inbound Trigger] Auth state change (isEmailVerified).
  // [Downstream Impact] Updates emailVerified flag in progress state and localStorage.
  useEffect(() => {
    if (!hasLoaded) return;
    if (isEmailVerified) {
      setProgress((prev) => {
        if (prev.emailVerified) return prev;
        const next = { ...prev, emailVerified: true };
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, [isEmailVerified, hasLoaded]);

  // GUID: PAGE_ONBOARDING-007
  // [Intent] Query predictions subcollection to auto-detect if user has made any prediction.
  // [Inbound Trigger] Firestore and user availability.
  // [Downstream Impact] If predictions exist, marks predictionMade as true in progress.
  const predictionsQuery = useMemo(() => {
    if (!firestore || !user) return null;
    const q = query(
      collection(firestore, "users", user.id, "predictions"),
      limit(1)
    );
    (q as any).__memo = true;
    return q;
  }, [firestore, user]);

  const { data: predictions, error: predictionsError } = useCollection(predictionsQuery);

  useEffect(() => {
    if (predictionsError) {
      const traced = createTracedError(ERRORS.FIRESTORE_READ_FAILED, {
        context: { route: "/onboarding", action: "predictions_auto_detect", userId: user?.id },
        cause: predictionsError instanceof Error ? predictionsError : undefined,
      });
      logTracedError(traced);
    }
  }, [predictionsError, user?.id]);

  useEffect(() => {
    if (!hasLoaded || !predictions) return;
    if (predictions.length > 0) {
      setProgress((prev) => {
        if (prev.predictionMade) return prev;
        const next = { ...prev, predictionMade: true };
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, [predictions, hasLoaded]);

  // GUID: PAGE_ONBOARDING-008
  // [Intent] Handler for manual step completion. Marks step as done, persists, then navigates.
  // [Inbound Trigger] User clicks an action link on a manual (non-auto-detect) step.
  // [Downstream Impact] Updates localStorage and routes to the target page.
  const completeAndNavigate = useCallback(
    (stepId: keyof OnboardingProgress, href: string) => {
      setProgress((prev) => {
        const next = { ...prev, [stepId]: true };
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        return next;
      });
      router.push(href);
    },
    [router]
  );

  const completedCount = Object.values(progress).filter(Boolean).length;
  const allDone = completedCount === CHECKLIST_ITEMS.length;
  const progressPercent = (completedCount / CHECKLIST_ITEMS.length) * 100;

  if (!hasLoaded) return null;

  return (
    <div className="grid gap-6">
      {/* Hero */}
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Welcome to the Grid
        </h1>
        <p className="text-muted-foreground">
          Complete these steps to get up to speed and ready to race.
        </p>
      </div>

      {/* GUID: PAGE_ONBOARDING-009 */}
      {/* [Intent] Progress bar showing overall checklist completion. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span
            className={`text-xs font-mono uppercase tracking-widest ${
              allDone ? "text-[#00FF88]" : "text-muted-foreground"
            }`}
          >
            {completedCount}/{CHECKLIST_ITEMS.length} Complete
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* GUID: PAGE_ONBOARDING-010 */}
      {/* [Intent] Checklist items — staggered entry, animated check on completion. */}
      <div className="grid gap-3">
        {CHECKLIST_ITEMS.map((item, index) => {
          const done = progress[item.id];
          const Icon = item.icon;

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.35,
                delay: index * 0.1,
                ease: "easeOut",
              }}
            >
              <Card
                className={`transition-colors ${
                  done
                    ? "border-[#00FF88]/50 bg-[#00FF88]/5"
                    : ""
                }`}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  {/* Circle indicator */}
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      done
                        ? "border-[#00FF88] bg-[#00FF88]/10"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    <AnimatePresence mode="wait">
                      {done ? (
                        <motion.div
                          key="check"
                          initial={{ scale: 0, rotate: -90 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 20,
                          }}
                        >
                          <Check className="h-4 w-4 text-[#00FF88]" />
                        </motion.div>
                      ) : (
                        <motion.span
                          key="number"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs font-mono text-muted-foreground"
                        >
                          {index + 1}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          done ? "text-[#00FF88]" : "text-muted-foreground"
                        }`}
                      />
                      <span
                        className={`text-xs sm:text-sm font-mono font-semibold uppercase tracking-widest ${
                          done ? "text-[#00FF88]" : "text-foreground"
                        }`}
                      >
                        {item.label}
                      </span>
                      {done && (
                        <Badge
                          variant="outline"
                          className="border-[#00FF88]/50 text-[#00FF88] text-[10px] px-1.5 py-0"
                        >
                          Done
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.description}
                    </p>

                    {/* Action links */}
                    {!done && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.links.map((link) => (
                          <Button
                            key={link.href}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              if (item.autoDetect) {
                                router.push(link.href);
                              } else {
                                completeAndNavigate(item.id, link.href);
                              }
                            }}
                          >
                            {link.label}
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Mini avatar group for "Join the Grid" */}
                    {item.id === "gridJoined" && !done && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <div className="flex -space-x-2">
                          {[
                            "bg-primary/60",
                            "bg-accent/60",
                            "bg-muted-foreground/40",
                          ].map((bg, i) => (
                            <div
                              key={i}
                              className={`h-5 w-5 rounded-full border-2 border-card ${bg}`}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          Others are already racing
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* GUID: PAGE_ONBOARDING-011 */}
      {/* [Intent] Footer with back-to-dashboard navigation. */}
      <div className="pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={() => router.push("/dashboard")}
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
