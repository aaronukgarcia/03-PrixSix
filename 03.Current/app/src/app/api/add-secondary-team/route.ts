import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const GLOBAL_LEAGUE_ID = 'global';

interface AddSecondaryTeamRequest {
  teamName: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // Verify authentication
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.AUTH_INVALID_TOKEN.message,
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    const idToken = authHeader.substring(7);
    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // Verify the token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.AUTH_INVALID_TOKEN.message,
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    const uid = decodedToken.uid;

    // Parse request body
    const data: AddSecondaryTeamRequest = await request.json();
    const { teamName } = data;

    // Validate team name
    if (!teamName || teamName.trim().length < 3) {
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

    const normalizedTeamName = teamName.trim();

    // Check if user already has a secondary team
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
          errorCode: ERROR_CODES.AUTH_USER_NOT_FOUND.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    if (userData?.secondaryTeamName) {
      return NextResponse.json(
        {
          success: false,
          error: 'You already have a secondary team',
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
      const data = doc.data();
      const existingName = data.teamName?.toLowerCase()?.trim();
      const existingSecondary = data.secondaryTeamName?.toLowerCase()?.trim();
      if (existingName === normalizedNewName || existingSecondary === normalizedNewName) {
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

    const secondaryTeamId = `${uid}-secondary`;

    // Update user document with secondary team name
    await db.collection('users').doc(uid).update({
      secondaryTeamName: normalizedTeamName,
    });

    // Add secondary team to global league
    try {
      const globalLeagueRef = db.collection('leagues').doc(GLOBAL_LEAGUE_ID);
      await globalLeagueRef.update({
        memberUserIds: FieldValue.arrayUnion(secondaryTeamId),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (leagueError: any) {
      console.warn('[AddSecondaryTeam] Could not add to global league:', leagueError.message);
    }

    // LATE JOINER RULE: If season has started, secondary team starts 5 points behind last place
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

          // Create a handicap score document - this represents starting points
          await db.collection('scores').doc(`late-joiner-handicap_${secondaryTeamId}`).set({
            userId: secondaryTeamId,
            raceId: 'late-joiner-handicap',
            raceName: 'Late Joiner Handicap',
            totalPoints: handicapPoints,
            breakdown: `Late joiner starting points: ${minScore} (last place) - 5 = ${handicapPoints}`,
            calculatedAt: FieldValue.serverTimestamp(),
            isAdjustment: true,
          });

          await db.collection('audit_logs').add({
            userId: uid,
            action: 'LATE_JOINER_HANDICAP_SECONDARY',
            details: {
              secondaryTeamId,
              teamName: normalizedTeamName,
              minScore,
              handicapPoints,
              reason: 'Secondary team added after season started'
            },
            timestamp: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (handicapError: any) {
      console.warn('[AddSecondaryTeam] Could not calculate late joiner handicap:', handicapError.message);
    }

    // Log successful addition
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'SECONDARY_TEAM_ADDED',
      details: {
        teamName: normalizedTeamName,
        secondaryTeamId,
        addedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'Secondary team created successfully!',
      teamName: normalizedTeamName,
      secondaryTeamId,
    });

  } catch (error: any) {
    console.error(`[AddSecondaryTeam Error ${correlationId}]`, error);

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/add-secondary-team',
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
        error: 'An error occurred. Please try again.',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
