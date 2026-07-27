// GUID: API_AUTH_SIGNUP-000-v08
// @FEATURE(INVITE-TREE-001, v08): invite consumption now stamps the new user doc with an
//   invitedBy lineage field (inviter uid/teamName + tokenId) so the admin panel can render
//   the full referral genealogy. A valid token is also consumed for lineage when the public
//   gate happens to be open (never blocking in that case).
// @SECURITY_FIX: Added CSRF protection via Origin/Referer validation (GEMINI-005).
// @SECURITY_FIX: GEMINI-AUDIT-112 — Replaced TOCTOU read-then-write team name check with atomic
//   Firestore sentinel document transaction. Previous pattern let two concurrent signups both pass
//   the duplicate check and create users with identical teamNameLower values. Fix uses
//   team_names/{normalizedName} as an atomic lock: transaction reads + writes it in one step;
//   sentinel is cleaned up on subsequent Auth or Firestore failures.
// [Intent] Server-side API route that registers new users: validates input, creates Firebase Auth and Firestore records, enrols the user in the global league, applies late-joiner handicap scoring if the season has started, sends welcome and verification emails, and returns a custom token for immediate sign-in.
// [Inbound Trigger] POST request from the client-side signup form.
// [Downstream Impact] Creates records in users, presence, scores (if late joiner), and audit_logs collections. Updates the global league memberUserIds array. Triggers welcome and verification email API calls. Returns a customToken used by the client to establish a Firebase Auth session.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { sendWhatsAppAlert } from '@/lib/whatsapp-alert';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { internalAuthHeaders } from '@/lib/internal-auth';
import { ERROR_CODES } from '@/lib/error-codes';
import { validateCsrfProtection } from '@/lib/csrf-protection';
import { applyLateJoinerHandicap } from '@/lib/late-joiner';
import { validateInvite, consumeInvite, revertInvite, buildInvitedByStamp, type InvitedByStamp } from '@/lib/invites';
import { claimTeamName } from '@/lib/team-names';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_AUTH_SIGNUP-001-v04
// [Intent] List of commonly guessable 6-digit PINs that are rejected during signup to enforce minimum credential strength.
// [Inbound Trigger] Referenced by the PIN validation logic in the POST handler.
// [Downstream Impact] Adding or removing entries changes which PINs are accepted. If this list is too aggressive, legitimate users may be blocked from signing up.
// @UX(NEWBIE-14, v04) SYNC CONSTRAINT: this list is mirrored client-side in
//   app/src/app/(auth)/signup/InviteSignupForm.tsx (COMPONENT_INVITE_SIGNUP-006) for instant
//   pre-submit feedback. THIS server list is authoritative; edit BOTH lists together.
// Weak PINs that should be rejected
const WEAK_PINS = [
  '123456', '654321', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999', '000000',
  '123123', '121212', '112233', '001122', '102030', '112211',
];

// GUID: API_AUTH_SIGNUP-002-v03
// [Intent] Constant for the global league document ID, used to add every new user to the shared league.
// [Inbound Trigger] Referenced during the global league enrolment step of signup.
// [Downstream Impact] If this value does not match the actual Firestore document ID in the leagues collection, new users will not be added to the global league.
const GLOBAL_LEAGUE_ID = 'global';

// GUID: API_AUTH_SIGNUP-003-v03
// [Intent] Type contract for the expected JSON body of the signup request.
// [Inbound Trigger] Used to type-assert the parsed request body in the POST handler.
// [Downstream Impact] Any change to these fields requires matching changes in the client-side signup form submission logic.
interface SignupRequest {
  email: string;
  teamName: string;
  pin: string;
  inviteToken?: string;
}

