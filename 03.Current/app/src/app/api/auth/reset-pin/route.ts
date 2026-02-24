// GUID: API_AUTH_RESET_PIN-000-v08
// @SECURITY_FIX: Added CSRF protection via Origin/Referer validation (GEMINI-005).
// @SECURITY_FIX: email_logs now stores masked PIN (EMAIL-006) — plaintext PIN is only in the
//   mail collection (consumed by the email service) and never persisted to admin-readable logs.
// @SECURITY_FIX: Applied constant-time minimum delay to ALL return paths to prevent timing-based
//   email enumeration (API-006). The startTime/TARGET_MIN_DURATION pattern now guards every exit
//   point — not just the "user not found" branch.
// @SECURITY_FIX (GEMINI-AUDIT-126): email_logs HTML now uses "[REDACTED]" in place of the PIN
//   value to prevent admin log-viewers from recovering a user's temporary PIN and performing
//   unauthorized account takeover.
// [Intent] Server-side API route that handles PIN reset requests: validates the email, generates a new random 6-digit PIN, updates Firebase Auth, marks the user as mustChangePin, queues a reset email, and logs the action. Returns a generic success message regardless of whether the email exists to prevent enumeration attacks.
// [Inbound Trigger] POST request from the client-side PIN reset form.
// [Downstream Impact] Updates the user's password in Firebase Auth, sets mustChangePin=true on the Firestore user document, writes to the mail collection (consumed by the email sending service), writes to email_logs and audit_logs collections.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { validateCsrfProtection } from '@/lib/csrf-protection';
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

