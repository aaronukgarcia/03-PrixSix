// GUID: API_SEND_HOT_NEWS_EMAIL-000-v06
// @SECURITY_FIX: Added verifyAuthToken + isAdmin check to prevent unauthenticated mass email broadcasts (ADMINCOMP-006).
// [Intent] API route that broadcasts a hot news email to all users who have opted in to the newsFeed email preference. Enforces authentication (admin-only), 1-hour broadcast cooldown, daily global and per-address rate limits, logs audit events, and tracks email stats.
// [Inbound Trigger] POST request with Authorization: Bearer <idToken> header from the admin HotNewsManager component.
// [Downstream Impact] Sends emails via sendEmail (email lib); writes to audit_logs, email_daily_stats, and admin_configuration/hot_news_email_throttle collections. Frontend relies on results array and success counts.

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_SEND_HOT_NEWS_EMAIL-001-v04
// @SECURITY_FIX: Added broadcast cooldown constant (ADMINCOMP-006).
// [Intent] Rate-limiting constants — caps total daily emails at 30 globally and 5 per individual address to prevent abuse and protect Graph API quotas. Also enforces 1-hour cooldown between broadcasts to prevent email spam.
// [Inbound Trigger] Referenced during the email send loop in the POST handler and broadcast throttle check.
// [Downstream Impact] Changing these values directly affects how many hot news emails can be sent per day and how frequently broadcasts can occur. Admin email (aaron@garcia.ltd) is exempt from per-address limit.
const DAILY_GLOBAL_LIMIT = 30;
const DAILY_PER_ADDRESS_LIMIT = 5;
const ADMIN_EMAIL = 'aaron@garcia.ltd';
const BROADCAST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// GUID: API_SEND_HOT_NEWS_EMAIL-001A-v01
// [Intent] Escape HTML special characters to prevent XSS injection in hot news email content.
//          Converts &<>"'/ to their HTML entity equivalents to safely embed user-controlled
//          data (team names, admin-authored content) into HTML email templates.
// [Inbound Trigger] Called by buildHotNewsEmailHtml on all user/admin-supplied strings.
// [Downstream Impact] Protects against EMAIL-001 (HTML injection vulnerability). All user data
//                     in emails is rendered as text, not executable HTML/JavaScript.
// [Security] Resolves CVSS 7.5 vulnerability by preventing stored XSS in email templates.
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');
}

// GUID: API_SEND_HOT_NEWS_EMAIL-002-v04
// @SECURITY_FIX: Added adminUid field to enable server-side UID-match verification (ADMINCOMP-006).
// [Intent] Type definition for the incoming request body — content of the hot news, who triggered the update, and the admin UID for token verification.
// [Inbound Trigger] Used to type the parsed JSON body in the POST handler.
// [Downstream Impact] Changing field names breaks the admin HotNewsManager component that constructs this payload.
interface HotNewsEmailRequest {
  content: string;
  updatedBy: string;
  updatedByEmail: string;
  adminUid: string;
}

// GUID: API_SEND_HOT_NEWS_EMAIL-003-v03
// [Intent] Type definition for an entry in the email_daily_stats.emailsSent array — tracks each sent email for rate-limiting and audit.
// [Inbound Trigger] Used when recording a successfully sent email into Firestore email_daily_stats.
// [Downstream Impact] Changing this shape affects the email-health and admin email monitoring views that read email_daily_stats.
interface EmailLogEntry {
  toEmail: string;
  subject: string;
  type: string;
  teamName?: string;
  emailGuid: string;
  sentAt: string;
  status: 'sent' | 'queued' | 'failed';
}