// GUID: API_AUTH_SIGNUP-004-v03
// [Intent] Main signup POST handler. Validates all input fields (email, team name, PIN strength), checks admin toggle for signup availability, prevents duplicate emails and team names, creates the Firebase Auth user and Firestore documents, handles late-joiner handicap, sends emails, and returns a custom token.
// [Inbound Trigger] HTTP POST to /api/auth/signup from the client-side signup form.
// [Downstream Impact] On success: creates Firebase Auth user, Firestore user document, presence document, global league membership, optional late-joiner handicap score, audit log, and triggers welcome + verification emails. Returns customToken + uid for immediate client-side sign-in.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  // GUID: API_AUTH_SIGNUP-023-v01
  // @SECURITY_FIX (SEC-DOS-002, 2026-07-27): signup was re-enabled (invite-only, v3.5.0) but had
  //   ZERO throttling — an attacker could hammer it to burn Firebase Auth quota / enumerate
  //   invite tokens. Per-IP limiter matching the reset-pin pattern: 5 attempts / 15 min.
  //   Legitimate use: a household signs up once; 5/15min is generous headroom.
  const signupRl = checkRateLimit(`signup-ip:${getClientIp(request)}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!signupRl.allowed) {
    return NextResponse.json(
      { success: false, error: ERRORS.RATE_LIMIT_EXCEEDED.message, errorCode: ERRORS.RATE_LIMIT_EXCEEDED.code, correlationId, retryAfterSeconds: signupRl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(signupRl.retryAfterSeconds ?? 900) } }
    );
  }

  // GUID: API_AUTH_SIGNUP-022-v01
  // @SECURITY_FIX: CSRF protection via Origin/Referer validation (GEMINI-005).
  // [Intent] Validate that the request originates from an allowed domain to prevent CSRF attacks.
  // [Inbound Trigger] Every signup request, before processing any data.
  // [Downstream Impact] Rejects cross-origin requests from malicious sites with 403 status.
  const csrfError = validateCsrfProtection(request, correlationId);
  if (csrfError) {
    return csrfError;
  }

  try {
    const data: SignupRequest = await request.json();
    const { email, teamName, pin, inviteToken } = data;

    // GUID: API_AUTH_SIGNUP-005-v03
    // [Intent] Validate that all required fields (email, team name, PIN) are present.
    // [Inbound Trigger] Every signup request passes through this check.
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS error code if any field is absent.
    // Validate required fields
    if (!email || !teamName || !pin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Email, team name, and PIN are required',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_AUTH_SIGNUP-006-v03
    // [Intent] Validate PIN format (exactly 6 digits) and reject weak/guessable PINs from the WEAK_PINS list.
    // [Inbound Trigger] Runs after required-field validation passes.
    // [Downstream Impact] Returns 400 with VALIDATION_INVALID_FORMAT error code if PIN does not meet criteria. Prevents creation of accounts with easily compromised credentials.
    // Validate PIN format
    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        {
          success: false,
          error: 'PIN must be exactly 6 digits',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check for weak PINs
    if (WEAK_PINS.includes(pin)) {
      return NextResponse.json(
        {
          success: false,
          error: 'This PIN is too easy to guess. Please choose a stronger one.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_AUTH_SIGNUP-007-v03
    // [Intent] Validate that the team name is at least 3 characters long.
    // [Inbound Trigger] Runs after PIN validation passes.
    // [Downstream Impact] Returns 400 with VALIDATION_INVALID_FORMAT error code if team name is too short.
    // Validate team name length
    if (teamName.trim().length < 3) {
      return NextResponse.json(
        {
          success: false,
          error: 'Team name must be at least 3 characters',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Normalize values
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedTeamName = teamName.trim();

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // GUID: API_AUTH_SIGNUP-008-v05
    // @SECURITY_FIX(SEC-SIGNUP-001): Fail-closed signup gate. Previous version read the
    //   non-existent admin_configuration/site_settings doc and proceeded on missing doc or
    //   read error (fail-open), leaving POST /api/auth/signup accepting registrations while
    //   the /signup UI said "Registration Closed". Now reads admin_configuration/global —
    //   the SAME doc the admin Site Functions panel writes (SSOT, was a doc-ID mismatch) —
    //   and signup proceeds ONLY when newUserSignupEnabled === true.
    // [Intent] Fail-closed signup gate with friend-invite bypass. Signup proceeds when the
    //          admin toggle newUserSignupEnabled === true, OR when a valid pending unexpired
    //          invite token accompanies the request (API_AUTH_SIGNUP-024).
    // [Inbound Trigger] Runs after input normalisation and Firebase Admin initialisation.
    // [Downstream Impact] Missing doc, missing field, or settings read error all fail closed.
    //                     A valid invite sets inviteTokenToConsume, burned single-use just
    //                     before Auth user creation. Emits PX-2102/PX-2103 for bad tokens.
    // Check if new user signups are enabled — fail closed
    let signupEnabled = false;
    try {
      const settingsDoc = await db.collection('admin_configuration').doc('global').get();
      signupEnabled = settingsDoc.exists && settingsDoc.data()?.newUserSignupEnabled === true;
    } catch (settingsError) {
      console.error('[Signup] Could not check signup settings (failing closed):', settingsError);
    }

    // GUID: API_AUTH_SIGNUP-024-v02
    // @FEATURE(INVITE-TREE-001, v02): validation now also captures the inviter's identity
    //   as an InvitedByStamp for the referral tree, and a token arriving while the public
    //   gate is OPEN is validated too (lineage-only — an invalid token never blocks an
    //   open-gate signup). The fail-closed gate semantics are UNCHANGED: with the gate
    //   closed, no valid token still means 403.
    // [Intent] Friend-invite bypass: when public signup is disabled, a valid pending
    //          unexpired invite token (from /api/invites/create) permits this one signup.
    //          Whenever a valid token accompanies the request (gate open or closed), the
    //          inviter's identity is captured to stamp users/{uid}.invitedBy.
    // [Inbound Trigger] Gate evaluation above (both outcomes).
    // [Downstream Impact] Valid token → signup continues and the token is consumed
    //                     (single-use transaction) before Auth user creation. Invalid with
    //                     gate closed → 403 PX-2102 INVITE_INVALID; expired → 403 PX-2103
    //                     INVITE_EXPIRED. inviteRequired distinguishes gate-bypass consumption
    //                     (failure = 403) from lineage-only consumption (failure = ignore).
    let inviteTokenToConsume: string | null = null;
    let invitedByStamp: InvitedByStamp | null = null;
    let inviteRequired = false;
    if (!signupEnabled) {
      inviteRequired = true;
      if (inviteToken) {
        const inviteCheck = await validateInvite(db, inviteToken);
        if (inviteCheck.valid) {
          inviteTokenToConsume = inviteCheck.token;
          invitedByStamp = buildInvitedByStamp(inviteCheck.token, inviteCheck.invite);
        } else {
          const expired = inviteCheck.reason === 'expired';
          return NextResponse.json(
            {
              success: false,
              error: expired
                ? 'This invite link has expired — ask your friend to send a fresh one.'
                : 'This invite link is invalid or has already been used.',
              errorCode: expired ? ERRORS.INVITE_EXPIRED.code : ERRORS.INVITE_INVALID.code,
              correlationId,
            },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          {
            success: false,
            error: 'New user registration is currently disabled.',
            errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
            correlationId,
          },
          { status: 403 }
        );
      }
    } else if (inviteToken) {
      // Gate is open but the signup arrived via an invite link — capture lineage only.
      // An invalid/expired/used token must NOT block a signup the open gate already permits.
      const inviteCheck = await validateInvite(db, inviteToken);
      if (inviteCheck.valid) {
        inviteTokenToConsume = inviteCheck.token;
        invitedByStamp = buildInvitedByStamp(inviteCheck.token, inviteCheck.invite);
      }
    }

    // GUID: API_AUTH_SIGNUP-009-v03
    // [Intent] Check for duplicate email addresses in the Firestore users collection to prevent multiple accounts with the same email.
    // [Inbound Trigger] Runs after the signup-enabled check passes.
    // [Downstream Impact] Returns 409 with VALIDATION_DUPLICATE_ENTRY if the email already exists. This is a Firestore-level check; Firebase Auth also enforces email uniqueness separately.
    // Check if email already exists in Firestore
    const emailQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!emailQuery.empty) {
      return NextResponse.json(
        {
          success: false,
          error: 'A team with this email address already exists.',
          errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // GUID: API_AUTH_SIGNUP-010-v07
    // @FIX(v07) SEC-SIGNUP-003: inline sentinel transaction moved to lib/team-names.ts
    //   claimTeamName() — the shared SSOT now used by every name-claiming flow.
    // @SECURITY_FIX: GEMINI-AUDIT-112 — Replaced TOCTOU read-then-write with atomic Firestore transaction.
    // @PERFORMANCE_FIX: Replaced getAllUsers() with indexed queries (was fetching ALL users causing 5-30s hangs).
    // [Intent] Atomically claim team name uniqueness via a sentinel document in team_names/{name}.
    //          The Firestore transaction ensures no two concurrent signups can claim the same name
    //          simultaneously — the second transaction sees the sentinel and returns TEAM_NAME_TAKEN.
    //          Secondary names are still checked via query (post-signup secondary names are set via
    //          profile API, not concurrent new signups, so no sentinel needed for that check).
    // [Inbound Trigger] Runs after the email uniqueness check passes.
    // [Downstream Impact] Creates team_names/{normalizedNewName} as a reservation document.
    //                     teamNameSentinelRef is used throughout this handler for cleanup on failure
    //                     and update on success. Returns 409 if name is already taken (primary or secondary).
    const normalizedNewName = normalizedTeamName.toLowerCase();
    const teamNameSentinelRef = db.collection('team_names').doc(normalizedNewName);

    // GUID: API_AUTH_SIGNUP-026-v01
    // @SECURITY_FIX(SEC-SIGNUP-002): Check existing PRIMARY team names directly in users.
    //   The sentinel collection only contains names claimed via THIS route — OAuth signups
    //   (complete-oauth-profile) never write a sentinel, so their team names were duplicable
    //   here (found live: a probe successfully re-registered an OAuth user's team name).
    // [Intent] Reject signups whose team name matches any existing user's primary team name.
    // [Inbound Trigger] Runs before the sentinel transaction.
    // [Downstream Impact] Returns 409 VALIDATION_DUPLICATE_ENTRY. Uses the indexed
    //                     teamNameLower field written by both signup paths.
    const primarySnapshot = await db.collection('users')
      .where('teamNameLower', '==', normalizedNewName)
      .limit(1)
      .get();

    if (!primarySnapshot.empty) {
      return NextResponse.json(
        {
          success: false,
          error: 'This team name is already taken. Please choose a unique name.',
          errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // Check against existing secondary team names (non-concurrent check — secondary names are
    // only set via profile update API, not concurrently with new signups, so query is safe here)
    const secondarySnapshot = await db.collection('users')
      .where('secondaryTeamNameLower', '==', normalizedNewName)
      .limit(1)
      .get();

    if (!secondarySnapshot.empty) {
      return NextResponse.json(
        {
          success: false,
          error: 'This team name is already taken. Please choose a unique name.',
          errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // Atomically claim the team name via the shared sentinel helper (SEC-SIGNUP-003 SSOT —
    // same transaction all name-claiming flows use). Two concurrent signups cannot both win.
    const nameClaimed = await claimTeamName(db, FieldValue, normalizedTeamName, { kind: 'primary' });
    if (!nameClaimed) {
      return NextResponse.json(
        {
          success: false,
          error: 'This team name is already taken. Please choose a unique name.',
          errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // GUID: API_AUTH_SIGNUP-025-v02
    // @FEATURE(INVITE-TREE-001, v02): when the invite was lineage-only (gate open), losing
    //   the consume race just drops the invitedBy stamp instead of failing the signup —
    //   the open gate already authorised the account.
    // [Intent] Burn the friend-invite token (single-use, transactional) now that every
    //          pre-creation check has passed. Done BEFORE Auth user creation so two racing
    //          signups on the same token cannot both mint accounts; reverted on failure
    //          below so a transient error doesn't strand the invitee with a dead link.
    // [Inbound Trigger] inviteTokenToConsume was set by the gate (API_AUTH_SIGNUP-024).
    // [Downstream Impact] Losing the consume race when the invite authorised the signup
    //                     (inviteRequired) frees the team-name sentinel and returns 403
    //                     PX-2102; lineage-only consumption failure clears the stamp and
    //                     continues.
    if (inviteTokenToConsume) {
      const consumed = await consumeInvite(db, inviteTokenToConsume, { email: normalizedEmail });
      if (!consumed) {
        if (inviteRequired) {
          await teamNameSentinelRef.delete().catch(() => {});
          return NextResponse.json(
            {
              success: false,
              error: 'This invite link is invalid or has already been used.',
              errorCode: ERRORS.INVITE_INVALID.code,
              correlationId,
            },
            { status: 403 }
          );
        }
        inviteTokenToConsume = null;
        invitedByStamp = null;
      }
    }

    // GUID: API_AUTH_SIGNUP-011-v07
    // @SECURITY_FIX: GEMINI-AUDIT-112 — Added teamNameSentinelRef cleanup on Auth creation failure.
    //   If Auth.createUser() throws, the sentinel is deleted so the name is freed for future signups.
    // @FIX(v07) SEC-SIGNUP-001: consumed invite token is reverted to pending on Auth failure.
    // [Intent] Create the Firebase Auth user record with the provided email and PIN as password. Handles the auth/email-already-exists error case separately from other auth errors.
    // [Inbound Trigger] Runs after all validation and uniqueness checks pass (including sentinel claim).
    // [Downstream Impact] On success, the uid from the created user record is used for all subsequent Firestore document creation. On failure, sentinel is cleaned up, any consumed invite is reverted, and no Firestore documents are created.
    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: normalizedEmail,
        password: pin,
        emailVerified: false,
      });
    } catch (authError: any) {
      // Cleanup sentinel — this signup failed before user was created, so free the name
      await teamNameSentinelRef.delete().catch((deleteErr: any) => {
        // @SECURITY_FIX (Wave 10): NODE_ENV gate
        if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] Failed to cleanup team name sentinel after auth error:`, deleteErr); }
      });
      // Revert the invite so the friend can retry with the same link
      if (inviteTokenToConsume) {
        await revertInvite(db, inviteTokenToConsume).catch((revertErr: any) => {
          if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] Failed to revert invite after auth error:`, revertErr); }
        });
      }
      // @SECURITY_FIX (Wave 10): NODE_ENV gate
      if (process.env.NODE_ENV !== 'production') { console.error(`[Signup Auth Error ${correlationId}]`, authError); }

      if (authError.code === 'auth/email-already-exists') {
        return NextResponse.json(
          {
            success: false,
            error: 'A team with this email address already exists.',
            errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
            correlationId,
          },
          { status: 409 }
        );
      }

      const traced = createTracedError(ERRORS.AUTH_SIGNIN_VERIFICATION_FAILED, {
        correlationId,
        context: { route: '/api/auth/signup', action: 'create_auth_user', requestData: { email: normalizedEmail, teamName: normalizedTeamName }, authErrorCode: authError.code },
        cause: authError instanceof Error ? authError : undefined,
      });
      await logTracedError(traced, db);

      return NextResponse.json(
        {
          success: false,
          error: traced.definition.message,
          errorCode: traced.definition.code,
          correlationId: traced.correlationId,
        },
        { status: 500 }
      );
    }

    const uid = userRecord.uid;

    // GUID: API_AUTH_SIGNUP-012-v08
    // @FEATURE(INVITE-TREE-001, v08): user doc now carries invitedBy (inviter uid/teamName +
    //   consumed tokenId + timestamp) when the account was minted through an invite. Legacy
    //   and root users simply lack the field — readers must treat absence as "root/unknown".
    // @PERFORMANCE_FIX: Added teamNameLower field for indexed queries (prevents getAllUsers() bottleneck).
    // @ATOMICITY_FIX: Wrapped critical Firestore writes in try/catch with Auth user rollback to prevent orphaned accounts.
    // @SECURITY_FIX: GEMINI-AUDIT-112 — Added teamNameSentinelRef cleanup on Firestore failure (before auth rollback).
    // @SECURITY_FIX (Wave 10): NODE_ENV gate applied to all console.error calls in Firestore error handler.
    //   On success: updates sentinel with userId (non-critical, fire-and-forget) to track ownership.
    // [Intent] Create the Firestore user document and presence document for the newly registered user. The user document stores profile and state data; the presence document tracks online status. If Firestore writes fail, delete the Auth user to maintain atomicity and clean up the sentinel.
    // [Inbound Trigger] Runs after Firebase Auth user is successfully created.
    // [Downstream Impact] The users document is read by many parts of the application (login, dashboard, admin panels). The presence document is used by the online status system. Both documents are keyed by the Firebase Auth uid. If this fails, the Auth user is deleted and sentinel cleaned up to prevent orphaned accounts and stale name reservations.
    // Create Firestore user document (with rollback on failure)
    try {
      const newUser = {
        id: uid,
        email: normalizedEmail,
        teamName: normalizedTeamName,
        teamNameLower: normalizedTeamName.toLowerCase().trim(), // For indexed duplicate check
        isAdmin: false,
        mustChangePin: false,
        badLoginAttempts: 0,
        emailVerified: false,
        createdAt: FieldValue.serverTimestamp(),
        // INVITE-TREE-001: referral lineage — absent for root/legacy users
        ...(invitedByStamp ? { invitedBy: invitedByStamp } : {}),
      };

      await db.collection('users').doc(uid).set(newUser);

      // Create presence document
      await db.collection('presence').doc(uid).set({
        online: false,
        sessions: [],
      });

      // Update sentinel with userId now that the user document is committed (non-critical metadata)
      teamNameSentinelRef.update({ userId: uid, reservedAt: FieldValue.serverTimestamp() }).catch(() => {});

      // Record the new uid on the consumed invite (non-critical metadata)
      if (inviteTokenToConsume) {
        db.collection('invites').doc(inviteTokenToConsume).update({ acceptedUid: uid }).catch(() => {});
      }
    } catch (firestoreError: any) {
      // Cleanup sentinel — free the name reservation before rolling back Auth user
      await teamNameSentinelRef.delete().catch((deleteErr: any) => {
        // @SECURITY_FIX (Wave 10): NODE_ENV gate
        if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] Failed to cleanup team name sentinel after Firestore error:`, deleteErr); }
      });

      // Revert the invite so the friend can retry with the same link (account fully rolled back below)
      if (inviteTokenToConsume) {
        await revertInvite(db, inviteTokenToConsume).catch((revertErr: any) => {
          if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] Failed to revert invite after Firestore error:`, revertErr); }
        });
      }

      // CRITICAL: Rollback Auth user creation to prevent orphaned accounts
      // @SECURITY_FIX (Wave 10): NODE_ENV gate
      if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] Firestore write failed, rolling back Auth user:`, firestoreError); }
      try {
        await auth.deleteUser(uid);
        console.log(`[Signup ${correlationId}] Auth user ${uid} deleted successfully`);
      } catch (deleteError: any) {
        // @SECURITY_FIX (Wave 10): NODE_ENV gate
        if (process.env.NODE_ENV !== 'production') { console.error(`[Signup ${correlationId}] CRITICAL: Failed to delete Auth user during rollback:`, deleteError); }
        // Log the orphaned account for manual cleanup
        await db.collection('error_logs').add({
          errorCode: 'ORPHANED_AUTH_ACCOUNT',
          message: `Auth user ${uid} (${normalizedEmail}) created but Firestore write failed and rollback also failed. REQUIRES MANUAL CLEANUP.`,
          correlationId,
          uid,
          email: normalizedEmail,
          firestoreError: firestoreError.message,
          deleteError: deleteError.message,
          timestamp: FieldValue.serverTimestamp(),
        });
      }

      // @FIX: ERRORS.DATABASE_ERROR does not exist (ERRORS is Record<string,…> → undefined at
      //   runtime). This path is a failed user-document create, so use ERRORS.FIRESTORE_WRITE_FAILED (PX-4002).
      const traced = createTracedError(ERRORS.FIRESTORE_WRITE_FAILED, {
        correlationId,
        context: { route: '/api/auth/signup', action: 'create_user_document', requestData: { email: normalizedEmail, teamName: normalizedTeamName } },
        cause: firestoreError instanceof Error ? firestoreError : undefined,
      });
      await logTracedError(traced, db);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create user account. Please try again.',
          errorCode: traced.definition.code,
          correlationId: traced.correlationId,
        },
        { status: 500 }
      );
    }

    // GUID: API_AUTH_SIGNUP-013-v04
    // @BUG_FIX: Track partial failures and warn user instead of silent failure.
    // [Intent] Add the new user to the global league by appending their uid to the memberUserIds array. Non-blocking, but now warns user if it fails.
    // [Inbound Trigger] Runs after user and presence documents are created.
    // [Downstream Impact] If this fails, the user will not appear in the global league standings until manually added. The global league document must have a memberUserIds array field.
    // Add user to global league
    const warnings: string[] = [];
    try {
      const globalLeagueRef = db.collection('leagues').doc(GLOBAL_LEAGUE_ID);
      await globalLeagueRef.update({
        memberUserIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (leagueError: any) {
      console.warn('[Signup] Could not add user to global league:', leagueError.message);
      warnings.push('League enrollment pending - you may not appear in standings immediately.');
    }

    // GUID: API_AUTH_SIGNUP-014-v06
    // @DOC_FIX (NEWBIE-11, v06): comment previously described the retired flat "-5 penalty" rule;
    //   updated to the ACTIVE-FLOOR rule actually implemented in @/lib/late-joiner: the new team's
    //   score is cloned from the current lowest-placed ACTIVE team, then a one-time -1 adjustment
    //   is written so they start exactly 1 point behind that floor.
    // @BUG_FIX (v3.1.x): The previous implementation read the dead `scores` collection (post-SSOT-001
    //   the live standings come from race_results × predictions) so the handicap was both miscalculated
    //   AND never read by the standings page. The full late-joiner mechanic now lives in
    //   @/lib/late-joiner: it clones the current last-place ACTIVE team's prior-race predictions into
    //   the new team, writes a one-time -1 active-floor adjustment to standings_adjustments (read by
    //   /api/standings) so the newcomer starts 1 point behind the lowest active team, sets the
    //   lateJoiner flags that drive the welcome/acknowledgement screen, and writes an audit entry for
    //   the team creation AND for every cloned submission (full transparency).
    // [Inbound Trigger] Runs after global league enrolment.
    // [Downstream Impact] See @/lib/late-joiner contract. Non-blocking: a handicap failure is logged
    //   but never prevents account creation (the user simply starts at 0).
    try {
      await applyLateJoinerHandicap(db, uid, normalizedTeamName);
    } catch (handicapError: any) {
      console.warn('[Signup] Could not apply late joiner handicap:', handicapError.message);
    }

    // GUID: API_AUTH_SIGNUP-015-v05
    // @BUG_FIX: Track email failure and warn user instead of silent failure.
    // [Intent] Send a verification email to the new user via internal API endpoint. Non-blocking,
    //          but now warns user if it fails. The verification email serves as both welcome
    //          and verification (branded template with CTA button).
    // [Inbound Trigger] Runs after all Firestore documents and handicap scoring are complete.
    // [Downstream Impact] Calls /api/send-verification-email. If the endpoint is down, the user
    //                     will not receive the email but the account is still fully created.
    // Send verification email (also serves as welcome email — no separate welcome needed)
    try {
      const baseUrl = request.headers.get('origin') || 'https://prix6.win';
      // @SECURITY_FIX (cyber.md H-1): send-verification-email now requires internal secret (server) or a self-token.
      const emailResponse = await fetch(`${baseUrl}/api/send-verification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({
          uid,
          email: normalizedEmail,
          teamName: normalizedTeamName,
        }),
      });

      if (!emailResponse.ok) {
        warnings.push('Verification email may be delayed - check your inbox in a few minutes.');
      }
    } catch (verifyError: any) {
      console.warn('[Signup] Failed to send verification email:', verifyError.message);
      warnings.push('Verification email may be delayed - check your inbox in a few minutes.');
    }

    // GUID: API_AUTH_SIGNUP-016-v03
    // [Intent] Log the successful registration to the audit_logs collection and generate a Firebase custom token so the client can sign in immediately without a second round-trip.
    // [Inbound Trigger] Runs after email dispatch attempts complete.
    // [Downstream Impact] The audit log provides a permanent record of user registration. The returned customToken and uid are consumed by the client to call signInWithCustomToken() for immediate session establishment.
    // Log successful registration
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'USER_REGISTERED',
      details: {
        email: normalizedEmail,
        teamName: normalizedTeamName,
        registeredAt: new Date().toISOString(),
        method: 'server_api',
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Generate custom token for immediate sign-in
    const customToken = await auth.createCustomToken(uid);

    // newPlayerJoined WhatsApp alert — fire-and-forget, gated by whatsapp_alerts settings.
    void sendWhatsAppAlert('newPlayerJoined', `👋 *${normalizedTeamName}* just joined Prix Six! Welcome aboard. 🏎️`);

    return NextResponse.json({
      success: true,
      message: 'Registration successful!',
      warnings: warnings.length > 0 ? warnings : undefined,
      customToken,
      uid,
    });

  // GUID: API_AUTH_SIGNUP-017-v05
  // [Intent] Top-level catch-all error handler for any unhandled exception during signup. Logs the error to error_logs and returns a generic 500 response with correlation ID for support tracing.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID and UNKNOWN_ERROR code in the response allow support to trace the issue.
  // @SECURITY_FIX (Wave 10): NODE_ENV gate applied to console.error in top-level catch.
  } catch (error: any) {
    // @SECURITY_FIX (Wave 10): NODE_ENV gate
    if (process.env.NODE_ENV !== 'production') { console.error(`[Signup Error ${correlationId}]`, error); }

    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/auth/signup', action: 'POST', errorType: error.code || error.name || 'UnknownError' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, db);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
