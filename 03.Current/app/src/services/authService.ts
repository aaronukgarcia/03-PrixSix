// GUID: SERVICE_AUTH_OAUTH-000-v04
// [Intent] Client-side OAuth authentication service for Google and Apple sign-in.
//          Provides popup-with-redirect-fallback sign-in, provider linking/unlinking,
//          Apple nonce generation, and mobile detection. All OAuth must happen client-side
//          because Firebase OAuth requires browser interaction.
// [Inbound Trigger] Called by FirebaseProvider (FIREBASE_PROVIDER) wrapper methods for
//                   sign-in, linking, and unlinking operations.
// [Downstream Impact] On success, triggers onAuthStateChanged in the provider which loads
//                     the user profile. New OAuth users (no Firestore doc) are routed to
//                     /complete-profile by the provider's auth state handler.

'use client';

import {
  Auth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  linkWithPopup,
  linkWithRedirect,
  unlink,
  OAuthCredential,
  UserCredential,
  User as FirebaseAuthUser,
} from 'firebase/auth';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';

// GUID: SERVICE_AUTH_OAUTH-001-v03
// [Intent] Type definitions for OAuth operation results, providing structured success/error
//          responses with optional pending credential for account-linking flows.
// [Inbound Trigger] Returned by all public functions in this module.
// [Downstream Impact] Consumed by FirebaseProvider wrapper methods and UI components for
//                     conditional rendering of success, error, and linking prompts.
export interface OAuthSignInResult {
  success: boolean;
  message: string;
  needsLinking?: boolean;
  pendingCredential?: OAuthCredential | null;
  isNewUser?: boolean;
  correlationId?: string;
}

export interface OAuthLinkResult {
  success: boolean;
  message: string;
  correlationId?: string;
}

// GUID: SERVICE_AUTH_OAUTH-002-v03
// [Intent] Detect mobile devices via userAgent and viewport width to determine whether
//          to use signInWithPopup (desktop) or signInWithRedirect (mobile).
//          Mobile Safari blocks popups, so redirect is mandatory on mobile.
// [Inbound Trigger] Called internally before every sign-in or link attempt.
// [Downstream Impact] Controls which Firebase auth method is used. Incorrect detection
//                     would cause popup-blocked errors on mobile.
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
  const isSmallViewport = window.innerWidth < 768;
  return isMobileUA || isSmallViewport;
}

// GUID: SERVICE_AUTH_OAUTH-004-v03
// [Intent] Extract the list of provider IDs from a Firebase Auth user's providerData array.
// [Inbound Trigger] Called by the provider sync logic in onAuthStateChanged and by UI
//                   components that display linked provider status.
// [Downstream Impact] Returns strings like ['password', 'google.com', 'apple.com'].
export function getProviderIds(user: FirebaseAuthUser): string[] {
  return user.providerData.map((p) => p.providerId);
}

// GUID: SERVICE_AUTH_OAUTH-005-v03
// [Intent] Sign in with Google using popup (desktop) or redirect (mobile).
//          Handles popup-blocked errors by falling back to redirect.
//          Detects account-exists-with-different-credential for linking flows.
// [Inbound Trigger] Called from FirebaseProvider.signInWithGoogle wrapper.
// [Downstream Impact] On success, triggers onAuthStateChanged. On needsLinking,
//                     returns pendingCredential for the UI to prompt PIN sign-in first.
export async function signInWithGoogle(auth: Auth): Promise<OAuthSignInResult> {
  const correlationId = generateClientCorrelationId();
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');

  try {
    if (isMobileDevice()) {
      await signInWithRedirect(auth, provider);
      // Redirect flow — result is handled by getRedirectResult in provider
      return { success: true, message: 'Redirecting to Google...', correlationId };
    }

    const result = await signInWithPopup(auth, provider);
    const isNew = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;
    return {
      success: true,
      message: 'Signed in with Google',
      isNewUser: isNew,
      correlationId,
    };
  } catch (error: any) {
    return handleOAuthError(error, auth, provider, correlationId);
  }
}

