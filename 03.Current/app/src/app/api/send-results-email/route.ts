// GUID: API_SEND_RESULTS_EMAIL-000-v05
// @SECURITY_FIX: Added HTML escaping for all user-controlled data to prevent XSS (EMAIL-005).
// [Intent] API route that sends race results emails to all users who have opted in (or not opted out) of results notifications. Each email is personalised with the user's prediction, score, and current standings.
// [Inbound Trigger] POST request from the admin scoring/results flow after a race has been scored.
// [Downstream Impact] Sends emails via sendEmail (email lib); records sent emails via recordSentEmail (email-tracking lib). Frontend relies on results array and success count.

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, escapeHtml } from '@/lib/email';
import { getTodayDateString } from '@/lib/email-tracking';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  type CumulativeStanding,
} from '@/lib/cumulative-standings';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_SEND_RESULTS_EMAIL-001-v04
// [Intent] Helper to obtain the Firestore db instance and FieldValue utilities from the Admin SDK.
// [Inbound Trigger] Called at the start of the POST handler.
// [Downstream Impact] Returns the Firestore db and FieldValue; if getFirebaseAdmin fails, the POST handler's catch block handles the error.
async function getAdminFirebase() {
  const { db, FieldValue } = await getFirebaseAdmin();
  return { db, FieldValue };
}

// GUID: API_SEND_RESULTS_EMAIL-001B-v03
// @SECURITY_FIX: Removed hardcoded ADMIN_EMAIL fallback — missing config now fails fast (GEMINI-AUDIT-055C).
//   A hardcoded email in source (a) exposes a real address to anyone who reads the bundle,
//   and (b) silently masks misconfiguration by substituting a default when the env var is absent.
//   Fix: requireAdminEmail() fails fast with ERRORS.EMAIL_CONFIG_MISSING+logError+correlationId
//   if neither GRAPH_SENDER_EMAIL nor ADMIN_EMAIL env var is set.
// @BUGFIX (2026-07-06): Raised DAILY_GLOBAL_LIMIT 30 -> 100. The old cap of 30 was exactly the
//   league size, so a SINGLE race batch consumed the entire daily budget. On a sprint weekend
//   (two results postings on the same calendar day — Sprint then GP), the second race's emails
//   were ALL silently suppressed (British GP 2026-07-05: Sprint batch at 12:45 hit 30/30, the
//   21:09 GP posting sent ZERO). 100 comfortably covers a sprint weekend (2 races x ~31
//   recipients incl. verified secondary emails, plus headroom). Do NOT lower below ~2x league size.
//   canSendEmailAdmin now returns limitType so the caller can distinguish a GLOBAL-cap block
//   (which must be surfaced to the admin + logged) from a benign per-address block.
// [Intent] Server-side rate-limit check using Admin SDK. Replaces client-side canSendEmail which used incompatible firebase/firestore SDK. Resolves the admin email from env at runtime to exempt it from per-address rate limits.
// [Inbound Trigger] Called before each email send in the POST handler loop.
// [Downstream Impact] Returns { canSend, reason?, limitType? }. If false, the email is skipped with the reason. Rate limits: 100 global/day, 5 per address/day (admin exempt from per-address only, NOT global). Throws EMAIL_CONFIG_MISSING if GRAPH_SENDER_EMAIL/ADMIN_EMAIL env var is absent.
const DAILY_GLOBAL_LIMIT = 100;
const DAILY_PER_ADDRESS_LIMIT = 5;

