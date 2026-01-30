// GUID: COMPONENT_SECURITY_UPGRADE-000-v03
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

// GUID: COMPONENT_SECURITY_UPGRADE-001-v03
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
  const [linkedProvider, setLinkedProvider] = useState('');

  // Don't show if no user or user already has an OAuth provider
  if (!user || !authService) return null;

  const providers = user.providers || [];
  const hasGoogle = providers.includes('google.com');
  const hasApple = providers.includes('apple.com');

  // Hide entirely if both are already linked
  if (hasGoogle && hasApple) return null;

  // GUID: COMPONENT_SECURITY_UPGRADE-002-v03
  // [Intent] Handle the upgrade action for a given provider.
  // [Inbound Trigger] User clicks "Link Google Account" or "Link Apple Account".
  // [Downstream Impact] Calls upgradeToOAuth; sets status to success or error.
  const handleUpgrade = async (providerId: 'google.com' | 'apple.com') => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await upgradeToOAuth(authService, providerId);
      setLinkedProvider(providerId === 'google.com' ? 'Google' : 'Apple');
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Migration failed. Please try again.');
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
          <p className="text-sm text-destructive font-medium">{errorMsg}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default SecurityUpgradeCard;
