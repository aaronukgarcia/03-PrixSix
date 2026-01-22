import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface DeleteScoresRequest {
  raceId: string;
  raceName: string;
}

/**
 * Normalize raceId to match the format used by scores.
 * Scores are stored with lowercase raceId, so we must lowercase here.
 */
function normalizeRaceId(raceId: string): string {
  let baseName = raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '');
  return baseName.replace(/\s+/g, '-').toLowerCase();
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify the Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorised: Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // SECURITY: Verify the user is an admin
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      await logError({
        correlationId,
        error: 'Forbidden: Admin access required',
        context: {
          route: '/api/delete-scores',
          action: 'POST',
          userId: verifiedUser.uid,
          additionalInfo: { reason: 'non_admin_attempt' },
        },
      });
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const data: DeleteScoresRequest = await request.json();
    const { raceId, raceName } = data;

    if (!raceId) {
      return NextResponse.json(
        { success: false, error: 'Missing raceId' },
        { status: 400 }
      );
    }

    const normalizedRaceId = normalizeRaceId(raceId);

    // Find all scores for this race
    const scoresQuery = await db.collection('scores')
      .where('raceId', '==', normalizedRaceId)
      .get();

    // Create batch delete
    const batch = db.batch();
    let deletedCount = 0;

    scoresQuery.forEach((scoreDoc) => {
      batch.delete(scoreDoc.ref);
      deletedCount++;
    });

    // Delete the race result document
    const resultDocId = raceId;
    const resultDocRef = db.collection('race_results').doc(resultDocId);
    batch.delete(resultDocRef);

    // Log audit event
    const auditRef = db.collection('audit_logs').doc();
    batch.set(auditRef, {
      userId: verifiedUser.uid,
      action: 'RACE_RESULTS_DELETED',
      details: {
        raceId: resultDocId,
        raceName: raceName || raceId,
        scoresDeleted: deletedCount,
        deletedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all deletes atomically
    await batch.commit();

    console.log(`[DeleteScores] Deleted ${deletedCount} scores for race ${raceId}`);

    return NextResponse.json({
      success: true,
      scoresDeleted: deletedCount,
    });

  } catch (error: any) {
    let requestData = {};
    try {
      requestData = await request.clone().json();
    } catch {}

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/delete-scores',
        action: 'POST',
        requestData,
        userAgent: request.headers.get('user-agent') || undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}