// GUID: SERVICE_AUTH_OAUTH-006-v03
// [Intent] Sign in with Apple using popup (desktop) or redirect (mobile).
//          Firebase handles nonce generation internally for popup/redirect flows.
// [Inbound Trigger] Called from FirebaseProvider.signInWithApple wrapper.
// [Downstream Impact] Same as signInWithGoogle — triggers onAuthStateChanged on success.
export async function signInWithApple(auth: Auth): Promise<OAuthSignInResult> {
  const correlationId = generateClientCorrelationId();

  try {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');

    if (isMobileDevice()) {
      await signInWithRedirect(auth, provider);
      return { success: true, message: 'Redirecting to Apple...', correlationId };
    }

    const result = await signInWithPopup(auth, provider);
    const isNew = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;
    return {
      success: true,
      message: 'Signed in with Apple',
      isNewUser: isNew,
      correlationId,
    };
  } catch (error: any) {
    const provider = new OAuthProvider('apple.com');
    return handleOAuthError(error, auth, provider, correlationId);
  }
}

// GUID: SERVICE_AUTH_OAUTH-007-v04
// [Intent] Link a Google account to the currently signed-in user.
//          Uses popup on desktop with redirect fallback.
// [Inbound Trigger] Called from ConversionBanner or profile page link buttons.
// [Downstream Impact] Adds 'google.com' to the user's providerData. The onAuthStateChanged
//                     handler will sync the new providers list to Firestore.
export async function linkGoogleToAccount(auth: Auth): Promise<OAuthLinkResult> {
  const correlationId = generateClientCorrelationId();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return {
      success: false,
      message: `You must be signed in to link an account. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');

  try {
    if (isMobileDevice()) {
      await linkWithRedirect(currentUser, provider);
      return { success: true, message: 'Redirecting to Google...', correlationId };
    }

    await linkWithPopup(currentUser, provider);
    return { success: true, message: 'Google account linked successfully', correlationId };
  } catch (error: any) {
    return handleLinkError(error, correlationId);
  }
}

// GUID: SERVICE_AUTH_OAUTH-008-v04
// [Intent] Link an Apple account to the currently signed-in user.
// [Inbound Trigger] Called from ConversionBanner or profile page link buttons.
// [Downstream Impact] Adds 'apple.com' to providerData; synced to Firestore by auth listener.
export async function linkAppleToAccount(auth: Auth): Promise<OAuthLinkResult> {
  const correlationId = generateClientCorrelationId();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return {
      success: false,
      message: `You must be signed in to link an account. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  try {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');

    if (isMobileDevice()) {
      await linkWithRedirect(currentUser, provider);
      return { success: true, message: 'Redirecting to Apple...', correlationId };
    }

    await linkWithPopup(currentUser, provider);
    return { success: true, message: 'Apple account linked successfully', correlationId };
  } catch (error: any) {
    return handleLinkError(error, correlationId);
  }
}

// GUID: SERVICE_AUTH_OAUTH-009-v04
// [Intent] Unlink a sign-in provider from the current user.
//          Caller must verify this isn't the last provider before calling.
// [Inbound Trigger] Called from profile page unlink buttons.
// [Downstream Impact] Removes the provider from providerData; synced to Firestore by auth listener.
export async function unlinkProvider(auth: Auth, providerId: string): Promise<OAuthLinkResult> {
  const correlationId = generateClientCorrelationId();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return {
      success: false,
      message: `You must be signed in to unlink a provider. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  try {
    await unlink(currentUser, providerId);
    return {
      success: true,
      message: `Provider unlinked successfully`,
      correlationId,
    };
  } catch (error: any) {
    console.error(`[Unlink Provider Error ${correlationId}]`, error);
    return {
      success: false,
      message: `Failed to unlink provider. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }
}

// GUID: SERVICE_AUTH_OAUTH-010-v04
// [Intent] Central error handler for OAuth sign-in errors. Maps Firebase error codes to
//          application error codes and handles popup-blocked fallback to redirect.
// [Inbound Trigger] Called from signInWithGoogle and signInWithApple catch blocks.
// [Downstream Impact] Returns typed OAuthSignInResult with appropriate error code and message.
function handleOAuthError(
  error: any,
  auth: Auth,
  provider: GoogleAuthProvider | OAuthProvider,
  correlationId: string
): OAuthSignInResult {
  console.error(`[OAuth Error ${correlationId}]`, error);

  if (error?.code === 'auth/popup-blocked') {
    // Fallback to redirect
    signInWithRedirect(auth, provider).catch(() => {});
    return {
      success: false,
      message: `${ERRORS.AUTH_OAUTH_POPUP_BLOCKED.message}. Redirecting instead...`,
      correlationId,
    };
  }

  if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
    return {
      success: false,
      message: ERRORS.AUTH_OAUTH_POPUP_CLOSED.message,
      correlationId,
    };
  }

  if (error?.code === 'auth/account-exists-with-different-credential') {
    const credential = OAuthProvider.credentialFromError(error);
    return {
      success: false,
      message: ERRORS.AUTH_OAUTH_ACCOUNT_EXISTS.message,
      needsLinking: true,
      pendingCredential: credential,
      correlationId,
    };
  }

  if (error?.code === 'auth/operation-not-allowed') {
    return {
      success: false,
      message: `This sign-in provider is not enabled. Enable it in Firebase Console > Authentication > Sign-in method. [${ERRORS.AUTH_OAUTH_PROVIDER_ERROR.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  const firebaseCode = error?.code || 'unknown';
  return {
    success: false,
    message: `${ERRORS.AUTH_OAUTH_PROVIDER_ERROR.message} (${firebaseCode}) [${ERRORS.AUTH_OAUTH_PROVIDER_ERROR.code}] (Ref: ${correlationId})`,
    correlationId,
  };
}

// GUID: SERVICE_AUTH_OAUTH-011-v04
// [Intent] Central error handler for provider linking errors.
// [Inbound Trigger] Called from linkGoogleToAccount and linkAppleToAccount catch blocks.
// [Downstream Impact] Returns typed OAuthLinkResult with error details.
function handleLinkError(error: any, correlationId: string): OAuthLinkResult {
  console.error(`[Link Provider Error ${correlationId}]`, error);
  const firebaseCode = error?.code || 'unknown';

  if (firebaseCode === 'auth/credential-already-in-use') {
    return {
      success: false,
      message: `This Google/Apple account is already linked to a different Prix Six user. Each provider account can only be linked to one user — if you have multiple accounts, sign in to the other one and unlink it first. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  if (firebaseCode === 'auth/popup-closed-by-user' || firebaseCode === 'auth/cancelled-popup-request') {
    return {
      success: false,
      message: ERRORS.AUTH_OAUTH_POPUP_CLOSED.message,
      correlationId,
    };
  }

  if (firebaseCode === 'auth/provider-already-linked') {
    return {
      success: false,
      message: `This provider is already linked to your account.`,
      correlationId,
    };
  }

  if (firebaseCode === 'auth/operation-not-allowed') {
    return {
      success: false,
      message: `This sign-in provider is not enabled. Enable it in Firebase Console > Authentication > Sign-in method. [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  if (firebaseCode === 'auth/popup-blocked') {
    return {
      success: false,
      message: `${ERRORS.AUTH_OAUTH_POPUP_BLOCKED.message} [${ERRORS.AUTH_OAUTH_POPUP_BLOCKED.code}] (Ref: ${correlationId})`,
      correlationId,
    };
  }

  return {
    success: false,
    message: `${ERRORS.AUTH_OAUTH_LINK_FAILED.message} (${firebaseCode}) [${ERRORS.AUTH_OAUTH_LINK_FAILED.code}] (Ref: ${correlationId})`,
    correlationId,
  };
}