// GUID: API_SEND_HOT_NEWS_EMAIL-004-v03
// [Intent] Returns today's date as an ISO date string (YYYY-MM-DD) for keying the email_daily_stats document.
// [Inbound Trigger] Called at the start of the POST handler to identify today's stats document.
// [Downstream Impact] Used as the Firestore document ID in email_daily_stats. Timezone is UTC (server time).
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// GUID: API_SEND_HOT_NEWS_EMAIL-005-v06
// @SECURITY_FIX: Added verifyAuthToken + UID match + isAdmin check before any processing (ADMINCOMP-006).
// [Intent] POST handler — authenticates admin caller, then orchestrates the entire hot news email broadcast: validates input, checks broadcast cooldown, logs audit event, checks rate limits, queries opted-in users, sends emails (including to verified secondary addresses), updates daily stats, and logs a summary audit event.
// [Inbound Trigger] HTTP POST with Authorization: Bearer <idToken> header and JSON body containing content, updatedBy, updatedByEmail, adminUid.
// [Downstream Impact] Writes to audit_logs (two entries per invocation), email_daily_stats, admin_configuration/hot_news_email_throttle, and sends emails via Graph API. Errors logged to error_logs with correlation ID.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_SEND_HOT_NEWS_EMAIL-005A-v01
    // @SECURITY_FIX: Authentication gate — must be a verified admin to trigger email broadcasts (ADMINCOMP-006).
    // [Intent] Verifies the Bearer token, then checks UID match and Firestore isAdmin flag before allowing any email broadcast.
    // [Inbound Trigger] Every POST request — evaluated before body parse or any other logic.
    // [Downstream Impact] Unauthenticated or non-admin requests are rejected (401/403). Prevents mass email spam from unauthenticated callers.
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);
    if (!verifiedUser) {
      await logError({ correlationId, error: 'Unauthenticated request to send-hot-news-email', context: { route: '/api/send-hot-news-email' } });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_INVALID_TOKEN.message, errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code, correlationId },
        { status: 401 }
      );
    }

    const data: HotNewsEmailRequest = await request.json();
    const { content, updatedBy, updatedByEmail, adminUid } = data;

    if (verifiedUser.uid !== adminUid) {
      await logError({ correlationId, error: `Token UID mismatch on send-hot-news-email: token=${verifiedUser.uid}, body=${adminUid}`, context: { route: '/api/send-hot-news-email' } });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_PERMISSION_DENIED.message, errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code, correlationId },
        { status: 403 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required', correlationId },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // Verify caller has isAdmin=true in Firestore (server-side, cannot be spoofed)
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      await logError({ correlationId, error: `Non-admin attempted hot-news email broadcast: uid=${verifiedUser.uid}`, context: { route: '/api/send-hot-news-email' } });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_ADMIN_REQUIRED.message, errorCode: ERROR_CODES.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 }
      );
    }

    // SECURITY: Check broadcast cooldown to prevent email spam (ADMINCOMP-006)
    const throttleRef = db.collection('admin_configuration').doc('hot_news_email_throttle');
    const throttleDoc = await throttleRef.get();

    if (throttleDoc.exists) {
      const lastBroadcastTime = throttleDoc.data()?.lastBroadcastAt?.toMillis?.() || 0;
      const timeSinceLastBroadcast = Date.now() - lastBroadcastTime;

      if (timeSinceLastBroadcast < BROADCAST_COOLDOWN_MS) {
        const remainingMinutes = Math.ceil((BROADCAST_COOLDOWN_MS - timeSinceLastBroadcast) / 60000);
        return NextResponse.json({
          success: false,
          error: `Rate limit: Hot news broadcasts are limited to once per hour. Please wait ${remainingMinutes} more minutes before sending another broadcast.`,
          errorCode: 'RATE_LIMIT_BROADCAST_COOLDOWN',
          correlationId,
          remainingMinutes,
        }, { status: 429 });
      }
    }

    // Update throttle state to record this broadcast
    await throttleRef.set({
      lastBroadcastAt: FieldValue.serverTimestamp(),
      lastBroadcastBy: updatedBy,
      correlationId,
    }, { merge: true });

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
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/send-hot-news-email', action: 'POST' },
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

// GUID: API_SEND_HOT_NEWS_EMAIL-006-v03
// [Intent] Builds the HTML email body for hot news notifications, converting newline-separated content into styled HTML paragraphs with Prix Six branding.
// [Inbound Trigger] Called once per user (not per recipient) inside the POST handler's email loop.
// [Downstream Impact] The generated HTML is passed to sendEmail. Changes to the template affect all hot news emails. Links point to prix6.win/dashboard and prix6.win/profile.
function buildHotNewsEmailHtml(data: { teamName: string; content: string }): string {
  const { teamName, content } = data;

  // SECURITY: Escape HTML to prevent XSS injection (EMAIL-001 fix)
  // Convert newlines to HTML breaks for proper formatting, escaping each line
  const formattedContent = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p style="margin:0 0 10px 0;">${escapeHtml(line)}</p>`)
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
    <h2 style="color:#1a1a2e;margin-top:0;">Hey ${escapeHtml(teamName)}!</h2>

    <p style="color:#666;">Here's the latest hot news from the F1 world:</p>

    <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #e10600;">
      ${formattedContent}
    </div>

    <div style="text-align:center;margin-top:20px;">
      <a href="https://prix6.win/dashboard"
         style="display:inline-block;background:#e10600;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;">
        View Dashboard
      </a>
    </div>
  </div>

  <div style="background:#1a1a2e;color:white;padding:15px;text-align:center;border-radius:0 0 8px 8px;font-size:12px;">
    <p style="margin:0;">You're receiving this because you opted in to Hot News notifications.</p>
    <p style="margin:5px 0 0;">Manage your preferences in your <a href="https://prix6.win/profile" style="color:#e63946;">profile settings</a>.</p>
  </div>
</body>
</html>
  `;
}