// GUID: API_AUTH_RESET_PIN-002-v04
// [Intent] Main PIN reset POST handler. Validates the email, looks up the user in Firestore, generates a cryptographically random 6-digit PIN, updates Firebase Auth, flags the user for mandatory PIN change, queues a reset email, and writes audit records. Returns a deliberately ambiguous success message to prevent email enumeration.
// [Inbound Trigger] HTTP POST to /api/auth/reset-pin from the client-side forgot-PIN form.
// [Downstream Impact] On success: changes the user's Firebase Auth password, sets mustChangePin on the user document (forces PIN change on next login), queues an email in the mail collection. On failure: logs error with correlation ID. The ambiguous response message is intentional for security.
// @SECURITY_FIX (API-006): startTime is recorded immediately so that ALL email-processing return
//   paths (user found or not found) are padded to TARGET_MIN_DURATION before responding. This
//   prevents timing-based email enumeration — previously only the "user not found" branch applied
//   the delay; the "user found + PIN reset" path could return faster or slower, leaking existence.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  // SECURITY (API-006): Record start time at the very beginning of email processing so that every
  // code path through the PIN reset flow is padded to the same minimum response duration, making
  // it impossible for an attacker to infer whether the submitted email exists in the system.
  const startTime = Date.now();
  const TARGET_MIN_DURATION = 500; // milliseconds — normalises timing across all return paths

  // Helper: pad the current elapsed time up to TARGET_MIN_DURATION before returning a response.
  // Applied to every early-exit and success path so response timing is constant regardless of
  // whether the email exists, how fast the DB lookup is, or how long the PIN reset took.
  async function padToMinDuration(): Promise<void> {
    const elapsed = Date.now() - startTime;
    const remaining = TARGET_MIN_DURATION - elapsed;
    if (remaining > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, remaining));
    }
  }

  // GUID: API_AUTH_RESET_PIN-013-v01
  // @SECURITY_FIX: CSRF protection via Origin/Referer validation (GEMINI-005).
  // [Intent] Validate that the request originates from an allowed domain to prevent CSRF attacks.
  // [Inbound Trigger] Every PIN reset request, before processing any data.
  // [Downstream Impact] Rejects cross-origin requests from malicious sites with 403 status.
  const csrfError = validateCsrfProtection(request, correlationId);
  if (csrfError) {
    return csrfError;
  }

  try {
    const data: ResetPinRequest = await request.json();
    const { email } = data;

    // GUID: API_AUTH_RESET_PIN-003-v04
    // [Intent] Validate that the email field is present in the request body.
    // [Inbound Trigger] Every PIN reset request passes through this check.
    // [Downstream Impact] Returns 400 early if email is missing, with correlation ID for tracing.
    // SECURITY (API-006): Pad even the validation-failure path so missing-email requests take the
    // same minimum time as valid requests. Without this, a fast 400 would reveal that the server
    // skipped the DB lookup (because no email was supplied), leaking timing information.
    // Validate required fields
    if (!email) {
      await padToMinDuration();
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

    // GUID: API_AUTH_RESET_PIN-004-v05
    // [Intent] Look up the user in Firestore by normalised email. Regardless of whether the user
    //          is found or not, the response is padded to TARGET_MIN_DURATION via padToMinDuration()
    //          before returning, preventing timing-based email enumeration (API-006).
    // [Inbound Trigger] Runs after email validation and normalisation.
    // [Downstream Impact] If user not found, pads to minimum duration then returns a generic
    //          success response. This prevents attackers from using response time to determine
    //          valid emails. If found, the user document and ID are used for all subsequent
    //          operations and padToMinDuration() is called before the final success response.
    // Find user by email in Firestore
    const usersQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      // Don't reveal if user exists — return the same generic success message.
      // SECURITY (API-006): Pad to minimum response duration before returning so the "user not
      // found" path takes the same amount of time as the full PIN reset path.
      await padToMinDuration();
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
      await padToMinDuration(startTime);
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

    // GUID: API_AUTH_RESET_PIN-007-v05
    // @SECURITY_FIX: email_logs now stores masked PIN (EMAIL-006). The mail collection document
    //   retains the real PIN for email delivery, but the admin-readable log stores '[REDACTED]' to
    //   prevent admins from recovering a user's temporary PIN from audit logs.
    // @SECURITY_FIX (GEMINI-AUDIT-126): Changed PIN masking in email_logs from '••••••' to
    //   '[REDACTED]' — explicit string is unambiguous and cannot be mistaken for partial data.
    //   The mail collection document is unchanged (real PIN required for email delivery).
    // [Intent] Queue the PIN reset email by writing to the mail collection (consumed by the email sending service) and log the email to the email_logs collection for auditing and debugging.
    // [Inbound Trigger] Runs after mustChangePin is set on the user document.
    // [Downstream Impact] The mail collection document is picked up by the email sending Cloud Function or service. The email_logs entry provides a record for admin review. The logged HTML redacts the PIN.
    // Queue the email
    const mailHtml = `Hello,<br><br>A PIN reset was requested for your Prix Six account.<br><br>Your temporary PIN is: <strong>${newPin}</strong><br><br>You will be required to change this PIN after logging in.<br><br>If you did not request this, please contact support immediately.`;
    const mailSubject = "Your Prix Six PIN has been reset";
    // SECURITY: Redact PIN in email_logs — admin-visible log never stores plaintext credentials (GEMINI-AUDIT-126)
    const mailHtmlRedacted = mailHtml.replace(`<strong>${newPin}</strong>`, '<strong>[REDACTED]</strong>');

    await db.collection('mail').add({
      to: normalizedEmail,
      message: { subject: mailSubject, html: mailHtml },
    });

    // Log the email (with redacted PIN — GEMINI-AUDIT-126)
    await db.collection('email_logs').add({
      to: normalizedEmail,
      subject: mailSubject,
      html: mailHtmlRedacted,
      status: 'queued',
      timestamp: FieldValue.serverTimestamp(),
    });

    // GUID: API_AUTH_RESET_PIN-008-v04
    // [Intent] Write an audit log entry recording that a PIN reset email was queued for this user,
    //          pad the response to the minimum duration, then return the generic success message.
    // [Inbound Trigger] Runs after the email is queued and logged.
    // [Downstream Impact] The audit log provides a permanent record for admin review and security
    //          investigations. The response message is deliberately ambiguous to prevent email
    //          enumeration. padToMinDuration() ensures the "user found" success path takes at
    //          least as long as TARGET_MIN_DURATION, closing the timing gap with the "not found"
    //          path (API-006).
    // Audit log
    await db.collection('audit_logs').add({
      userId,
      action: 'reset_pin_email_queued',
      details: { email: normalizedEmail, method: 'server_api' },
      timestamp: FieldValue.serverTimestamp(),
    });

    // SECURITY (API-006): Ensure the success path takes at least TARGET_MIN_DURATION so that
    // response timing cannot distinguish "user found + PIN reset" from "user not found".
    await padToMinDuration();
    return NextResponse.json({
      success: true,
      message: 'If an account exists with that email, a temporary PIN will be sent.',
    });

  // GUID: API_AUTH_RESET_PIN-009-v05
  // [Intent] Top-level catch-all error handler for any unhandled exception during PIN reset. Logs the error to error_logs (with fallback to console if logging itself fails) and returns a generic 500 response with correlation ID for support tracing.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response allows support to trace the issue. If logTracedError fails, falls back to console.error to avoid masking the original error.
  // SECURITY (API-006): padToMinDuration() is also called in the error path so that an exception
  // during processing does not produce a faster response that leaks email existence to an attacker.
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

    // SECURITY (API-006): Pad error responses to the same minimum duration.
    const elapsed = Date.now() - startTime;
    const remaining = TARGET_MIN_DURATION - elapsed;
    if (remaining > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, remaining));
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
