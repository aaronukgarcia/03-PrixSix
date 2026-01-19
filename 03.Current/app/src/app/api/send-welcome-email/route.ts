import { NextRequest, NextResponse } from 'next/server';
import { sendWelcomeEmail } from '@/lib/email';

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
    console.error('Error in send-welcome-email API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
