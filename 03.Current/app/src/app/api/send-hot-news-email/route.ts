import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const DAILY_GLOBAL_LIMIT = 30;
const DAILY_PER_ADDRESS_LIMIT = 5;
const ADMIN_EMAIL = 'aaron@garcia.ltd';

interface HotNewsEmailRequest {
  content: string;
  updatedBy: string;
  updatedByEmail: string;
}

interface EmailLogEntry {
  toEmail: string;
  subject: string;
  type: string;
  teamName?: string;
  emailGuid: string;
  sentAt: string;
  status: 'sent' | 'queued' | 'failed';
}

function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

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

    // Get or create today's email stats using Admin SDK
    const today = getTodayDateString();
    const statsRef = db.collection('email_daily_stats').doc(today);
    const statsDoc = await statsRef.get();

    let dailyStats: { totalSent: number; emailsSent: EmailLogEntry[] };
    if (statsDoc.exists) {
      dailyStats = statsDoc.data() as { totalSent: number; emailsSent: EmailLogEntry[] };
    } else {
      dailyStats = { totalSent: 0, emailsSent: [] };
      await statsRef.set({ date: today, totalSent: 0, emailsSent: [], summaryEmailSent: false });
    }

    // Check global daily limit
    if (dailyStats.totalSent >= DAILY_GLOBAL_LIMIT) {
      return NextResponse.json({
        success: false,
        error: `Daily global email limit of ${DAILY_GLOBAL_LIMIT} reached`,
        correlationId,
      }, { status: 429 });
    }

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

      // Build recipients array - primary email plus verified secondary email
      const recipients: string[] = [userEmail];
      if (userData.secondaryEmail && userData.secondaryEmailVerified) {
        recipients.push(userData.secondaryEmail);
      }

      // Build the email HTML
      const emailHtml = buildHotNewsEmailHtml({
        teamName: userTeamName,
        content,
      });

      // Send to each recipient
      for (const recipientEmail of recipients) {
        // Check per-address limit (skip for admin email)
        if (recipientEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          const addressCount = dailyStats.emailsSent.filter(
            e => e.toEmail.toLowerCase() === recipientEmail.toLowerCase()
          ).length;

          if (addressCount >= DAILY_PER_ADDRESS_LIMIT) {
            results.push({ email: recipientEmail, success: false, error: `Daily limit of ${DAILY_PER_ADDRESS_LIMIT} emails reached` });
            continue;
          }
        }

        // Check global limit hasn't been exceeded during this batch
        if (dailyStats.totalSent >= DAILY_GLOBAL_LIMIT) {
          results.push({ email: recipientEmail, success: false, error: 'Global daily limit reached' });
          continue;
        }

        try {
          const emailResult = await sendEmail({
            toEmail: recipientEmail,
            subject: 'Prix Six: Hot News Update',
            htmlContent: emailHtml,
          });

          if (emailResult.success) {
            // Record sent email using Admin SDK
            const entry: EmailLogEntry = {
              toEmail: recipientEmail,
              subject: 'Prix Six: Hot News Update',
              type: 'hot_news',
              teamName: userTeamName,
              emailGuid: emailResult.emailGuid || '',
              sentAt: new Date().toISOString(),
              status: 'sent',
            };

            // Update stats atomically
            await statsRef.update({
              totalSent: FieldValue.increment(1),
              emailsSent: FieldValue.arrayUnion(entry),
            });

            // Update local tracking
            dailyStats.totalSent++;
            dailyStats.emailsSent.push(entry);

            results.push({ email: recipientEmail, success: true, emailGuid: emailResult.emailGuid });
          } else {
            results.push({ email: recipientEmail, success: false, error: emailResult.error });
          }
        } catch (error: any) {
          results.push({ email: recipientEmail, success: false, error: error.message });
        }
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
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/send-hot-news-email',
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
