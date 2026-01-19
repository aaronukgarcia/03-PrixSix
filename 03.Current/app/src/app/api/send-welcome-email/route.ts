import { NextRequest, NextResponse } from 'next/server';
import { sendWelcomeEmail } from '@/lib/email';
import { generateCorrelationId, logError } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

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
