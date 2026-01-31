// GUID: API_AUTH_COMPLETE_OAUTH-000-v04
// [Intent] Server-side API route that completes the profile for new OAuth users.
//          Mirrors the signup route but skips Firebase Auth user creation (OAuth already created it).
//          Validates the user exists in Auth with an OAuth provider, creates Firestore documents,
//          enrols in global league, applies late-joiner handicap, and sends welcome email.
// [Inbound Trigger] POST request from the /complete-profile page after an OAuth user enters their team name.
// [Downstream Impact] Creates records in users, presence, scores (if late joiner), and audit_logs collections.
//                     Updates the global league memberUserIds array. Triggers welcome email.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { ERROR_CODES } from '@/lib/error-codes';

export const dynamic = 'force-dynamic';

// GUID: API_AUTH_COMPLETE_OAUTH-001-v03
// [Intent] Type contract for the expected JSON body.
// [Inbound Trigger] Used to type-assert the parsed request body.
// [Downstream Impact] Changes require matching changes in the complete-profile page.
interface CompleteOAuthProfileRequest {
  uid: string;
  teamName: string;
  email: string;
  photoUrl?: string;
  providers: string[];
}

const GLOBAL_LEAGUE_ID = 'global';

// GUID: API_AUTH_COMPLETE_OAUTH-002-v03
// [Intent] Main POST handler. Validates the OAuth user in Firebase Auth, checks team name
//          uniqueness, creates Firestore user and presence documents, handles late-joiner
//          handicap, global league enrolment, and welcome email.
// [Inbound Trigger] HTTP POST from /complete-profile page.
// [Downstream Impact] Creates user doc, presence doc, global league membership. On success,
//                     the client-side onAuthStateChanged picks up the new doc and sets user state.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const data: CompleteOAuthProfileRequest = await request.json();
    const { uid, teamName, email, photoUrl, providers } = data;

    // GUID: API_AUTH_COMPLETE_OAUTH-003-v03
    // [Intent] Validate required fields.
    // [Inbound Trigger] Every request.
    // [Downstream Impact] Returns 400 if uid, teamName, or email is missing.
    if (!uid || !teamName || !email) {
      return NextResponse.json(
        {
          success: false,
          error: 'UID, team name, and email are required',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-004-v03
    // [Intent] Validate team name length.
    // [Inbound Trigger] After required field check.
    // [Downstream Impact] Returns 400 if team name is under 3 characters.
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

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedTeamName = teamName.trim();

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // GUID: API_AUTH_COMPLETE_OAUTH-005-v03
    // [Intent] Verify the Firebase Auth user exists and has an OAuth provider.
    // [Inbound Trigger] After input validation.
    // [Downstream Impact] Returns 400 if user not found or has no OAuth provider.
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (authError: any) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found in authentication system',
          errorCode: ERROR_CODES.AUTH_USER_NOT_FOUND.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const hasOAuth = authUser.providerData.some(
      (p: any) => p.providerId === 'google.com' || p.providerId === 'apple.com'
    );

    if (!hasOAuth) {
      return NextResponse.json(
        {
          success: false,
          error: 'This endpoint is for OAuth users only',
          errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-006-v03
    // [Intent] Ensure no Firestore user doc exists yet (prevents double-creation).
    // [Inbound Trigger] After auth user verification.
    // [Downstream Impact] Returns 409 if doc already exists.
    const existingDoc = await db.collection('users').doc(uid).get();
    if (existingDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error: 'User profile already exists',
          errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-007-v03
    // [Intent] Check for duplicate team names (case-insensitive).
    // [Inbound Trigger] After existing doc check.
    // [Downstream Impact] Returns 409 if team name is taken.
    const allUsersSnapshot = await db.collection('users').get();
    const normalizedNewName = normalizedTeamName.toLowerCase();
    let teamNameExists = false;

    allUsersSnapshot.forEach((doc: any) => {
      const existingName = doc.data().teamName?.toLowerCase()?.trim();
      if (existingName === normalizedNewName) {
        teamNameExists = true;
      }
    });

    if (teamNameExists) {
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

    // GUID: API_AUTH_COMPLETE_OAUTH-008-v03
    // [Intent] Check if signups are enabled.
    // [Inbound Trigger] After team name validation.
    // [Downstream Impact] Returns 403 if disabled.
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
      console.warn('[Complete OAuth Profile] Could not check signup settings:', settingsError);
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-009-v03
    // [Intent] Create the Firestore user document and presence document.
    // [Inbound Trigger] After all validation passes.
    // [Downstream Impact] These documents enable the user to participate in the app.
    const newUser: Record<string, any> = {
      id: uid,
      email: normalizedEmail,
      teamName: normalizedTeamName,
      isAdmin: false,
      mustChangePin: false,
      badLoginAttempts: 0,
      emailVerified: authUser.emailVerified || false,
      providers: providers || authUser.providerData.map((p: any) => p.providerId),
      createdAt: FieldValue.serverTimestamp(),
    };

    if (photoUrl) {
      newUser.photoUrl = photoUrl;
    }

    await db.collection('users').doc(uid).set(newUser);

    await db.collection('presence').doc(uid).set({
      online: false,
      sessions: [],
    });

    // GUID: API_AUTH_COMPLETE_OAUTH-010-v03
    // [Intent] Add the new user to the global league.
    // [Inbound Trigger] After user and presence docs are created.
    // [Downstream Impact] Makes the user visible in global league standings.
    try {
      const globalLeagueRef = db.collection('leagues').doc(GLOBAL_LEAGUE_ID);
      await globalLeagueRef.update({
        memberUserIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (leagueError: any) {
      console.warn('[Complete OAuth Profile] Could not add user to global league:', leagueError.message);
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-011-v03
    // [Intent] Apply late-joiner handicap if the season has already started.
    // [Inbound Trigger] After global league enrolment.
    // [Downstream Impact] Creates a handicap score document if applicable.
    try {
      const scoresSnapshot = await db.collection('scores').get();
      if (!scoresSnapshot.empty) {
        const userTotals = new Map<string, number>();
        scoresSnapshot.forEach((scoreDoc: any) => {
          const scoreData = scoreDoc.data();
          if (scoreData.isAdjustment) return;
          const scoreUserId = scoreData.userId;
          const points = scoreData.totalPoints || 0;
          userTotals.set(scoreUserId, (userTotals.get(scoreUserId) || 0) + points);
        });

        if (userTotals.size > 0) {
          const minScore = Math.min(...Array.from(userTotals.values()));
          const handicapPoints = minScore - 5;

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
              reason: 'Season already in progress - starts 5 points behind last place',
              signupMethod: 'oauth',
            },
            timestamp: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (handicapError: any) {
      console.warn('[Complete OAuth Profile] Could not calculate late joiner handicap:', handicapError.message);
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-012-v03
    // [Intent] Send welcome email (fire-and-forget).
    // [Inbound Trigger] After all Firestore documents are created.
    // [Downstream Impact] If the email endpoint is down, the account is still created.
    try {
      const baseUrl = request.headers.get('origin') || 'https://prix6.win';
      await fetch(`${baseUrl}/api/send-welcome-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: normalizedEmail,
          teamName: normalizedTeamName,
          pin: '[oauth-user]',
        }),
      });
    } catch (emailError: any) {
      console.warn('[Complete OAuth Profile] Failed to send welcome email:', emailError.message);
    }

    // GUID: API_AUTH_COMPLETE_OAUTH-013-v03
    // [Intent] Log the successful OAuth registration.
    // [Inbound Trigger] After email dispatch.
    // [Downstream Impact] Creates an audit log entry for the registration event.
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'USER_REGISTERED',
      details: {
        email: normalizedEmail,
        teamName: normalizedTeamName,
        registeredAt: new Date().toISOString(),
        method: 'oauth',
        providers: providers || [],
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'Profile completed successfully!',
    });

  // GUID: API_AUTH_COMPLETE_OAUTH-014-v04
  // [Intent] Top-level error handler for unhandled exceptions.
  // [Inbound Trigger] Any unhandled exception in the POST handler.
  // [Downstream Impact] Logs error and returns 500 with correlation ID.
  } catch (error: any) {
    console.error(`[Complete OAuth Profile Error ${correlationId}]`, error);

    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/auth/complete-oauth-profile', action: 'POST', errorType: error.code || error.name || 'UnknownError' },
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
