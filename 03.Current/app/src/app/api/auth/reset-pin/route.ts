import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import crypto from 'crypto';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface ResetPinRequest {
  email: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const data: ResetPinRequest = await request.json();
    const { email } = data;

    // Validate required fields
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required', correlationId },
        { status: 400 }
      );
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // Find user by email in Firestore
    const usersQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      // Don't reveal if user exists - return success anyway
      // This prevents email enumeration attacks
      return NextResponse.json({
        success: true,
        message: 'If an account exists with that email, a temporary PIN will be sent.',
      });
    }

    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;

    // Generate a new 6-digit PIN
    const newPin = crypto.randomInt(100000, 1000000).toString();

    // Update user password in Firebase Auth
    try {
      await auth.updateUser(userId, { password: newPin });
    } catch (authError: any) {
      console.error(`[PIN Reset Error ${correlationId}] Failed to update Firebase Auth:`, authError);
      await logError({
        correlationId,
        error: authError,
        context: {
          route: '/api/auth/reset-pin',
          action: 'updateUser',
          additionalInfo: { email: normalizedEmail },
        },
      });
      return NextResponse.json(
        { success: false, error: 'Failed to reset PIN. Please try again.', correlationId },
        { status: 500 }
      );
    }

    // Mark user as needing to change PIN
    await userDoc.ref.update({
      mustChangePin: true,
    });

    // Queue the email
    const mailHtml = `Hello,<br><br>A PIN reset was requested for your Prix Six account.<br><br>Your temporary PIN is: <strong>${newPin}</strong><br><br>You will be required to change this PIN after logging in.<br><br>If you did not request this, please contact support immediately.`;
    const mailSubject = "Your Prix Six PIN has been reset";

    await db.collection('mail').add({
      to: normalizedEmail,
      message: { subject: mailSubject, html: mailHtml },
    });

    // Log the email
    await db.collection('email_logs').add({
      to: normalizedEmail,
      subject: mailSubject,
      html: mailHtml,
      status: 'queued',
      timestamp: FieldValue.serverTimestamp(),
    });

    // Audit log
    await db.collection('audit_logs').add({
      userId,
      action: 'reset_pin_email_queued',
      details: { email: normalizedEmail, method: 'server_api' },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'If an account exists with that email, a temporary PIN will be sent.',
    });

  } catch (error: any) {
    console.error('[Reset PIN Error]', error);

    try {
      await logError({
        correlationId,
        error,
        context: {
          route: '/api/auth/reset-pin',
          action: 'POST',
          userAgent: request.headers.get('user-agent') || undefined,
        },
      });
    } catch (logErr) {
      console.error('[Reset PIN Error - Logging failed]', logErr);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred during PIN reset',
        correlationId,
      },
      { status: 500 }
    );
  }
}
