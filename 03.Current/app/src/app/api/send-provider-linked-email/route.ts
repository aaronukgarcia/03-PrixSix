// GUID: API_SEND_PROVIDER_LINKED_EMAIL-000-v04
// [Intent] API route that sends a confirmation email when a user links a Google or Apple
//          sign-in provider to their account. Sends to primary email and secondary email
//          (if verified). Fire-and-forget from the client.
// [Inbound Trigger] POST request from the Firebase provider after a successful linkWithPopup.
// [Downstream Impact] Sends branded email via sendEmail (Graph API). No Firestore state changes.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { sendEmail } from '@/lib/email';

// GUID: API_SEND_PROVIDER_LINKED_EMAIL-001-v03
// [Intent] Map provider IDs to human-readable names for the email body.
// [Inbound Trigger] Used by POST handler to build readable email content.
// [Downstream Impact] None — pure mapping.
function providerDisplayName(providerId: string): string {
  switch (providerId) {
    case 'google.com': return 'Google';
    case 'apple.com': return 'Apple';
    default: return providerId;
  }
}

// GUID: API_SEND_PROVIDER_LINKED_EMAIL-002-v04
// [Intent] POST handler — validates required fields, builds a branded confirmation email,
//          and sends to primary (and optionally secondary) email addresses.
// [Inbound Trigger] HTTP POST with JSON body: { email, teamName, providerId, secondaryEmail? }.
// [Downstream Impact] Sends 1-2 emails via Graph API. Errors logged with correlationId.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { email, teamName, providerId, secondaryEmail } = body;

    if (!email || !providerId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: email and providerId',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
      return NextResponse.json(
        {
          success: false,
          error: 'Email service not configured.',
          errorCode: ERROR_CODES.EMAIL_CONFIG_MISSING.code,
          correlationId,
        },
        { status: 503 }
      );
    }

    const displayName = providerDisplayName(providerId);
    const displayTeam = teamName || 'your team';

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">Prix Six</h1>
          <p style="color: #666; font-size: 14px; margin-top: 4px;">F1 Prediction League</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 12px 0;">
            ${displayName} Account Linked
          </h2>
          <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
            Hi <strong>${displayTeam}</strong>,
          </p>
          <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
            Your <strong>${displayName}</strong> account has been successfully linked to your Prix Six account.
            You can now sign in using ${displayName} for faster, more secure access without needing your PIN.
          </p>
          <p style="color: #444; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
            Your existing PIN sign-in method still works &mdash; you now have multiple ways to access your account.
          </p>
          <div style="background: #e8f5e9; border-radius: 8px; padding: 16px; margin-top: 16px;">
            <p style="color: #2e7d32; font-size: 14px; margin: 0;">
              <strong>Linked methods:</strong> PIN + ${displayName}
            </p>
          </div>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center;">
          If you did not make this change, please contact us immediately at aaron@garcia.ltd
        </p>
      </div>
    `;

    // Send to primary email
    const result = await sendEmail({
      toEmail: email,
      subject: `${displayName} account linked to Prix Six`,
      htmlContent,
    });

    // Send to secondary email if provided (fire-and-forget)
    if (secondaryEmail) {
      sendEmail({
        toEmail: secondaryEmail,
        subject: `${displayName} account linked to Prix Six`,
        htmlContent,
      }).catch((err) => {
        console.error('Failed to send provider-linked email to secondary:', err);
      });
    }

    return NextResponse.json({
      success: result.success,
      emailGuid: result.emailGuid,
      correlationId,
    });
  } catch (error: any) {
    const traced = createTracedError(ERRORS.EMAIL_SEND_FAILED, {
      correlationId,
      context: { route: '/api/send-provider-linked-email', action: 'POST' },
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
