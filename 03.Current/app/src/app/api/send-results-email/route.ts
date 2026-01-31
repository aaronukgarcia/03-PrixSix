// GUID: API_SEND_RESULTS_EMAIL-000-v04
// [Intent] API route that sends race results emails to all users who have opted in (or not opted out) of results notifications. Each email is personalised with the user's prediction, score, and current standings.
// [Inbound Trigger] POST request from the admin scoring/results flow after a race has been scored.
// [Downstream Impact] Sends emails via sendEmail (email lib); records sent emails via recordSentEmail (email-tracking lib). Frontend relies on results array and success count.

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { canSendEmail, recordSentEmail } from '@/lib/email-tracking';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_SEND_RESULTS_EMAIL-001-v03
// [Intent] Helper to obtain the Firestore db instance, wrapping getFirebaseAdmin for backwards compatibility.
// [Inbound Trigger] Called at the start of the POST handler.
// [Downstream Impact] Returns the Firestore db; if getFirebaseAdmin fails, the POST handler's catch block handles the error.
async function getAdminDb() {
  const { db } = await getFirebaseAdmin();
  return db;
}

// GUID: API_SEND_RESULTS_EMAIL-002-v03
// [Intent] Type definition for the incoming request body — identifies the race, its official result, per-team scores, and current season standings.
// [Inbound Trigger] Used to type the parsed JSON body in the POST handler.
// [Downstream Impact] Changing field names or structure breaks the admin results-email trigger that constructs this payload.
interface ResultsEmailRequest {
  raceId: string;
  raceName: string;
  officialResult: string[];
  scores: {
    teamName: string;
    prediction: string;
    points: number;
  }[];
  standings: {
    rank: number;
    teamName: string;
    totalPoints: number;
  }[];
}

