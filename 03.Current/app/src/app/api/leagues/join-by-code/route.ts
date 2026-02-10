/**
 * POST /api/leagues/join-by-code
 *
 * GUID: API_LEAGUE_JOIN-001-v03
 * [Intent] Server-side API for joining leagues by invite code. Validates code,
 *          checks league capacity, and atomically adds user to league. Resolves
 *          FIRESTORE-003 by removing need for client-side inviteCode visibility.
 * [Inbound Trigger] User submits invite code from "Join League" UI.
 * [Downstream Impact] Adds user to league memberUserIds array, logs audit event.
 *                     Prevents unauthorized league access by validating server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Maximum leagues per user (from lib/types/league.ts)
const MAX_LEAGUES_PER_USER = 5;

interface JoinByCodeRequest {
  inviteCode: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId('league_join');

  try {
    // 1. Verify Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const userId = verifiedUser.uid;
    const body: JoinByCodeRequest = await request.json();
    const { inviteCode } = body;

    // 2. Validate invite code format
    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid invite code format' },
        { status: 400 }
      );
    }

    // Normalize invite code (uppercase, trim)
    const normalizedCode = inviteCode.trim().toUpperCase();

    if (normalizedCode.length !== 6) {
      return NextResponse.json(
        { success: false, error: 'Invite code must be 6 characters' },
        { status: 400 }
      );
    }

    // 3. Look up league by invite code (server-side via Admin SDK)
    const { db, FieldValue } = await getFirebaseAdmin();

    const leaguesSnapshot = await db.collection('leagues')
      .where('inviteCode', '==', normalizedCode)
      .limit(1)
      .get();

    if (leaguesSnapshot.empty) {
      return NextResponse.json(
        { success: false, error: 'Invalid invite code. League not found.' },
        { status: 404 }
      );
    }

    const leagueDoc = leaguesSnapshot.docs[0];
    const leagueData = leagueDoc.data();
    const leagueId = leagueDoc.id;

    // 4. Check if user is already a member
    const memberUserIds = leagueData.memberUserIds || [];
    if (memberUserIds.includes(userId)) {
      return NextResponse.json(
        { success: false, error: 'You are already a member of this league' },
        { status: 409 }
      );
    }

    // 5. Check if league is the global league (cannot join via code)
    if (leagueData.isGlobal === true) {
      return NextResponse.json(
        { success: false, error: 'Cannot join the global league with an invite code' },
        { status: 403 }
      );
    }

    // 6. Check if user has reached max leagues limit
    const userLeaguesSnapshot = await db.collection('leagues')
      .where('memberUserIds', 'array-contains', userId)
      .get();

    if (userLeaguesSnapshot.size >= MAX_LEAGUES_PER_USER) {
      return NextResponse.json(
        {
          success: false,
          error: `You have reached the maximum of ${MAX_LEAGUES_PER_USER} leagues. Please leave a league before joining another.`
        },
        { status: 403 }
      );
    }

    // 7. Atomically add user to league and log audit event
    const batch = db.batch();

    // Update league document
    const leagueRef = db.collection('leagues').doc(leagueId);
    batch.update(leagueRef, {
      memberUserIds: FieldValue.arrayUnion(userId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log audit event
    const auditRef = db.collection('audit_logs').doc();
    batch.set(auditRef, {
      userId,
      action: 'LEAGUE_JOINED',
      details: {
        leagueId,
        leagueName: leagueData.name,
        inviteCode: normalizedCode,
        joinedAt: new Date().toISOString(),
      },
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit atomic batch
    await batch.commit();

    // 8. Return success with league details
    return NextResponse.json({
      success: true,
      message: `Successfully joined ${leagueData.name}`,
      league: {
        id: leagueId,
        name: leagueData.name,
        description: leagueData.description,
        memberCount: memberUserIds.length + 1,
      },
      correlationId,
    });

  } catch (error: any) {
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/leagues/join-by-code', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        correlationId: traced.correlationId
      },
      { status: 500 }
    );
  }
}
