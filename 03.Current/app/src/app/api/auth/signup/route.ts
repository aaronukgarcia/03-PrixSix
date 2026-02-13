// GUID: API_AUTH_SIGNUP-000-v05
// @SECURITY_FIX: Added CSRF protection via Origin/Referer validation (GEMINI-005).
// [Intent] Server-side API route that registers new users: validates input, creates Firebase Auth and Firestore records, enrols the user in the global league, applies late-joiner handicap scoring if the season has started, sends welcome and verification emails, and returns a custom token for immediate sign-in.
// [Inbound Trigger] POST request from the client-side signup form.
// [Downstream Impact] Creates records in users, presence, scores (if late joiner), and audit_logs collections. Updates the global league memberUserIds array. Triggers welcome and verification email API calls. Returns a customToken used by the client to establish a Firebase Auth session.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { ERROR_CODES } from '@/lib/error-codes';
import { validateCsrfProtection } from '@/lib/csrf-protection';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_AUTH_SIGNUP-001-v03
// [Intent] List of commonly guessable 6-digit PINs that are rejected during signup to enforce minimum credential strength.
// [Inbound Trigger] Referenced by the PIN validation logic in the POST handler.
// [Downstream Impact] Adding or removing entries changes which PINs are accepted. If this list is too aggressive, legitimate users may be blocked from signing up.
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
}

