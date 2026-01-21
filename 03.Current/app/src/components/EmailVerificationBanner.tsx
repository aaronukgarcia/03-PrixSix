"use client";

import { useState } from "react";
import { useAuth } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Mail, X, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmailVerificationBanner() {
  const { user, isEmailVerified, sendVerificationEmail, refreshEmailVerificationStatus } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Don't show if already verified, dismissed, or no user
  if (isEmailVerified || isDismissed || !user) {
    return null;
  }

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setMessage(null);
    await refreshEmailVerificationStatus();
    setIsRefreshing(false);
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
