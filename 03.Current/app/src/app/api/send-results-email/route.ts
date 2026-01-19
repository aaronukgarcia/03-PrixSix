import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { canSendEmail, recordSentEmail } from '@/lib/email-tracking';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// Dynamic import to avoid build-time errors with firebase-admin
async function getAdminDb() {
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

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

      // Check rate limiting
      const rateCheck = await canSendEmail(db as any, userEmail);
      if (!rateCheck.canSend) {
        results.push({ email: userEmail, success: false, error: rateCheck.reason });
        continue;
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

      try {
        const emailResult = await sendEmail({
          toEmail: userEmail,
          subject: `Prix Six: ${raceName} Results - You scored ${userScore?.points ?? 0} points!`,
          htmlContent: emailHtml,
        });

        if (emailResult.success) {
          await recordSentEmail(db as any, {
            toEmail: userEmail,
            subject: `Prix Six: ${raceName} Results`,
            type: 'results_notification',
            teamName: userTeamName,
            emailGuid: emailResult.emailGuid,
            sentAt: new Date().toISOString(),
            status: 'sent',
          });
          results.push({ email: userEmail, success: true });
        } else {
          results.push({ email: userEmail, success: false, error: emailResult.error });
        }
      } catch (error: any) {
        results.push({ email: userEmail, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return NextResponse.json({
      success: true,
      message: `Sent ${successCount} of ${usersToNotify.length} emails`,
      results,
    });
  } catch (error: any) {
    console.error('Error sending results emails:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

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
    <p style="margin:5px 0 0;">Manage your preferences in your <a href="https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/profile" style="color:#e63946;">profile settings</a>.</p>
  </div>
</body>
</html>
  `;
}
