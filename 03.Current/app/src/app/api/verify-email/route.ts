import { NextRequest, NextResponse } from 'next/server';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin
if (!getApps().length) {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    initializeApp({
      credential: cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } else {
    initializeApp({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

const adminDb = getFirestore();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, uid } = body;

    if (!token || !uid) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: token and uid' },
        { status: 400 }
      );
    }

    // Get the verification token document
    const tokenRef = adminDb.collection('email_verification_tokens').doc(uid);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    const tokenData = tokenDoc.data();

    if (!tokenData) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if token matches
    if (tokenData.token !== token) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if already used
    if (tokenData.used) {
      return NextResponse.json(
        { success: false, error: 'Email already verified' },
        { status: 400 }
      );
    }

    // Check if expired
    const now = Timestamp.now();
    if (tokenData.expiresAt && tokenData.expiresAt.toMillis() < now.toMillis()) {
      return NextResponse.json(
        { success: false, error: 'Token expired' },
        { status: 400 }
      );
    }

    // Mark the user's email as verified in Firestore
    const userRef = adminDb.collection('users').doc(uid);
    await userRef.update({
      emailVerified: true,
    });

    // Also mark as verified in Firebase Auth
    const auth = getAuth();
    await auth.updateUser(uid, { emailVerified: true });

    // Mark the token as used
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // Log the verification
    await adminDb.collection('audit_logs').add({
      userId: uid,
      action: 'email_verified_custom',
      data: { email: tokenData.email },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error: any) {
    console.error('Error verifying email:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
