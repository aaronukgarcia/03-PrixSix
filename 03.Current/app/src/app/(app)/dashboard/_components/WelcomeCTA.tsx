// GUID: COMPONENT_WELCOME_CTA-000-v05
// [Intent] THE single dismissible welcome card for the dashboard (NEWBIE-08 consolidation).
//          Combines the former two stacked cards: the how-to-play steps (previously a separate
//          card inside DashboardClient, VIRGIN-005) and the Getting Started checklist CTA.
//          Persists dismiss state in localStorage.
// [Inbound Trigger] Rendered on the dashboard page between pre-season alert and race cards.
// [Downstream Impact] Routes user to /onboarding on click. Dismiss writes to localStorage.
// @FIX(v03) Smart completion check — only shows if onboarding incomplete AND not dismissed.
// @FIX(v04) GEMINI-AUDIT-040 resolved: Client-side dismissal confirmed as ACCEPTED RISK.
//   This CTA is cosmetic/informational only — it links to /onboarding but does NOT gate any
//   security step. All actual security actions (email verification, account setup) are enforced
//   server-side independently of this component. Re-displaying this CTA after localStorage
//   clear is benign — the user simply dismisses it again. See GUID COMPONENT_WELCOME_CTA-001
//   for the full security warning documenting when client-only dismissal is NOT acceptable.
// @UX(NEWBIE-08, v05) Consolidation + suppression:
//   1. Absorbed DashboardClient's how-to-play welcome card — new users previously saw TWO
//      stacked welcome cards (three for late joiners counting /welcome). One card now carries
//      the 3-step how-to-play AND the onboarding CTA.
//   2. Honours the legacy WELCOME_SEEN_KEY ("prix6_welcome_seen") so users who dismissed the
//      old DashboardClient card don't get re-welcomed; dismissing this card sets BOTH keys.
//   3. Suppressed on the dashboard visit immediately following the /welcome late-joiner
//      acknowledgement (sessionStorage WELCOME_ACK_FLAG written by app/(app)/welcome/page.tsx).
//      The flag is cleared on read, so the card returns on later visits.

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// GUID: COMPONENT_WELCOME_CTA-001-v03
// @SECURITY_WARNING (GEMINI-AUDIT-040): Client-side-only dismissal pattern.
//   This pattern is ACCEPTABLE for non-critical UI preferences like this welcome CTA.
//   HOWEVER, this pattern should NOT be used for security-critical dismissals such as:
//   - Security warnings or vulnerability notifications
//   - Terms of Service / Privacy Policy acceptance
//   - Mandatory compliance notices
//   - Data breach notifications
//   - Account suspension warnings
//   For critical alerts, ALWAYS use server-side user preferences (Firestore users collection)
//   to ensure dismissal persists across devices and cannot be bypassed by clearing localStorage.
// [Intent] Storage keys for persisting dismissed state and onboarding progress.
//          Client-side-only storage is appropriate here because:
//          1. This is a non-critical UI enhancement (welcome message)
//          2. Re-showing on new devices is acceptable (helps onboarding)
//          3. No security implications if user clears localStorage
// [Inbound Trigger] Read on mount, written on dismiss or onboarding completion.
// [Downstream Impact] When any dismiss key is 'true' OR onboarding complete, the CTA will not render.
// @UX(NEWBIE-08, v03): LEGACY_WELCOME_SEEN_KEY was the dismiss key of the now-removed
//   DashboardClient how-to-play card (COMPONENT_DASHBOARD_CLIENT-008); honoured here so prior
//   dismissals survive the consolidation. WELCOME_ACK_FLAG must match PAGE_WELCOME's writer.
const DISMISS_KEY = "prix-six-onboarding-dismissed";
const ONBOARDING_PROGRESS_KEY = "prix-six-onboarding-progress";
const LEGACY_WELCOME_SEEN_KEY = "prix6_welcome_seen";
const WELCOME_ACK_FLAG = "prix6-welcome-just-acknowledged";

