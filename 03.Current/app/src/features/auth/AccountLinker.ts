// GUID: FEATURE_ACCOUNT_LINKER-000-v03
// [Intent] Facade module for upgrading a PIN-only account to an OAuth-linked account.
//          Wraps the authService linking functions into a single `upgradeToOAuth` call
//          that resolves the correct provider and delegates to the appropriate linker.
// [Inbound Trigger] Called by SecurityUpgradeCard when the user clicks a provider link button.
// [Downstream Impact] Delegates to authService.linkGoogleToAccount or linkAppleToAccount,
//                     which add the provider to Firebase Auth providerData. The onAuthStateChanged
//                     listener in FirebaseProvider then syncs providers[] to Firestore.

'use client';

import { Auth } from 'firebase/auth';
import {
  linkGoogleToAccount,
  linkAppleToAccount,
  type OAuthLinkResult,
} from '@/services/authService';

// GUID: FEATURE_ACCOUNT_LINKER-001-v03
// [Intent] Upgrade the current user's account by linking an OAuth provider.
//          Accepts a providerId string ('google.com' or 'apple.com') and the Auth instance,
//          then delegates to the correct authService linking function.
// [Inbound Trigger] Called by SecurityUpgradeCard.handleUpgrade with a provider string.
// [Downstream Impact] On success, the provider is added to Firebase Auth providerData.
//                     Throws on failure so the caller can display the error message.
export async function upgradeToOAuth(
  auth: Auth,
  providerId: 'google.com' | 'apple.com'
): Promise<OAuthLinkResult> {
  let result: OAuthLinkResult;

  switch (providerId) {
    case 'google.com':
      result = await linkGoogleToAccount(auth);
      break;
    case 'apple.com':
      result = await linkAppleToAccount(auth);
      break;
    default:
      throw new Error(`Unsupported provider: ${providerId}`);
  }

  if (!result.success) {
    throw new Error(result.message);
  }

  return result;
}
