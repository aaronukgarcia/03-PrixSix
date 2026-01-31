// GUID: API_ADD_SECONDARY_TEAM-000-v03
// [Intent] API route that allows an authenticated user to create a secondary team for the fantasy league. Enforces uniqueness, applies late-joiner handicap if the season has started, and registers the team in the global league.
// [Inbound Trigger] User creates a secondary team from the profile/team management page (POST request with desired team name).
// [Downstream Impact] Updates the users collection with secondaryTeamName, adds to global league memberUserIds, optionally creates a late-joiner handicap score. Predictions and scoring logic use the "-secondary" teamId suffix to distinguish secondary teams.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const GLOBAL_LEAGUE_ID = 'global';

// GUID: API_ADD_SECONDARY_TEAM-001-v03
// [Intent] Defines the shape of the incoming secondary team creation request, containing only the desired team name.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] The teamName is validated, normalised, and stored in the user document. Changes here require matching changes in the team creation form.
interface AddSecondaryTeamRequest {
  teamName: string;
}

// GUID: API_ADD_SECONDARY_TEAM-002-v03
// [Intent] Main POST handler that authenticates the user, validates the team name, checks for duplicates, creates the secondary team record, registers it in the global league, applies a late-joiner handicap if applicable, and logs audit events.
// [Inbound Trigger] HTTP POST from the team management page when a user requests a secondary team.
// [Downstream Impact] Writes to users (secondaryTeamName field), leagues (memberUserIds), scores (late-joiner handicap), and audit_logs collections. The secondary teamId format "{uid}-secondary" is used by prediction submission and scoring throughout the application.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_ADD_SECONDARY_TEAM-003-v03
    // [Intent] Authenticates the request by extracting and verifying the Firebase Auth bearer token from the Authorization header.
    // [Inbound Trigger] Every POST request to this endpoint.
    // [Downstream Impact] Blocks unauthenticated requests with a 401 response using ERROR_CODES.AUTH_INVALID_TOKEN.
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

    // GUID: API_ADD_SECONDARY_TEAM-004-v03
    // [Intent] Parses the request body and validates that the team name meets the minimum length requirement (3 characters).
    // [Inbound Trigger] After successful auth verification.
    // [Downstream Impact] Rejects invalid team names with a 400 response. The normalised (trimmed) team name is used for all subsequent operations.
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

    // GUID: API_ADD_SECONDARY_TEAM-005-v03
    // [Intent] Checks that the user exists and does not already have a secondary team. Prevents duplicate secondary team creation.
    // [Inbound Trigger] After team name validation.
    // [Downstream Impact] Returns 404 if user not found, 409 if secondary team already exists. Ensures each user can have at most one secondary team.
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

    // GUID: API_ADD_SECONDARY_TEAM-006-v03
    // [Intent] Case-insensitive uniqueness check across all existing primary and secondary team names to prevent duplicate team names in the league.
    // [Inbound Trigger] After confirming the user does not already have a secondary team.
    // [Downstream Impact] Returns 409 if the name is taken. Loads all user documents for the check, which is acceptable given the small user base (~20 players).
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

    // GUID: API_ADD_SECONDARY_TEAM-007-v03
    // [Intent] Writes the secondary team name to the user document and adds the secondary team ID to the global league's member list.
    // [Inbound Trigger] After all validation and uniqueness checks pass.
    // [Downstream Impact] The secondaryTeamName field on the user document is read by scoring (API_CALCULATE_SCORES-009) to build the user-to-team mapping. The global league membership enables the team to appear in standings.
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

    // GUID: API_ADD_SECONDARY_TEAM-008-v03
    // [Intent] Late-joiner handicap: if the season has already started (scores exist), the new secondary team starts 5 points behind the last-place team. This prevents new teams from having an unfair advantage by joining with zero points mid-season.
    // [Inbound Trigger] After the secondary team is registered, only if the scores collection is non-empty.
    // [Downstream Impact] Creates a synthetic score document (isAdjustment: true) in the scores collection. The scoring engine skips adjustment scores when recalculating base standings to avoid circular references. The audit log records the handicap calculation.
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

    // GUID: API_ADD_SECONDARY_TEAM-009-v03
    // [Intent] Logs the successful secondary team creation in the audit trail and returns a success response with the new team name and ID.
    // [Inbound Trigger] After all writes (user doc, league, handicap) complete.
    // [Downstream Impact] The response is consumed by the frontend to update the UI. The audit log provides an admin-visible record of team creation.
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

  // GUID: API_ADD_SECONDARY_TEAM-010-v04
  // [Intent] Top-level error handler that catches any unhandled exception during secondary team creation, logs it with a correlation ID, and returns a 500 response with the correlation ID for user-reportable error tracing.
  // [Inbound Trigger] Any uncaught exception within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection via logTracedError. The correlation ID and error code in the response enable support to trace the specific failure.
  } catch (error: any) {
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/add-secondary-team', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

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
