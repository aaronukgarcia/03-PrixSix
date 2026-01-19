import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { RaceSchedule } from '@/lib/data';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const adminDb = getFirestore();

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
    const predictionId = `${teamId}_${raceId}`;
    const predictionRef = adminDb.collection('users').doc(userId).collection('predictions').doc(predictionId);

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
    await adminDb.collection('prediction_submissions').add({
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
    await adminDb.collection('audit_logs').add({
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
    console.error('Error submitting prediction:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
