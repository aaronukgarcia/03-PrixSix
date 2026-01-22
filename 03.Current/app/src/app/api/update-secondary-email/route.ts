import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { uid, secondaryEmail } = body;

    if (!uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: uid',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // Get the user document
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

    // Handle removal of secondary email
    if (secondaryEmail === null || secondaryEmail === '') {
      await userRef.update({
        secondaryEmail: FieldValue.delete(),
        secondaryEmailVerified: FieldValue.delete(),
      });

      // Log the removal
      await db.collection('audit_logs').add({
        userId: uid,
        action: 'secondary_email_removed',
        data: { previousEmail: userData?.secondaryEmail, correlationId },
        timestamp: Timestamp.now(),
      });

      return NextResponse.json({
        success: true,
        message: 'Secondary email removed',
      });
    }

    // Validate email format
    if (!EMAIL_REGEX.test(secondaryEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email format',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if secondary email is same as primary
    if (userData?.email?.toLowerCase() === secondaryEmail.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_SAME.message,
          errorCode: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_SAME.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if email is already used as another user's primary email
    const primaryEmailCheck = await db
      .collection('users')
      .where('email', '==', secondaryEmail.toLowerCase())
      .limit(1)
      .get();

    if (!primaryEmailCheck.empty) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_IN_USE.message,
          errorCode: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_IN_USE.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Update secondary email and reset verification status
    await userRef.update({
      secondaryEmail: secondaryEmail.toLowerCase(),
      secondaryEmailVerified: false,
    });

    // Log the update
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'secondary_email_updated',
      data: {
        previousEmail: userData?.secondaryEmail || null,
        newEmail: secondaryEmail.toLowerCase(),
        correlationId,
      },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Secondary email updated. Please verify your new email address.',
    });
  } catch (error: any) {
    console.error('Error updating secondary email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/update-secondary-email',
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
