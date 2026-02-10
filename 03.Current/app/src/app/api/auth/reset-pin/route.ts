// GUID: API_AUTH_RESET_PIN-000-v04
// [Intent] Server-side API route that handles PIN reset requests: validates the email, generates a new random 6-digit PIN, updates Firebase Auth, marks the user as mustChangePin, queues a reset email, and logs the action. Returns a generic success message regardless of whether the email exists to prevent enumeration attacks.
// [Inbound Trigger] POST request from the client-side PIN reset form.
// [Downstream Impact] Updates the user's password in Firebase Auth, sets mustChangePin=true on the Firestore user document, writes to the mail collection (consumed by the email sending service), writes to email_logs and audit_logs collections.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import crypto from 'crypto';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_AUTH_RESET_PIN-001-v03
// [Intent] Type contract for the expected JSON body of the PIN reset request.
// [Inbound Trigger] Used to type-assert the parsed request body in the POST handler.
// [Downstream Impact] Any change to this interface requires matching changes in the client-side PIN reset form submission logic.
interface ResetPinRequest {
  email: string;
}

// GUID: API_AUTH_RESET_PIN-002-v03
// [Intent] Main PIN reset POST handler. Validates the email, looks up the user in Firestore, generates a cryptographically random 6-digit PIN, updates Firebase Auth, flags the user for mandatory PIN change, queues a reset email, and writes audit records. Returns a deliberately ambiguous success message to prevent email enumeration.
// [Inbound Trigger] HTTP POST to /api/auth/reset-pin from the client-side forgot-PIN form.
// [Downstream Impact] On success: changes the user's Firebase Auth password, sets mustChangePin on the user document (forces PIN change on next login), queues an email in the mail collection. On failure: logs error with correlation ID. The ambiguous response message is intentional for security.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const data: ResetPinRequest = await request.json();
    const { email } = data;

    // GUID: API_AUTH_RESET_PIN-003-v03
    // [Intent] Validate that the email field is present in the request body.
    // [Inbound Trigger] Every PIN reset request passes through this check.
    // [Downstream Impact] Returns 400 early if email is missing, with correlation ID for tracing.
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

    // GUID: API_AUTH_RESET_PIN-004-v04
    // [Intent] Look up the user in Firestore by normalised email. If no user is found, introduce a constant-time delay before returning a generic success message to prevent timing-based email enumeration attacks.
    // [Inbound Trigger] Runs after email validation and normalisation.
    // [Downstream Impact] If user not found, waits ~500ms to match the timing of successful PIN reset operations, then returns with a fake success response. This prevents attackers from using response time to determine valid emails (fixes API-006 timing attack). If found, the user document and ID are used for all subsequent operations.
    // SECURITY: Constant-time response to prevent timing attacks (API-006 fix)
    const startTime = Date.now();
    const TARGET_MIN_DURATION = 500; // milliseconds - matches average successful PIN reset time

    // Find user by email in Firestore
    const usersQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      // Don't reveal if user exists - return success anyway
      // SECURITY: Add constant-time delay to prevent timing-based enumeration
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(0, TARGET_MIN_DURATION - elapsed);

      if (remainingDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingDelay));
      }

      return NextResponse.json({
        success: true,
        message: 'If an account exists with that email, a temporary PIN will be sent.',
      });
    }

    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;

    // GUID: API_AUTH_RESET_PIN-005-v04
    // [Intent] Generate a cryptographically secure random 6-digit PIN and update the user's password in Firebase Auth. Uses crypto.randomInt for uniform distribution across the 100000-999999 range.
    // [Inbound Trigger] Runs after the user is found in Firestore.
    // [Downstream Impact] Changes the user's Firebase Auth password immediately. If this fails, no email is sent and no Firestore flags are set (clean failure). The new PIN is included in the reset email sent later.
    // Generate a new 6-digit PIN
    const newPin = crypto.randomInt(100000, 1000000).toString();

    // Update user password in Firebase Auth
    try {
      await auth.updateUser(userId, { password: newPin });
    } catch (authError: any) {
      console.error(`[PIN Reset Error ${correlationId}] Failed to update Firebase Auth:`, authError);
      const traced = createTracedError(ERRORS.AUTH_PIN_RESET_FAILED, {
        correlationId,
        context: { route: '/api/auth/reset-pin', action: 'updateUser', email: normalizedEmail },
        cause: authError instanceof Error ? authError : undefined,
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: traced.definition.message, errorCode: traced.definition.code, correlationId: traced.correlationId },
        { status: 500 }
      );
    }

    // GUID: API_AUTH_RESET_PIN-006-v03
    // [Intent] Set the mustChangePin flag on the user's Firestore document so the application forces a PIN change on the user's next successful login.
    // [Inbound Trigger] Runs after the Firebase Auth password is successfully updated.
    // [Downstream Impact] The login flow and dashboard check this flag to redirect the user to a change-PIN screen. If this step fails silently, the user could continue using the temporary PIN indefinitely.
    // Mark user as needing to change PIN
    await userDoc.ref.update({
      mustChangePin: true,
    });

    // GUID: API_AUTH_RESET_PIN-007-v03
    // [Intent] Queue the PIN reset email by writing to the mail collection (consumed by the email sending service) and log the email to the email_logs collection for auditing and debugging.
    // [Inbound Trigger] Runs after mustChangePin is set on the user document.
    // [Downstream Impact] The mail collection document is picked up by the email sending Cloud Function or service. The email_logs entry provides a record for admin review. The email contains the temporary PIN in plaintext.
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

    // GUID: API_AUTH_RESET_PIN-008-v03
    // [Intent] Write an audit log entry recording that a PIN reset email was queued for this user, then return the generic success message.
    // [Inbound Trigger] Runs after the email is queued and logged.
    // [Downstream Impact] The audit log provides a permanent record for admin review and security investigations. The response message is deliberately ambiguous to prevent email enumeration.
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

  // GUID: API_AUTH_RESET_PIN-009-v04
  // [Intent] Top-level catch-all error handler for any unhandled exception during PIN reset. Logs the error to error_logs (with fallback to console if logging itself fails) and returns a generic 500 response with correlation ID for support tracing.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response allows support to trace the issue. If logTracedError fails, falls back to console.error to avoid masking the original error.
  } catch (error: any) {
    console.error('[Reset PIN Error]', error);

    try {
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
        correlationId,
        context: { route: '/api/auth/reset-pin', action: 'POST', userAgent: request.headers.get('user-agent') || undefined },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, db);
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
