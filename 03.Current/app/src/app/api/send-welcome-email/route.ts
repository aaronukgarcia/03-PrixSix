// GUID: API_SEND_WELCOME_EMAIL-000-v03
// [Intent] API route that sends a welcome email to a newly registered user with their team name and PIN.
// [Inbound Trigger] POST request from client-side registration or admin user-creation flow.
// [Downstream Impact] Calls sendWelcomeEmail (email lib); logs errors to error_logs collection. Frontend relies on success/emailGuid response.

import { NextRequest, NextResponse } from 'next/server';
import { sendWelcomeEmail } from '@/lib/email';
import { generateCorrelationId, logError } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GUID: API_SEND_WELCOME_EMAIL-001-v03
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

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/send-welcome-email',
        action: 'POST',
        userAgent: request.headers.get('user-agent') || undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}