// GUID: API_AUTH_SIGNUP-004-v03
// [Intent] Main signup POST handler. Validates all input fields (email, team name, PIN strength), checks admin toggle for signup availability, prevents duplicate emails and team names, creates the Firebase Auth user and Firestore documents, handles late-joiner handicap, sends emails, and returns a custom token.
// [Inbound Trigger] HTTP POST to /api/auth/signup from the client-side signup form.
// [Downstream Impact] On success: creates Firebase Auth user, Firestore user document, presence document, global league membership, optional late-joiner handicap score, audit log, and triggers welcome + verification emails. Returns customToken + uid for immediate client-side sign-in.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

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
    const { email, teamName, pin } = data;

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

    // GUID: API_AUTH_SIGNUP-008-v03
    // [Intent] Check the admin_configuration/site_settings document to determine if new user signups are currently enabled. Allows admins to disable registration without code changes.
    // [Inbound Trigger] Runs after input normalisation and Firebase Admin initialisation.
    // [Downstream Impact] If newUserSignupEnabled is false, returns 403 with AUTH_PERMISSION_DENIED. If the settings document cannot be read, signup proceeds (fail-open).
    // Check if new user signups are enabled
    try {
      const settingsDoc = await db.collection('admin_configuration').doc('site_settings').get();
      if (settingsDoc.exists) {
        const settings = settingsDoc.data();
        if (settings?.newUserSignupEnabled === false) {
          return NextResponse.json(
            {
              success: false,
              error: 'New user registration is currently disabled.',
              errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
              correlationId,
            },
            { status: 403 }
          );
        }
      }
    } catch (settingsError) {
      console.warn('[Signup] Could not check signup settings:', settingsError);
      // Continue with signup if settings check fails
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

    // GUID: API_AUTH_SIGNUP-010-v05
    // @PERFORMANCE_FIX: Replaced getAllUsers() with indexed queries (was fetching ALL users causing 5-30s hangs).
    // [Intent] Check for duplicate team names (case-insensitive) across all existing users'
    //          primary AND secondary team names to ensure team name uniqueness.
    // [Inbound Trigger] Runs after the email uniqueness check passes.
    // [Downstream Impact] Returns 409 with VALIDATION_DUPLICATE_ENTRY if the team name is already taken.
    // Check if team name already exists (case-insensitive)
    const normalizedNewName = normalizedTeamName.toLowerCase();

    // Strategy: Use two targeted queries instead of fetching all users (performance fix)
    // Query 1: Check primary team names
    const primaryQuery = db.collection('users')
      .where('teamNameLower', '==', normalizedNewName)
      .limit(1);

    // Query 2: Check secondary team names
    const secondaryQuery = db.collection('users')
      .where('secondaryTeamNameLower', '==', normalizedNewName)
      .limit(1);

    // Execute both queries in parallel
    const [primarySnapshot, secondarySnapshot] = await Promise.all([
      primaryQuery.get(),
      secondaryQuery.get()
    ]);

    if (!primarySnapshot.empty || !secondarySnapshot.empty) {
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

    // GUID: API_AUTH_SIGNUP-011-v04
    // [Intent] Create the Firebase Auth user record with the provided email and PIN as password. Handles the auth/email-already-exists error case separately from other auth errors.
    // [Inbound Trigger] Runs after all validation and uniqueness checks pass.
    // [Downstream Impact] On success, the uid from the created user record is used for all subsequent Firestore document creation. On failure, no Firestore documents are created (partial state is avoided).
    // Create Firebase Auth user
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: normalizedEmail,
        password: pin,
        emailVerified: false,
      });
    } catch (authError: any) {
      console.error(`[Signup Auth Error ${correlationId}]`, authError);

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

    // GUID: API_AUTH_SIGNUP-012-v05
    // @PERFORMANCE_FIX: Added teamNameLower field for indexed queries (prevents getAllUsers() bottleneck).
    // @ATOMICITY_FIX: Wrapped critical Firestore writes in try/catch with Auth user rollback to prevent orphaned accounts.
    // [Intent] Create the Firestore user document and presence document for the newly registered user. The user document stores profile and state data; the presence document tracks online status. If Firestore writes fail, delete the Auth user to maintain atomicity.
    // [Inbound Trigger] Runs after Firebase Auth user is successfully created.
    // [Downstream Impact] The users document is read by many parts of the application (login, dashboard, admin panels). The presence document is used by the online status system. Both documents are keyed by the Firebase Auth uid. If this fails, the Auth user is deleted to prevent orphaned accounts.
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
      };

      await db.collection('users').doc(uid).set(newUser);

      // Create presence document
      await db.collection('presence').doc(uid).set({
        online: false,
        sessions: [],
      });
    } catch (firestoreError: any) {
      // CRITICAL: Rollback Auth user creation to prevent orphaned accounts
      console.error(`[Signup ${correlationId}] Firestore write failed, rolling back Auth user:`, firestoreError);
      try {
        await auth.deleteUser(uid);
        console.log(`[Signup ${correlationId}] Auth user ${uid} deleted successfully`);
      } catch (deleteError: any) {
        console.error(`[Signup ${correlationId}] CRITICAL: Failed to delete Auth user during rollback:`, deleteError);
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

      const traced = createTracedError(ERRORS.DATABASE_ERROR, {
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

    // GUID: API_AUTH_SIGNUP-014-v03
    // [Intent] Apply the late-joiner handicap rule: if the season has already started (scores exist), calculate a starting score of (lowest real score - 5) so the new user starts 5 points behind last place. Skips existing adjustment scores when determining the minimum.
    // [Inbound Trigger] Runs after global league enrolment.
    // [Downstream Impact] Creates a scores document with isAdjustment=true and raceId='late-joiner-handicap'. This score is included in standings calculations. An audit log entry is also created. If this fails, the user starts at 0 points (no handicap applied).
    // LATE JOINER RULE: If season has started, new users start 5 points behind last place
    // All late joiners get the same handicap: (lowest real score - 5)
    try {
      const scoresSnapshot = await db.collection('scores').get();
      if (!scoresSnapshot.empty) {
        // Calculate total points per user, excluding adjustment scores
        const userTotals = new Map<string, number>();
        scoresSnapshot.forEach(scoreDoc => {
          const scoreData = scoreDoc.data();
          // Skip adjustment scores (late joiner handicaps) when calculating base standings
          if (scoreData.isAdjustment) return;
          const scoreUserId = scoreData.userId;
          const points = scoreData.totalPoints || 0;
          userTotals.set(scoreUserId, (userTotals.get(scoreUserId) || 0) + points);
        });

        // Only apply handicap if there are users with real race scores
        if (userTotals.size > 0) {
          const minScore = Math.min(...Array.from(userTotals.values()));
          const handicapPoints = minScore - 5;

          // Create a handicap score document - this is positive starting points
          await db.collection('scores').doc(`late-joiner-handicap_${uid}`).set({
            userId: uid,
            raceId: 'late-joiner-handicap',
            raceName: 'Late Joiner Handicap',
            totalPoints: handicapPoints,
            breakdown: `Late joiner starting points: ${minScore} (last place) - 5 = ${handicapPoints}`,
            calculatedAt: FieldValue.serverTimestamp(),
            isAdjustment: true,
          });

          await db.collection('audit_logs').add({
            userId: uid,
            action: 'LATE_JOINER_HANDICAP',
            details: {
              minScore,
              handicapPoints,
              reason: 'Season already in progress - starts 5 points behind last place'
            },
            timestamp: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (handicapError: any) {
      console.warn('[Signup] Could not calculate late joiner handicap:', handicapError.message);
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
      const emailResponse = await fetch(`${baseUrl}/api/send-verification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    return NextResponse.json({
      success: true,
      message: 'Registration successful!',
      warnings: warnings.length > 0 ? warnings : undefined,
      customToken,
      uid,
    });

  // GUID: API_AUTH_SIGNUP-017-v04
  // [Intent] Top-level catch-all error handler for any unhandled exception during signup. Logs the error to error_logs and returns a generic 500 response with correlation ID for support tracing.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID and UNKNOWN_ERROR code in the response allow support to trace the issue.
  } catch (error: any) {
    console.error(`[Signup Error ${correlationId}]`, error);

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
