// GUID: COMPONENT_CONVERSION_BANNER-000-v04
// [Intent] Dismissable banner that prompts PIN-only users to link a Google or Apple account.
//          Similar pattern to EmailVerificationBanner but with blue/purple theme.
//          Shows only when the user's providerData contains only 'password'.
//          Dismiss state persists in localStorage so it doesn't reappear on every page.
// [Inbound Trigger] Rendered in the app layout after EmailVerificationBanner.
// [Downstream Impact] Calls linkGoogle() and linkApple() from the Firebase provider.
//                     Auto-hides on successful link. Dismissable persistently via localStorage.

"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Shield, X, Loader2, CheckCircle2 } from "lucide-react";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "prix-six-conversion-banner-dismissed";

// GUID: COMPONENT_CONVERSION_BANNER-001-v04
// [Intent] Main exported component. Renders only for PIN-only users (no OAuth provider linked).
//          Provides Link Google and Link Apple buttons with loading and success states.
//          Dismiss state persists in localStorage across page loads and sessions.
// [Inbound Trigger] Parent layout renders this component for all authenticated users.
// [Downstream Impact] On successful link, the provider sync in onAuthStateChanged updates
//                     the user's providers list, causing this banner to auto-hide.
export function ConversionBanner() {
  const { user, firebaseUser, linkGoogle, linkApple } = useAuth();
  const [isDismissed, setIsDismissed] = useState(true); // default hidden to prevent flash
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    const val = localStorage.getItem(DISMISS_KEY);
    if (val !== "true") {
      setIsDismissed(false);
    }
    setHasChecked(true);
  }, []);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const [isLinkingApple, setIsLinkingApple] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [linkedSuccess, setLinkedSuccess] = useState(false);

  // Don't show if not yet checked localStorage, dismissed, linked successfully, no user, or user already has OAuth
  if (!hasChecked || isDismissed || linkedSuccess || !user || !firebaseUser) {
    return null;
  }

  const providers = user.providers || [];
  const hasOAuth = providers.includes('google.com') || providers.includes('apple.com');

  // Only show for PIN-only users
  if (hasOAuth || !providers.includes('password')) {
    return null;
  }

  // GUID: COMPONENT_CONVERSION_BANNER-002-v03
  // [Intent] Link Google account to the current user.
  // [Inbound Trigger] User clicks "Link Google" button.
  // [Downstream Impact] Calls linkGoogle from provider; on success shows confirmation.
  const handleLinkGoogle = async () => {
    setIsLinkingGoogle(true);
    setMessage(null);
    const result = await linkGoogle();
    setIsLinkingGoogle(false);
    if (result.success) {
      setLinkedSuccess(true);
    } else {
      setMessage({ type: 'error', text: result.message });
    }
  };

  // GUID: COMPONENT_CONVERSION_BANNER-003-v03
  // [Intent] Link Apple account to the current user.
  // [Inbound Trigger] User clicks "Link Apple" button.
  // [Downstream Impact] Calls linkApple from provider; on success hides banner immediately.
  const handleLinkApple = async () => {
    setIsLinkingApple(true);
    setMessage(null);
    const result = await linkApple();
    setIsLinkingApple(false);
    if (result.success) {
      setLinkedSuccess(true);
    } else {
      setMessage({ type: 'error', text: result.message });
    }
  };

  return (
    <Alert className={cn(
      "relative mb-4 border-blue-500/50 bg-blue-500/10",
      "[&>svg]:text-blue-600"
    )}>
      <Shield className="h-4 w-4" />
      <AlertTitle className="text-blue-700 dark:text-blue-400 font-semibold">
        Add a quick sign-in method
      </AlertTitle>
      <AlertDescription className="text-blue-700/90 dark:text-blue-400/90">
        <p className="mb-2">
          Link your Google or Apple account for faster, more secure sign-in without needing your PIN.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLinkGoogle}
            disabled={isLinkingGoogle || isLinkingApple}
            className="border-blue-500/50 hover:bg-blue-500/20"
          >
            {isLinkingGoogle ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <GoogleIcon className="mr-2" size={14} />
            )}
            Link Google
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLinkApple}
            disabled={isLinkingGoogle || isLinkingApple}
            className="border-blue-500/50 hover:bg-blue-500/20"
          >
            {isLinkingApple ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <AppleIcon className="mr-2" size={14} />
            )}
            Link Apple
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
        className="absolute top-2 right-2 h-6 w-6 text-blue-700/60 hover:text-blue-700 hover:bg-blue-500/20"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "true");
          setIsDismissed(true);
        }}
      >
        <X className="h-3 w-3" />
        <span className="sr-only">Dismiss</span>
      </Button>
    </Alert>
  );
}
