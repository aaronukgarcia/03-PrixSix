// GUID: COMPONENT_WELCOME_CTA-000
// [Intent] Dismissible welcome CTA card for the dashboard. Encourages new users to visit
//          the onboarding checklist at /onboarding. Persists dismiss state in localStorage.
// [Inbound Trigger] Rendered on the dashboard page between pre-season alert and race cards.
// [Downstream Impact] Routes user to /onboarding on click. Dismiss writes to localStorage.

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// GUID: COMPONENT_WELCOME_CTA-001
// [Intent] localStorage key for persisting the dismissed state of the welcome CTA.
// [Inbound Trigger] Read on mount, written on dismiss.
// [Downstream Impact] When set to 'true', the CTA will not render.
const DISMISS_KEY = "prix-six-onboarding-dismissed";

// GUID: COMPONENT_WELCOME_CTA-002
// [Intent] Main WelcomeCTA component. Shows a gradient-bordered card with shimmer effect
//          that links to /onboarding. Fades in on mount and animates out on dismiss.
// [Inbound Trigger] Mounted by dashboard page.
// [Downstream Impact] Navigates to /onboarding on click, persists dismiss to localStorage.
export function WelcomeCTA() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true); // default hidden to prevent flash
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    const val = localStorage.getItem(DISMISS_KEY);
    if (val !== "true") {
      setDismissed(false);
    }
    setHasChecked(true);
  }, []);

  // GUID: COMPONENT_WELCOME_CTA-003
  // [Intent] Dismiss handler — persists to localStorage and triggers exit animation.
  // [Inbound Trigger] User clicks the X button.
  // [Downstream Impact] Sets localStorage key, triggers AnimatePresence exit.
  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.setItem(DISMISS_KEY, "true");
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
            <div className="flex items-center gap-3 sm:gap-4">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />

              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-mono font-semibold uppercase tracking-widest text-foreground">
                  Welcome &mdash; Are you new here?
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Complete the onboarding checklist to get started on the grid.
                </p>
              </div>

              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
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
