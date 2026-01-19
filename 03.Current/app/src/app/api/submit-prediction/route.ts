import { NextRequest, NextResponse } from 'next/server';
import { RaceSchedule } from '@/lib/data';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';

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
    const data: PredictionRequest = await request.json();
    const { userId, teamId, teamName, raceId, raceName, predictions } = data;

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

    // Write prediction to Firestore
    const { db, FieldValue } = await getFirebaseAdmin();
    const predictionId = `${teamId}_${raceId}`;
    const predictionRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);

    await predictionRef.set({
      id: predictionId,
      userId,
      teamId,
      teamName,
      raceId,
      raceName,
      predictions,
      submissionTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Write to public prediction_submissions for audit
    await db.collection('prediction_submissions').add({
      userId,
      teamName,
      raceName,
      raceId,
      predictions: {
        P1: predictions[0],
        P2: predictions[1],
        P3: predictions[2],
        P4: predictions[3],
        P5: predictions[4],
        P6: predictions[5],
      },
      submittedAt: FieldValue.serverTimestamp(),
    });

    // Log audit event
    await db.collection('audit_logs').add({
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
