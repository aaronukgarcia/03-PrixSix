// GUID: COMPONENT_EMAIL_BANNER-000-v04
// [Intent] Dismissable banner component that prompts unverified users to verify their email address.
// Displays send-verification and refresh-status actions with inline feedback messages.
// Auto-checks verification status when the page regains visibility (user returns from email).
// [Inbound Trigger] Rendered on authenticated pages when the current user's email is not verified.
// [Downstream Impact] Calls sendVerificationEmail() and refreshEmailVerificationStatus() from the
// Firebase provider (FIREBASE_PROVIDER-017, FIREBASE_PROVIDER-018). Hides itself once verified or dismissed.

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Mail, X, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// GUID: COMPONENT_EMAIL_BANNER-001-v04
// [Intent] Main exported component that renders the email verification banner with send/refresh
// actions. Manages local UI state for dismissal, sending progress, and feedback messages.
// Auto-checks verification when page becomes visible (e.g., user returns from email link).
// [Inbound Trigger] Rendered by parent layout/page components for authenticated users.
// [Downstream Impact] Interacts with Firebase provider auth methods. When dismissed, stays hidden
// for the current session only (state resets on page reload).
export function EmailVerificationBanner() {
  const { user, isEmailVerified, sendVerificationEmail, refreshEmailVerificationStatus } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // GUID: COMPONENT_EMAIL_BANNER-004-v04
  // [Intent] Auto-check verification status when the page becomes visible (user returns from
  // clicking the email verification link in another tab/window). Uses the Page Visibility API.
  // [Inbound Trigger] Browser fires visibilitychange event when user switches back to this tab.
  // [Downstream Impact] Calls refreshEmailVerificationStatus which may update local state and
  // cause this banner to unmount if email is now verified.
  const handleVisibilityChange = useCallback(async () => {
    if (document.visibilityState === 'visible' && !isEmailVerified && user) {
      await refreshEmailVerificationStatus();
    }
  }, [isEmailVerified, user, refreshEmailVerificationStatus]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleVisibilityChange]);

  // Don't show if already verified, dismissed, or no user
  if (isEmailVerified || isDismissed || !user) {
    return null;
  }

  // GUID: COMPONENT_EMAIL_BANNER-002-v04
  // [Intent] Triggers the verification email send flow with loading state and result feedback.
  // [Inbound Trigger] User clicks "Send verification email" button.
  // [Downstream Impact] Calls FIREBASE_PROVIDER-017 (sendVerificationEmail). Displays success
  // or error message inline below the action buttons.
  const handleSendVerification = async () => {
    setIsSending(true);
    setMessage(null);
    const result = await sendVerificationEmail();
    setIsSending(false);
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.message
    });
  };

  // GUID: COMPONENT_EMAIL_BANNER-003-v04
  // [Intent] Refreshes the email verification status by checking both Firebase Auth and Firestore.
  // Shows feedback if still not verified so the user knows the check ran.
  // [Inbound Trigger] User clicks "I've verified" button after clicking the verification link.
  // [Downstream Impact] Calls FIREBASE_PROVIDER-018 (refreshEmailVerificationStatus). If email
  // is now verified, updates Firestore and local state, causing this banner to unmount.
  // If not yet verified, shows a helpful message.
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setMessage(null);
    const verified = await refreshEmailVerificationStatus();
    setIsRefreshing(false);
    if (!verified) {
      setMessage({
        type: 'error',
        text: 'Email not yet verified. Please click the link in the verification email first, then try again.'
      });
    }
  };

  return (
    <Alert className={cn(
      "relative mb-4 border-yellow-500/50 bg-yellow-500/10",
      "[&>svg]:text-yellow-600"
    )}>
      <Mail className="h-4 w-4" />
      <AlertTitle className="text-yellow-700 dark:text-yellow-500 font-semibold">
        Verify your email address
      </AlertTitle>
      <AlertDescription className="text-yellow-700/90 dark:text-yellow-500/90">
        <p className="mb-2">
          Please verify your email ({user.email}) to ensure you receive important updates about races and results.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendVerification}
            disabled={isSending}
            className="border-yellow-500/50 hover:bg-yellow-500/20"
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-3 w-3" />
                Send verification email
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-yellow-700 dark:text-yellow-500 hover:bg-yellow-500/20"
          >
            {isRefreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <RefreshCw className="mr-2 h-3 w-3" />
                I've verified
              </>
            )}
          </Button>
        </div>
        {message && (
          <p className={cn(
            "mt-2 text-sm flex items-center gap-1",
            message.type === 'success' ? "text-green-600" : "text-red-600"
          )}>
            {message.type === 'success' && <CheckCircle2 className="h-3 w-3" />}
            {message.text}
          </p>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6 text-yellow-700/60 hover:text-yellow-700 hover:bg-yellow-500/20"
        onClick={() => setIsDismissed(true)}
      >
        <X className="h-3 w-3" />
        <span className="sr-only">Dismiss</span>
      </Button>
    </Alert>
  );
}
