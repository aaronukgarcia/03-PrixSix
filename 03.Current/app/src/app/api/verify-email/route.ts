import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { token, uid } = body;

    if (!token || !uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: token and uid',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { db } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');

    // Get the verification token document
    const tokenRef = db.collection('email_verification_tokens').doc(uid);
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
    const userRef = db.collection('users').doc(uid);
    try {
      await userRef.update({
        emailVerified: true,
      });
    } catch (userUpdateError: any) {
      await logError({
        correlationId,
        error: userUpdateError,
        context: {
          route: '/api/verify-email',
          action: 'update_user_document',
          userId: uid,
          additionalInfo: { step: 'firestore_user_update' },
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to update user record',
          errorCode: ERROR_CODES.FIRESTORE_WRITE_ERROR.code,
          correlationId,
        },
        { status: 500 }
      );
    }

    // Also mark as verified in Firebase Auth
    try {
      const auth = getAuth();
      await auth.updateUser(uid, { emailVerified: true });
    } catch (authUpdateError: any) {
      await logError({
        correlationId,
        error: authUpdateError,
        context: {
          route: '/api/verify-email',
          action: 'update_auth_user',
          userId: uid,
          additionalInfo: { step: 'firebase_auth_update' },
        },
      });
      // Don't fail completely - Firestore was updated, just log the auth error
      console.warn('[Verify Email] Firebase Auth update failed, but Firestore was updated:', authUpdateError.message);
    }

    // Mark the token as used
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // Log the verification
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'email_verified_custom',
      data: { email: tokenData.email, correlationId },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error: any) {
    console.error('Error verifying email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/verify-email',
        action: 'POST',
        additionalInfo: { errorType: error.code || error.name || 'UnknownError' },
      },
    });
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