function requireAdminEmail(): string {
  const adminEmail = process.env.GRAPH_SENDER_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) {
    const correlationId = generateCorrelationId();
    logError({
      correlationId,
      error: new Error(`[${ERRORS.EMAIL_CONFIG_MISSING.code}] Admin email not configured — set GRAPH_SENDER_EMAIL or ADMIN_EMAIL env var`),
      context: { action: 'requireAdminEmail', route: '/api/send-results-email', additionalInfo: { errorKey: ERRORS.EMAIL_CONFIG_MISSING.key } },
    });
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[${correlationId}] ${ERRORS.EMAIL_CONFIG_MISSING.code}: Admin email not configured`);
    }
    throw new Error(`[${ERRORS.EMAIL_CONFIG_MISSING.code}] Admin email not configured (correlationId: ${correlationId})`);
  }
  return adminEmail;
}

async function canSendEmailAdmin(
  db: Awaited<ReturnType<typeof getFirebaseAdmin>>['db'],
  toEmail: string
): Promise<{ canSend: boolean; reason?: string; limitType?: 'global' | 'address' }> {
  const today = getTodayDateString();
  const statsRef = db.collection('email_daily_stats').doc(today);
  const statsDoc = await statsRef.get();

  const stats = statsDoc.exists
    ? (statsDoc.data() as { totalSent: number; emailsSent: { toEmail: string }[] })
    : { totalSent: 0, emailsSent: [] };

  if (stats.totalSent >= DAILY_GLOBAL_LIMIT) {
    return { canSend: false, reason: `Daily global limit of ${DAILY_GLOBAL_LIMIT} emails reached`, limitType: 'global' };
  }

  const adminEmail = requireAdminEmail();
  if (toEmail.toLowerCase() !== adminEmail.toLowerCase()) {
    const addressCount = (stats.emailsSent || []).filter(
      (e) => e.toEmail?.toLowerCase() === toEmail.toLowerCase()
    ).length;
    if (addressCount >= DAILY_PER_ADDRESS_LIMIT) {
      return { canSend: false, reason: `Daily limit of ${DAILY_PER_ADDRESS_LIMIT} emails to ${toEmail} reached`, limitType: 'address' };
    }
  }

  return { canSend: true };
}

// GUID: API_SEND_RESULTS_EMAIL-001C-v01
// [Intent] Server-side email recording using Admin SDK. Replaces client-side recordSentEmail which used incompatible firebase/firestore SDK.
// [Inbound Trigger] Called after a successful email send in the POST handler loop.
// [Downstream Impact] Increments daily stats counter and appends the email log entry. Creates the stats doc if it doesn't exist yet for the day.
async function recordSentEmailAdmin(
  db: Awaited<ReturnType<typeof getFirebaseAdmin>>['db'],
  FieldValue: Awaited<ReturnType<typeof getFirebaseAdmin>>['FieldValue'],
  entry: { toEmail: string; subject: string; type: string; teamName?: string; emailGuid: string; sentAt: string; status: string }
): Promise<void> {
  const today = getTodayDateString();
  const statsRef = db.collection('email_daily_stats').doc(today);
  const statsDoc = await statsRef.get();

  if (!statsDoc.exists) {
    await statsRef.set({
      date: today,
      totalSent: 1,
      emailsSent: [entry],
      summaryEmailSent: false,
    });
  } else {
    await statsRef.update({
      totalSent: FieldValue.increment(1),
      emailsSent: FieldValue.arrayUnion(entry),
    });
  }
}

// GUID: API_SEND_RESULTS_EMAIL-005-v03
// [Intent] Thin wrapper over the SSOT lib for cumulative standings. Delegates to
//          @/lib/cumulative-standings so the email shows the same numbers the user
//          sees on the /standings page. Caller wraps in try/catch so a compute
//          failure degrades gracefully (email still ships without the standings table)
//          rather than blocking the whole results email.
// [Inbound Trigger] Called once per POST request after team names are loaded.
// [Downstream Impact] Returns [{rank, userId, teamName, totalPoints}] sorted by total
//                     points desc with tie ranks. Throws TracedError on Firestore failure.
async function computeCumulativeStandings(
  db: Awaited<ReturnType<typeof getFirebaseAdmin>>['db'],
  teamNameByUid: Map<string, string>,
): Promise<CumulativeStanding[]> {
  const { scores } = await computeRaceScores(db);
  return aggregateStandings(scores, teamNameByUid);
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

// GUID: API_SEND_RESULTS_EMAIL-003-v05
// [Intent] POST handler — queries all users who have not opted out of results notifications, builds a personalised results email for each (showing their prediction, score, race scores table, and season standings), sends via Graph API, and records delivery in email-tracking.
// [Inbound Trigger] HTTP POST with JSON body matching ResultsEmailRequest.
// [Downstream Impact] Sends personalised emails via sendEmail; records via recordSentEmail to email_daily_stats. Also sends to verified secondary email addresses. When the GLOBAL daily cap suppresses any recipient it logs a registry error (EMAIL_DAILY_LIMIT/PX-3003) once per batch and returns globalLimitReached/suppressedCount/correlationId so the admin UI can raise a visible alert (fixes the prior silent-suppression Golden Rule #1/#17 gap).
export async function POST(request: NextRequest) {
  const authCorrelationId = generateCorrelationId();
  try {
    // @SECURITY_FIX (cyber.md H-1): this route was UNAUTHENTICATED — any anonymous caller could
    // mass-email the ENTIRE league with attacker-controlled results text and exhaust the 100/day
    // Graph cap, silently suppressing real results emails. Its only caller is the admin ResultsManager,
    // so require a verified admin (same pattern as send-hot-news-email).
    const verifiedUser = await verifyAuthToken(request.headers.get('Authorization'));
    if (!verifiedUser) {
      await logError({ correlationId: authCorrelationId, error: 'Unauthenticated request to send-results-email', context: { route: '/api/send-results-email' } });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_INVALID_TOKEN.message, errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code, correlationId: authCorrelationId },
        { status: 401 }
      );
    }

    const data: ResultsEmailRequest = await request.json();
    const { raceId, raceName, officialResult, scores } = data;

    // Get all users who have opted in to results notifications
    const { db, FieldValue } = await getAdminFirebase();

    // Verify caller has isAdmin=true in Firestore (server-side, cannot be spoofed by a client claim).
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      await logError({ correlationId: authCorrelationId, error: `Non-admin attempted results-email broadcast: uid=${verifiedUser.uid}`, context: { route: '/api/send-results-email' } });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_ADMIN_REQUIRED.message, errorCode: ERROR_CODES.AUTH_ADMIN_REQUIRED.code, correlationId: authCorrelationId },
        { status: 403 }
      );
    }
    const usersSnapshot = await db.collection('users').get();
    const usersToNotify = usersSnapshot.docs.filter(doc => {
      const userData = doc.data();
      // Default to true if no preference set
      return userData.emailPreferences?.resultsNotifications !== false;
    });

    // Build uid -> teamName map for all users (primary AND secondary teams).
    // buildTeamNamesMap is the shared helper — also used by /api/standings and the
    // admin health probe so all three places resolve names identically.
    const teamNameByUid = await buildTeamNamesMap(db);

    // Golden Rule #1 — graceful degradation around the cumulative standings compute.
    // If the lib throws (Firestore outage, malformed data, permission error), the email
    // still ships with the per-race scores; the Season Standings table is replaced with
    // a placeholder pointing the user to the live /standings page. The traced error has
    // already been logged inside the lib (PX-5008). We capture the correlation ID so
    // the placeholder can show it for support.
    let standings: CumulativeStanding[] = [];
    let standingsError: { correlationId?: string; code?: string } | null = null;
    try {
      standings = await computeCumulativeStandings(db, teamNameByUid);
    } catch (err: any) {
      standingsError = {
        correlationId: err?.correlationId ?? generateCorrelationId(),
        code: err?.definition?.code ?? ERRORS.SCORE_STANDINGS_FAILED.code,
      };
    }

    const results: { email: string; success: boolean; error?: string }[] = [];
    // Count recipients skipped specifically because the GLOBAL daily cap was exhausted.
    // These are silent failures (the admin never learns their league didn't get the email)
    // unless we log + surface them — see the post-loop block and the API response flags.
    let globalLimitBlocked = 0;

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
        standingsError,
      });

      // Send to each recipient
      for (const recipientEmail of recipients) {
        // Check rate limiting for each recipient
        const rateCheck = await canSendEmailAdmin(db, recipientEmail);
        if (!rateCheck.canSend) {
          if (rateCheck.limitType === 'global') globalLimitBlocked++;
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
            await recordSentEmailAdmin(db, FieldValue, {
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

    // GOLDEN RULE #1 / #7 / #17 — do not let the daily-cap suppression stay silent.
    // If ANY results email was blocked by the GLOBAL cap, log a registry error with a
    // correlation ID (once per batch, not per recipient) and return flags so the admin
    // portal can raise a visible alert. This is exactly the failure that hid the British
    // GP 2026-07-05 non-delivery (whole GP batch suppressed by the earlier Sprint batch).
    let limitCorrelationId: string | undefined;
    if (globalLimitBlocked > 0) {
      limitCorrelationId = generateCorrelationId();
      logError({
        correlationId: limitCorrelationId,
        error: new Error(
          `[${ERRORS.EMAIL_DAILY_LIMIT.code}] Results email suppressed for ${globalLimitBlocked} recipient(s) — daily global limit of ${DAILY_GLOBAL_LIMIT} reached while sending "${raceName}" results`
        ),
        context: {
          action: 'send-results-email',
          route: '/api/send-results-email',
          additionalInfo: {
            errorKey: ERRORS.EMAIL_DAILY_LIMIT.key,
            raceName,
            raceId,
            globalLimitBlocked,
            dailyLimit: DAILY_GLOBAL_LIMIT,
            sentCount: successCount,
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Sent ${successCount} of ${usersToNotify.length} emails`,
      results,
      // Admin-portal alert signal (see ResultsManager.handleConfirmedSubmit).
      globalLimitReached: globalLimitBlocked > 0,
      suppressedCount: globalLimitBlocked,
      dailyLimit: DAILY_GLOBAL_LIMIT,
      limitErrorCode: globalLimitBlocked > 0 ? ERRORS.EMAIL_DAILY_LIMIT.code : undefined,
      correlationId: limitCorrelationId,
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

// GUID: API_SEND_RESULTS_EMAIL-004-v05
// @SECURITY_FIX: Added HTML escaping to prevent XSS injection (EMAIL-005).
//   All user-controlled data (team names, driver names, race names, predictions) now escaped.
// [Intent] Builds the full HTML email body for race results, including the user's score
//          hero section, official result table, user prediction, race scores table (sorted
//          by points, user highlighted), and season standings table (user highlighted).
//          When standingsError is non-null the standings table is replaced with a placeholder
//          callout pointing the user to the live /standings page (graceful degradation).
// [Inbound Trigger] Called once per user inside the POST handler's user loop.
// [Downstream Impact] The generated HTML is passed to sendEmail. Changes to the template
//                     affect all results notification emails. Links point to prix6.win.
function buildResultsEmailHtml(data: {
  teamName: string;
  raceName: string;
  officialResult: string[];
  userPrediction: string;
  userPoints: number;
  allScores: { teamName: string; prediction: string; points: number }[];
  standings: { rank: number; teamName: string; totalPoints: number }[];
  userRank?: number;
  standingsError?: { correlationId?: string; code?: string } | null;
}): string {
  const { teamName, raceName, officialResult, userPrediction, userPoints, allScores, standings, userRank, standingsError } = data;

  // SECURITY: Escape all user-controlled content to prevent XSS (EMAIL-005 fix)
  const officialResultHtml = officialResult
    .map((driver, i) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;">P${i + 1}</td><td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(driver)}</td></tr>`)
    .join('');

  const scoresHtml = allScores
    .sort((a, b) => b.points - a.points)
    .map(s => `<tr style="${escapeHtml(s.teamName) === escapeHtml(teamName) ? 'background:#e6f3ff;font-weight:bold;' : ''}"><td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(s.teamName)}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.points}</td></tr>`)
    .join('');

  const standingsHtml = standings
    .map(s => `<tr style="${escapeHtml(s.teamName) === escapeHtml(teamName) ? 'background:#e6f3ff;font-weight:bold;' : ''}"><td style="padding:4px 8px;border:1px solid #ddd;">${s.rank}</td><td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(s.teamName)}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.totalPoints}</td></tr>`)
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
    <p style="margin:5px 0 0;opacity:0.9;">${escapeHtml(raceName)} Results</p>
  </div>

  <div style="background:#f8f9fa;padding:20px;border:1px solid #ddd;border-top:none;">
    <h2 style="color:#1a1a2e;margin-top:0;">Hey ${escapeHtml(teamName)}!</h2>

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
    <p style="font-family:monospace;background:#fff;padding:10px;border-radius:4px;border:1px solid #ddd;">${escapeHtml(userPrediction)}</p>

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
    ${standingsError
      ? `<div style="background:#fff3cd;border:1px solid #ffeaa7;border-radius:6px;padding:12px;margin-bottom:20px;color:#856404;font-size:14px;">
           <p style="margin:0 0 6px 0;font-weight:bold;">Season standings temporarily unavailable</p>
           <p style="margin:0;">View the latest standings at <a href="https://prix6.win/standings" style="color:#856404;font-weight:bold;">prix6.win/standings</a>.</p>
           <p style="margin:6px 0 0 0;font-size:11px;color:#999;">Ref: ${escapeHtml(standingsError.code ?? '')} ${escapeHtml(standingsError.correlationId ?? '')}</p>
         </div>`
      : `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
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
    </table>`
    }
  </div>

  <div style="background:#1a1a2e;color:white;padding:15px;text-align:center;border-radius:0 0 8px 8px;font-size:12px;">
    <p style="margin:0;">You're receiving this because you opted in to results notifications.</p>
    <p style="margin:5px 0 0;">Manage your preferences in your <a href="https://prix6.win/profile" style="color:#e63946;">profile settings</a>.</p>
  </div>
</body>
</html>
  `;
}
