import { NextRequest, NextResponse } from 'next/server';
import { RaceSchedule } from '@/lib/data';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface PredictionRequest {
  userId: string;
  teamId: string;
  teamName: string;
  raceId: string;
  raceName: string;
  predictions: string[];
}

export async function POST(request: NextRequest) {
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

    const data: PredictionRequest = await request.json();
    const { userId, teamId, teamName, raceId, raceName, predictions } = data;

    // SECURITY: Verify the userId in the request matches the authenticated user
    if (userId !== verifiedUser.uid) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Cannot submit predictions for another user' },
        { status: 403 }
      );
    }

    // Validate required fields
    if (!userId || !teamId || !teamName || !raceId || !raceName || !predictions) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate predictions array
    if (!Array.isArray(predictions) || predictions.length !== 6) {
      return NextResponse.json(
        { success: false, error: 'Predictions must be an array of 6 driver IDs' },
        { status: 400 }
      );
    }

    // SERVER-SIDE LOCKOUT ENFORCEMENT: Check if qualifying has started
    const race = RaceSchedule.find(r => r.name === raceName || r.name.replace(/\s+/g, '-') === raceId);
    if (race) {
      const qualifyingTime = new Date(race.qualifyingTime).getTime();
      if (Date.now() > qualifyingTime) {
        return NextResponse.json(
          { success: false, error: 'Pit lane is closed. Predictions cannot be submitted after qualifying starts.' },
          { status: 403 }
        );
      }
    }

    // SECURITY: Use atomic batch write to prevent partial failures
    const { db, FieldValue } = await getFirebaseAdmin();
    const batch = db.batch();

    const predictionId = `${teamId}_${raceId}`;
    const predictionRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);
    const auditRef = db.collection('audit_logs').doc();

    // 1. Write prediction to user's subcollection (single source of truth)
    batch.set(predictionRef, {
      id: predictionId,
      userId,
      teamId,
      teamName,
      raceId,
      raceName,
      predictions,
      submittedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. Log audit event
    batch.set(auditRef, {
      userId,
      action: 'prediction_submitted',
      details: {
        teamName,
        raceName,
        raceId,
        predictions,
        submittedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all writes atomically
    await batch.commit();

    return NextResponse.json({ success: true, message: 'Prediction submitted successfully' });
  } catch (error: any) {
    const correlationId = generateCorrelationId();
    const data: PredictionRequest = await request.clone().json().catch(() => ({}));

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/submit-prediction',
        action: 'POST',
        userId: data.userId,
        requestData: { teamName: data.teamName, raceId: data.raceId, raceName: data.raceName },
        userAgent: request.headers.get('user-agent') || undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}
