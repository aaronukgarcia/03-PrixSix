import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// Weak PINs that should be rejected
const WEAK_PINS = [
  '123456', '654321', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999', '000000',
  '123123', '121212', '112233', '001122', '102030', '112211',
];

const GLOBAL_LEAGUE_ID = 'global';

interface SignupRequest {
  email: string;
  teamName: string;
  pin: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const data: SignupRequest = await request.json();
    const { email, teamName, pin } = data;

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

    // Check if team name already exists (case-insensitive)
    const allUsersSnapshot = await db.collection('users').get();
    const normalizedNewName = normalizedTeamName.toLowerCase();
    let teamNameExists = false;

    allUsersSnapshot.forEach(doc => {
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

      await logError({
        correlationId,
        error: authError,
        context: {
          route: '/api/auth/signup',
          action: 'create_auth_user',
          requestData: { email: normalizedEmail, teamName: normalizedTeamName },
          additionalInfo: {
            errorCode: ERROR_CODES.AUTH_USER_NOT_FOUND.code,
            authErrorCode: authError.code,
          },
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create account. Please try again.',
          errorCode: 'PX-1008',
          correlationId,
        },
        { status: 500 }
      );
    }

    const uid = userRecord.uid;

    // Create Firestore user document
    const newUser = {
      id: uid,
      email: normalizedEmail,
      teamName: normalizedTeamName,
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

    // Add user to global league
    try {
      const globalLeagueRef = db.collection('leagues').doc(GLOBAL_LEAGUE_ID);
      await globalLeagueRef.update({
        memberUserIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (leagueError: any) {
      console.warn('[Signup] Could not add user to global league:', leagueError.message);
      // Don't fail signup if global league doesn't exist
    }

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

    // Send welcome email via API
    try {
      const baseUrl = request.headers.get('origin') || 'https://prix6.win';
      await fetch(`${baseUrl}/api/send-welcome-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: normalizedEmail,
          teamName: normalizedTeamName,
          pin: '[user-created]',
        }),
      });
    } catch (emailError: any) {
      console.warn('[Signup] Failed to send welcome email:', emailError.message);
    }

    // Send verification email
    try {
      const baseUrl = request.headers.get('origin') || 'https://prix6.win';
      await fetch(`${baseUrl}/api/send-verification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          email: normalizedEmail,
          teamName: normalizedTeamName,
        }),
      });
    } catch (verifyError: any) {
      console.warn('[Signup] Failed to send verification email:', verifyError.message);
    }

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
      customToken,
      uid,
    });

  } catch (error: any) {
    console.error(`[Signup Error ${correlationId}]`, error);

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/auth/signup',
        action: 'POST',
        additionalInfo: {
          errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
          errorType: error.code || error.name || 'UnknownError',
        },
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred during registration. Please try again.',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
