import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { canSendEmail, recordSentEmail } from '@/lib/email-tracking';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface HotNewsEmailRequest {
  content: string;
  updatedBy: string;
  updatedByEmail: string;
}

export async function POST(request: NextRequest) {
  const correlationId = generateGuid();

  try {
    const data: HotNewsEmailRequest = await request.json();
    const { content, updatedBy, updatedByEmail } = data;

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required', correlationId },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // Log audit event for hot news update
    await db.collection('audit_logs').add({
      userId: updatedBy,
      action: 'UPDATE_HOT_NEWS',
      details: {
        email: updatedByEmail,
        contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        contentLength: content.length,
      },
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Get all users who have opted in to news feed emails
    const usersSnapshot = await db.collection('users').get();
    const usersToNotify = usersSnapshot.docs.filter(doc => {
      const userData = doc.data();
      // Must explicitly have newsFeed set to true
      return userData.emailPreferences?.newsFeed === true;
    });

    if (usersToNotify.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users subscribed to hot news emails',
        correlationId,
        results: [],
        auditLogged: true,
      });
    }

    const results: { email: string; success: boolean; emailGuid?: string; error?: string }[] = [];

    for (const userDoc of usersToNotify) {
      const userData = userDoc.data();
      const userEmail = userData.email;
      const userTeamName = userData.teamName || 'Team';

      // Check rate limiting
      const rateCheck = await canSendEmail(db as any, userEmail);
      if (!rateCheck.canSend) {
        results.push({ email: userEmail, success: false, error: rateCheck.reason });
        continue;
      }

      // Build the email HTML
      const emailHtml = buildHotNewsEmailHtml({
        teamName: userTeamName,
        content,
      });

      try {
        const emailResult = await sendEmail({
          toEmail: userEmail,
          subject: 'Prix Six: Hot News Update 🏎️',
          htmlContent: emailHtml,
        });

        if (emailResult.success) {
          await recordSentEmail(db as any, {
            toEmail: userEmail,
            subject: 'Prix Six: Hot News Update',
            type: 'hot_news',
            teamName: userTeamName,
            emailGuid: emailResult.emailGuid,
            sentAt: new Date().toISOString(),
            status: 'sent',
          });
          results.push({ email: userEmail, success: true, emailGuid: emailResult.emailGuid });
        } else {
          results.push({ email: userEmail, success: false, error: emailResult.error });
        }
      } catch (error: any) {
        results.push({ email: userEmail, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    // Log summary audit event
    await db.collection('audit_logs').add({
      userId: updatedBy,
      action: 'SEND_HOT_NEWS_EMAILS',
      details: {
        totalSubscribers: usersToNotify.length,
        emailsSent: successCount,
        emailsFailed: usersToNotify.length - successCount,
        results: results.map(r => ({ email: r.email, success: r.success, emailGuid: r.emailGuid })),
      },
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: `Sent ${successCount} of ${usersToNotify.length} hot news emails`,
      correlationId,
      results,
      auditLogged: true,
    });
  } catch (error: any) {
    console.error('Error sending hot news emails:', error);
    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}

function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function buildHotNewsEmailHtml(data: { teamName: string; content: string }): string {
  const { teamName, content } = data;

  // Convert newlines to HTML breaks for proper formatting
  const formattedContent = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p style="margin:0 0 10px 0;">${line}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg, #e10600 0%, #1e1e1e 100%);color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:24px;">🏎️ Prix Six Hot News</h1>
    <p style="margin:5px 0 0;opacity:0.9;">The latest from the paddock</p>
  </div>

  <div style="background:#f8f9fa;padding:20px;border:1px solid #ddd;border-top:none;">
    <h2 style="color:#1a1a2e;margin-top:0;">Hey ${teamName}!</h2>

    <p style="color:#666;">Here's the latest hot news from the F1 world:</p>

    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #e10600;">
      ${formattedContent}
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/dashboard"
         style="display:inline-block;background:#e10600;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;">
        View Dashboard
      </a>
    </div>
  </div>

  <div style="background:#1a1a2e;color:white;padding:15px;text-align:center;border-radius:0 0 8px 8px;font-size:12px;">
    <p style="margin:0;">You're receiving this because you opted in to Hot News notifications.</p>
    <p style="margin:5px 0 0;">Manage your preferences in your <a href="https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/profile" style="color:#e63946;">profile settings</a>.</p>
  </div>
</body>
</html>
  `;
}