// GUID: API_SEND_RESULTS_EMAIL-003-v04
// [Intent] POST handler — queries all users who have not opted out of results notifications, builds a personalised results email for each (showing their prediction, score, race scores table, and season standings), sends via Graph API, and records delivery in email-tracking.
// [Inbound Trigger] HTTP POST with JSON body matching ResultsEmailRequest.
// [Downstream Impact] Sends personalised emails via sendEmail; records via recordSentEmail to email_daily_stats. Also sends to verified secondary email addresses. Errors are console-logged (note: does not use logError — potential Golden Rule #1 gap).
export async function POST(request: NextRequest) {
  try {
    const data: ResultsEmailRequest = await request.json();
    const { raceId, raceName, officialResult, scores, standings } = data;

    // Get all users who have opted in to results notifications
    const db = await getAdminDb();
    const usersSnapshot = await db.collection('users').get();
    const usersToNotify = usersSnapshot.docs.filter(doc => {
      const userData = doc.data();
      // Default to true if no preference set
      return userData.emailPreferences?.resultsNotifications !== false;
    });

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const userDoc of usersToNotify) {
      const userData = userDoc.data();
      const userEmail = userData.email;
      const userTeamName = userData.teamName;

      // Build recipients array - primary email plus verified secondary email
      const recipients: string[] = [userEmail];
      if (userData.secondaryEmail && userData.secondaryEmailVerified) {
        recipients.push(userData.secondaryEmail);
      }

      // Find the user's score
      const userScore = scores.find(s => s.teamName === userTeamName);
      const userRank = standings.find(s => s.teamName === userTeamName);

      // Build the email HTML
      const emailHtml = buildResultsEmailHtml({
        teamName: userTeamName,
        raceName,
        officialResult,
        userPrediction: userScore?.prediction || 'No prediction submitted',
        userPoints: userScore?.points ?? 0,
        allScores: scores,
        standings,
        userRank: userRank?.rank,
      });

      // Send to each recipient
      for (const recipientEmail of recipients) {
        // Check rate limiting for each recipient
        const rateCheck = await canSendEmail(db as any, recipientEmail);
        if (!rateCheck.canSend) {
          results.push({ email: recipientEmail, success: false, error: rateCheck.reason });
          continue;
        }

        try {
          const emailResult = await sendEmail({
            toEmail: recipientEmail,
            subject: `Prix Six: ${raceName} Results - You scored ${userScore?.points ?? 0} points!`,
            htmlContent: emailHtml,
          });

          if (emailResult.success) {
            await recordSentEmail(db as any, {
              toEmail: recipientEmail,
              subject: `Prix Six: ${raceName} Results`,
              type: 'results_notification',
              teamName: userTeamName,
              emailGuid: emailResult.emailGuid,
              sentAt: new Date().toISOString(),
              status: 'sent',
            });
            results.push({ email: recipientEmail, success: true });
          } else {
            results.push({ email: recipientEmail, success: false, error: emailResult.error });
          }
        } catch (error: any) {
          results.push({ email: recipientEmail, success: false, error: error.message });
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    return NextResponse.json({
      success: true,
      message: `Sent ${successCount} of ${usersToNotify.length} emails`,
      results,
    });
  } catch (error: any) {
    const correlationId = generateCorrelationId();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/send-results-email', action: 'POST' },
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

// GUID: API_SEND_RESULTS_EMAIL-004-v03
// [Intent] Builds the full HTML email body for race results, including the user's score hero section, official result table, user prediction, race scores table (sorted by points, user highlighted), and season standings table (user highlighted).
// [Inbound Trigger] Called once per user inside the POST handler's user loop.
// [Downstream Impact] The generated HTML is passed to sendEmail. Changes to the template affect all results notification emails. Links point to prix6.win/profile.
function buildResultsEmailHtml(data: {
  teamName: string;
  raceName: string;
  officialResult: string[];
  userPrediction: string;
  userPoints: number;
  allScores: { teamName: string; prediction: string; points: number }[];
  standings: { rank: number; teamName: string; totalPoints: number }[];
  userRank?: number;
}): string {
  const { teamName, raceName, officialResult, userPrediction, userPoints, allScores, standings, userRank } = data;

  const officialResultHtml = officialResult
    .map((driver, i) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;">P${i + 1}</td><td style="padding:4px 8px;border:1px solid #ddd;">${driver}</td></tr>`)
    .join('');

  const scoresHtml = allScores
    .sort((a, b) => b.points - a.points)
    .map(s => `<tr style="${s.teamName === teamName ? 'background:#e6f3ff;font-weight:bold;' : ''}"><td style="padding:4px 8px;border:1px solid #ddd;">${s.teamName}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.points}</td></tr>`)
    .join('');

  const standingsHtml = standings
    .map(s => `<tr style="${s.teamName === teamName ? 'background:#e6f3ff;font-weight:bold;' : ''}"><td style="padding:4px 8px;border:1px solid #ddd;">${s.rank}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.teamName}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.totalPoints}</td></tr>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a1a2e;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:24px;">Prix Six</h1>
    <p style="margin:5px 0 0;opacity:0.9;">${raceName} Results</p>
  </div>

  <div style="background:#f8f9fa;padding:20px;border:1px solid #ddd;border-top:none;">
    <h2 style="color:#1a1a2e;margin-top:0;">Hey ${teamName}!</h2>

    <div style="background:white;padding:15px;border-radius:8px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;font-size:14px;color:#666;">Your Score</p>
      <p style="margin:5px 0;font-size:36px;font-weight:bold;color:#e63946;">${userPoints} points</p>
      ${userRank ? `<p style="margin:0;font-size:14px;color:#666;">You are ranked #${userRank} overall</p>` : ''}
    </div>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #e63946;padding-bottom:5px;">Official Result</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#1a1a2e;color:white;">
          <th style="padding:8px;text-align:left;">Position</th>
          <th style="padding:8px;text-align:left;">Driver</th>
        </tr>
      </thead>
      <tbody>
        ${officialResultHtml}
      </tbody>
    </table>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #e63946;padding-bottom:5px;">Your Prediction</h3>
    <p style="font-family:monospace;background:#fff;padding:10px;border-radius:4px;border:1px solid #ddd;">${userPrediction}</p>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #e63946;padding-bottom:5px;">Race Scores</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#1a1a2e;color:white;">
          <th style="padding:8px;text-align:left;">Team</th>
          <th style="padding:8px;text-align:left;">Points</th>
        </tr>
      </thead>
      <tbody>
        ${scoresHtml}
      </tbody>
    </table>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #e63946;padding-bottom:5px;">Season Standings</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#1a1a2e;color:white;">
          <th style="padding:8px;text-align:left;">Rank</th>
          <th style="padding:8px;text-align:left;">Team</th>
          <th style="padding:8px;text-align:left;">Total Points</th>
        </tr>
      </thead>
      <tbody>
        ${standingsHtml}
      </tbody>
    </table>
  </div>

  <div style="background:#1a1a2e;color:white;padding:15px;text-align:center;border-radius:0 0 8px 8px;font-size:12px;">
    <p style="margin:0;">You're receiving this because you opted in to results notifications.</p>
    <p style="margin:5px 0 0;">Manage your preferences in your <a href="https://prix6.win/profile" style="color:#e63946;">profile settings</a>.</p>
  </div>
</body>
</html>
  `;
}