// GUID: COMPONENT_WELCOME_CTA-002-v02
// [Intent] Main WelcomeCTA component. Shows a gradient-bordered card with the 3-step
//          how-to-play guide and a link to /onboarding. Fades in on mount, animates out on dismiss.
// [Inbound Trigger] Mounted by dashboard page.
// [Downstream Impact] Navigates to /onboarding on click, persists dismiss to localStorage.
// @UX(NEWBIE-08, v02): now carries the how-to-play steps formerly duplicated in DashboardClient.
export function WelcomeCTA() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true); // default hidden to prevent flash
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    // Check if user manually dismissed (either this card or the legacy how-to-play card)
    const isDismissed =
      localStorage.getItem(DISMISS_KEY) === "true" ||
      localStorage.getItem(LEGACY_WELCOME_SEEN_KEY) === "true";

    // @UX(NEWBIE-08): suppress on the visit immediately after the /welcome acknowledgement —
    // a late joiner has just read a full welcome screen; don't stack another one.
    let justAcknowledged = false;
    try {
      justAcknowledged = sessionStorage.getItem(WELCOME_ACK_FLAG) === "true";
      if (justAcknowledged) sessionStorage.removeItem(WELCOME_ACK_FLAG);
    } catch {
      // Storage unavailable — treat as not-just-acknowledged (card may show; cosmetic only)
    }

    // Check if onboarding is complete
    const progressData = localStorage.getItem(ONBOARDING_PROGRESS_KEY);
    let isOnboardingComplete = false;

    if (progressData) {
      try {
        const progress = JSON.parse(progressData);
        isOnboardingComplete = Boolean(
          progress.emailVerified &&
          progress.gameLearned &&
          progress.predictionMade &&
          progress.paddockExplored &&
          progress.gridJoined
        );
      } catch (e) {
        // Invalid JSON, treat as incomplete
        isOnboardingComplete = false;
      }
    }

    // Only show if NOT dismissed AND onboarding NOT complete AND NOT fresh from /welcome
    if (!isDismissed && !isOnboardingComplete && !justAcknowledged) {
      setDismissed(false);
    }
    setHasChecked(true);
  }, []);

  // GUID: COMPONENT_WELCOME_CTA-003-v02
  // [Intent] Dismiss handler — persists to localStorage and triggers exit animation.
  // [Inbound Trigger] User clicks the X button or "Got it".
  // [Downstream Impact] Sets BOTH dismiss keys (this card + the legacy how-to-play key, NEWBIE-08
  //   consolidation) and triggers the AnimatePresence exit.
  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.setItem(DISMISS_KEY, "true");
    localStorage.setItem(LEGACY_WELCOME_SEEN_KEY, "true");
    setDismissed(true);
  };

  if (!hasChecked) return null;

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          onClick={() => router.push("/onboarding")}
          className="group relative cursor-pointer rounded-lg p-[2px] overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent, var(--primary))), hsl(var(--primary)))",
          }}
        >
          {/* Shimmer overlay on hover */}
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 60%, transparent 100%)",
              backgroundSize: "200% 100%",
            }}
            animate={{ backgroundPosition: ["200% 0%", "-200% 0%"] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Inner card */}
          <div className="relative rounded-[6px] bg-card px-4 py-4 sm:px-6">
            <div className="flex items-start gap-3 sm:gap-4">
              <Sparkles className="h-5 w-5 shrink-0 text-primary mt-0.5" />

              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-mono font-semibold uppercase tracking-widest text-foreground">
                  Welcome to Prix Six &mdash; here&apos;s how to play
                </p>

                {/* @UX(NEWBIE-08): how-to-play steps absorbed from the old DashboardClient card */}
                <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground list-none">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">1</span>
                    <span>Before each race, predict which 6 drivers will qualify P1&ndash;P6.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">2</span>
                    <span>Earn points when your predictions match the real qualifying results.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">3</span>
                    <span>Compete with friends in private leagues and climb the standings.</span>
                  </li>
                </ol>

                <p className="mt-2 text-xs font-medium text-foreground flex items-center gap-1">
                  Complete the Getting Started checklist
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </p>
              </div>
            </div>

            {/* Dismiss button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="absolute top-1 right-1 h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss welcome message"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
