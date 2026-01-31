// GUID: API_SEND_WELCOME_EMAIL-000-v04
// [Intent] API route that sends a welcome email to a newly registered user with their team name and PIN.
// [Inbound Trigger] POST request from client-side registration or admin user-creation flow.
// [Downstream Impact] Calls sendWelcomeEmail (email lib); logs errors to error_logs collection. Frontend relies on success/emailGuid response.

import { NextRequest, NextResponse } from 'next/server';
import { sendWelcomeEmail } from '@/lib/email';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

export const dynamic = 'force-dynamic';

// GUID: API_SEND_WELCOME_EMAIL-001-v04
// [Intent] POST handler — validates required fields (toEmail, teamName, pin), delegates to sendWelcomeEmail, and returns the result.
// [Inbound Trigger] HTTP POST with JSON body containing toEmail, teamName, and pin.
// [Downstream Impact] On success, returns emailGuid to caller. On failure, logs to error_logs with correlation ID and returns error details for selectable display.
export async function POST(request: NextRequest) {
  try {
    const { toEmail, teamName, pin } = await request.json();

    if (!toEmail || !teamName || !pin) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const result = await sendWelcomeEmail({ toEmail, teamName, pin });

    if (result.success) {
      return NextResponse.json({
        success: true,
        emailGuid: result.emailGuid
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }
  } catch (error: any) {
    const correlationId = generateCorrelationId();
    const traced = createTracedError(ERRORS.EMAIL_SEND_FAILED, {
      correlationId,
      context: { route: '/api/send-welcome-email', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, (await getFirebaseAdmin()).db);
    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
