import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';

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

    // Get the verification token document from secondary email tokens collection
    const tokenRef = db.collection('secondary_email_verification_tokens').doc(uid);
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

    // Check if token matches (constant-time comparison to prevent timing attacks)
    if (!crypto.timingSafeEqual(Buffer.from(tokenData.token), Buffer.from(token))) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if already used
    if (tokenData.used) {
      return NextResponse.json(
        { success: false, error: 'Secondary email already verified' },
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

    // Verify the user still has this secondary email set
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

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
    if (userData?.secondaryEmail !== tokenData.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Secondary email has changed. Please request a new verification.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Mark the user's secondary email as verified in Firestore
    // NOTE: We do NOT update Firebase Auth - secondary email is for communications only
    try {
      await userRef.update({
        secondaryEmailVerified: true,
      });
    } catch (userUpdateError: any) {
      await logError({
        correlationId,
        error: userUpdateError,
        context: {
          route: '/api/verify-secondary-email',
          action: 'update_user_document',
          userId: uid,
          additionalInfo: { step: 'firestore_user_update' },
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to update user record',
          errorCode: ERROR_CODES.FIRESTORE_WRITE_FAILED.code,
          correlationId,
        },
        { status: 500 }
      );
    }

    // Mark the token as used
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // Log the verification
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'secondary_email_verified',
      data: { secondaryEmail: tokenData.email, correlationId },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Secondary email verified successfully',
    });
  } catch (error: any) {
    console.error('Error verifying secondary email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/verify-secondary-email',
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
