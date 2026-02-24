// GUID: COMPONENT_SECURITY_UPGRADE-000-v05
// @SECURITY_FIX: GEMINI-AUDIT-038 — Replaced raw err.message in handleUpgrade catch block with a safe
//   generic message using CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED (from error-registry-client).
//   Raw Firebase error messages (e.g. "auth/account-exists-with-different-credential") were previously
//   rendered directly in the UI, leaking internal Firebase error details to the user.
// @SECURITY_FIX (GEMINI-AUDIT-038 v05): Added 4-pillar error handling to handleUpgrade catch block:
//   (1) console.error gated on NODE_ENV with correlationId, (2) CLIENT_ERRORS key, (3) correlationId
//   generated via generateClientCorrelationId(), (4) selectable correlation ID element in error display.
//   Switched import from ERROR_CODES/@/lib/error-codes to CLIENT_ERRORS/@/lib/error-registry-client
//   (client-safe registry, no internal metadata bundled into client JS).
// [Intent] Card component that prompts PIN-only users to link a Google or Apple account
//          for improved security. Uses the AccountLinker facade to perform the upgrade.
//          Displays idle, loading, success, and error states.
// [Inbound Trigger] Rendered on the profile page or any settings page for PIN-only users.
// [Downstream Impact] Calls upgradeToOAuth from AccountLinker which links the chosen provider
//                     via Firebase Auth. On success, onAuthStateChanged syncs providers to Firestore.

"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Shield } from "lucide-react";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";
import { useAuth, useFirebase } from "@/firebase";
import { upgradeToOAuth } from "@/features/auth/AccountLinker";
import { generateClientCorrelationId } from "@/lib/error-codes";
import { CLIENT_ERRORS } from "@/lib/error-registry-client";

// GUID: COMPONENT_SECURITY_UPGRADE-001-v04
// @SECURITY_FIX (GEMINI-AUDIT-038 v04): Added correlationId state to hold the per-error
//   correlation ID generated in handleUpgrade. The error display now renders the generic
//   CLIENT_ERRORS message plus a selectable <code> element containing the correlation ID.
// [Intent] Main exported component. Shows upgrade prompt for PIN-only users, with Google
//          and Apple link buttons. Renders a success confirmation after linking.
// [Inbound Trigger] Parent component renders this for authenticated users.
// [Downstream Impact] On successful link, the success state is shown. The provider sync
//                     happens automatically via onAuthStateChanged in the background.
export function SecurityUpgradeCard() {
  const { user } = useAuth();
  const { authService } = useFirebase();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCorrelationId, setErrorCorrelationId] = useState('');
  const [linkedProvider, setLinkedProvider] = useState('');

  // Don't show if no user or user already has an OAuth provider
  if (!user || !authService) return null;

  const providers = user.providers || [];
  const hasGoogle = providers.includes('google.com');
  const hasApple = providers.includes('apple.com');

  // Hide entirely if both are already linked
  if (hasGoogle && hasApple) return null;

  // GUID: COMPONENT_SECURITY_UPGRADE-002-v05
  // @SECURITY_FIX: GEMINI-AUDIT-038 — Replaced raw err.message with safe CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED
  //   message (from client-safe error-registry-client, no internal metadata bundled). Raw Firebase error
  //   strings (e.g. "auth/account-exists-with-different-credential") were previously rendered verbatim in
  //   the UI, exposing internal auth provider details.
  // @SECURITY_FIX (GEMINI-AUDIT-038 v05): Full 4-pillar error handling:
  //   Pillar 1 — console.error gated on NODE_ENV (dev: full error; prod: error code + correlationId only)
  //   Pillar 2 — CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED (registry key, no raw message)
  //   Pillar 3 — correlationId generated via generateClientCorrelationId()
  //   Pillar 4 — selectable <code> element in UI so user can report the correlation ID
  // [Intent] Handle the upgrade action for a given provider.
  // [Inbound Trigger] User clicks "Link Google Account" or "Link Apple Account".
  // [Downstream Impact] Calls upgradeToOAuth; sets status to success or error. Error display uses safe
  //   registry message + selectable correlation ID — raw Firebase error details are not surfaced to user.
  const handleUpgrade = async (providerId: 'google.com' | 'apple.com') => {
    setStatus('loading');
    setErrorMsg('');
    setErrorCorrelationId('');
    try {
      await upgradeToOAuth(authService, providerId);
      setLinkedProvider(providerId === 'google.com' ? 'Google' : 'Apple');
      setStatus('success');
    } catch (err: any) {
      // SECURITY (GEMINI-AUDIT-038): Do not surface raw Firebase error messages to the user.
      // Gate diagnostic logging behind NODE_ENV to prevent production leakage.
      const correlationId = generateClientCorrelationId();
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[SecurityUpgradeCard ${correlationId}] handleUpgrade error [${CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED.code}]:`, err);
      } else {
        console.error(`[SecurityUpgradeCard ${correlationId}] handleUpgrade error [${CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED.code}]`);
      }
      setStatus('error');
      setErrorMsg(CLIENT_ERRORS.AUTH_OAUTH_LINK_FAILED.message);
      setErrorCorrelationId(correlationId);
    }
  };

  if (status === 'success') {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <h3 className="font-semibold">Account Secured</h3>
              <p className="text-sm opacity-90">
                Your {linkedProvider} account is now linked. You can use it for your next login.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Upgrade Account Security
        </CardTitle>
        <CardDescription>
          Link a Google or Apple account for faster, more secure sign-in without needing your PIN.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasGoogle && (
          <Button
            onClick={() => handleUpgrade('google.com')}
            disabled={status === 'loading'}
            variant="outline"
            className="w-full justify-center gap-2"
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon size={18} />
            )}
            Link Google Account
          </Button>
        )}

        {!hasApple && (
          <Button
            onClick={() => handleUpgrade('apple.com')}
            disabled={status === 'loading'}
            variant="outline"
            className="w-full justify-center gap-2"
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <AppleIcon size={18} />
            )}
            Link Apple Account
          </Button>
        )}

        {status === 'error' && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            <p className="font-medium">{errorMsg}</p>
            {errorCorrelationId && (
              <div className="mt-2 pt-2 border-t border-destructive/20">
                <p className="text-xs text-destructive/70 mb-1">Reference ID (tap to select):</p>
                <code className="text-xs select-all cursor-pointer bg-destructive/10 px-2 py-1 rounded block">
                  {errorCorrelationId}
                </code>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SecurityUpgradeCard;
