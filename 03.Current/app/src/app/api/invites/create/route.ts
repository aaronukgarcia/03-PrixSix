// GUID: API_INVITES_CREATE-000-v01
// [Intent] Server-side API route letting a logged-in Prix Six player invite a friend by
//          email. Creates a single-use 256-bit invite token (the SEC-SIGNUP-001 signup-gate
//          bypass) and emails the friend a welcoming, branded hot link to /signup?invite=…
//          where they can register with email+PIN or Google/Apple sign-in.
// [Inbound Trigger] POST from the /invite page (Invite a Friend sidebar item).
// [Downstream Impact] Writes to the server-only `invites` collection, sends email via
//                     Microsoft Graph (logged in email_logs), writes an INVITE_SENT
//                     audit_logs entry. Rate-limited per inviter and per IP.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { validateCsrfProtection } from '@/lib/csrf-protection';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { EmailSchema } from '@/lib/validation';
import { sendEmail, escapeHtml } from '@/lib/email';
import { generateInviteToken, INVITE_TTL_DAYS } from '@/lib/invites';

export const dynamic = 'force-dynamic';

// GUID: API_INVITES_CREATE-002-v01
// [Intent] Per-inviter and per-IP invite budgets. Small hard caps because each invite can
//          mint a real account while public registration is closed — this endpoint is the
//          only self-serve door into the league.
// [Inbound Trigger] Referenced by the rate-limit checks in the POST handler.
// [Downstream Impact] Raising these increases the blast radius of a compromised member
//                     session; both limits are per-instance in-memory windows (LIB_RATE_LIMIT).
const INVITER_LIMIT = { limit: 5, windowMs: 24 * 60 * 60 * 1000 }; // 5 invites / inviter / day
const IP_LIMIT = { limit: 20, windowMs: 24 * 60 * 60 * 1000 };     // 20 invites / IP / day

interface CreateInviteRequest {
  email: string;
}

// GUID: API_INVITES_CREATE-003-v01
// [Intent] Build the welcoming invite email HTML: Prix Six branding (gradient header, F1
//          red CTA), the inviter's team name, what the league is, the hot link, a note that
//          Google/Apple sign-in works too, and the expiry window. All user-supplied strings
//          are escapeHtml()d. The standard Prix Six footer is appended by sendEmail().
// [Inbound Trigger] Called by the POST handler after the invite doc is created.
// [Downstream Impact] Rendering issues affect only this email type; the link format
//                     /signup?invite=<token> must match the /signup page's searchParams.
function buildInviteEmailHtml(inviterTeamName: string, inviteUrl: string): string {
  const safeTeam = escapeHtml(inviterTeamName);
  const safeUrl = escapeHtml(inviteUrl);
  return `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="margin: 0;">You&#039;re Invited to Prix Six! 🏁</h1>
    <p style="margin: 8px 0 0;">The F1 Prediction League</p>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <p>Hello,</p>
    <p><strong>${safeTeam}</strong> thinks you&#039;d be a great addition to <strong>Prix Six</strong> — our
    private fantasy Formula&nbsp;1 league. Around 20 of us pick six drivers before every Grand&nbsp;Prix,
    score points on how they finish, and battle it out in the standings (and the group chat) all season long.</p>
    <p>Joining takes about a minute: pick a team name, and you&#039;re on the grid for the next race.</p>
    <p style="text-align: center;">
      <a href="${safeUrl}" style="display: inline-block; background: #e10600; color: white; padding: 14px 36px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; font-size: 16px;">Join the League</a>
    </p>
    <p style="text-align: center; font-size: 13px; color: #666;">Prefer one-tap sign-in? The same link lets you join with your <strong>Google</strong> or <strong>Apple</strong> account.</p>
    <div style="background: #fff; padding: 15px 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #e10600;">
      <p style="margin: 0; font-size: 13px; color: #555;">This personal invite link is just for you and expires in <strong>${INVITE_TTL_DAYS} days</strong>. If the button doesn&#039;t work, copy this address into your browser:<br>
      <span style="word-break: break-all; font-size: 12px;">${safeUrl}</span></p>
    </div>
    <p>See you on track!</p>
    <p>- ${safeTeam} &amp; The Prix Six Team</p>
  </div>
</div>
  `.trim();
}

// GUID: API_INVITES_CREATE-001-v01
// [Intent] Main POST handler: CSRF + Bearer auth + rate limits, validates the friend's
//          email, refuses existing members, creates (or refreshes) the pending invite doc,
//          sends the invite email, and writes the INVITE_SENT audit entry.
// [Inbound Trigger] HTTP POST from the /invite page with { email } and a Bearer ID token.
// [Downstream Impact] On success a live invite token exists that can mint ONE account via
//                     the signup gates. Emits PX-2101 INVITE_SEND_FAILED and PX-2104
//                     INVITE_ALREADY_MEMBER; reuses PX-8005 RATE_LIMIT_EXCEEDED.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  const csrfError = validateCsrfProtection(request, correlationId);
  if (csrfError) {
    return csrfError;
  }

  try {
    const verifiedUser = await verifyAuthToken(request.headers.get('Authorization'));
    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', errorCode: ERRORS.AUTH_PERMISSION_DENIED.code, correlationId },
        { status: 401 }
      );
    }

    // Rate limits: per inviter uid, then per IP
    const uidLimit = checkRateLimit(`invite:uid:${verifiedUser.uid}`, INVITER_LIMIT);
    const ipLimit = checkRateLimit(`invite:ip:${getClientIp(request)}`, IP_LIMIT);
    if (!uidLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(uidLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      return NextResponse.json(
        {
          success: false,
          error: 'Invite limit reached — try again tomorrow.',
          errorCode: ERRORS.RATE_LIMIT_EXCEEDED.code,
          correlationId,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const data: CreateInviteRequest = await request.json();
    const parsedEmail = EmailSchema.safeParse((data.email ?? '').toLowerCase().trim());
    if (!parsedEmail.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please enter a valid email address.',
          errorCode: ERRORS.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }
    const friendEmail = parsedEmail.data;

    const { db, FieldValue } = await getFirebaseAdmin();

    // The inviter must be a real member — also gives us their team name for the email.
    const inviterDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!inviterDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Forbidden', errorCode: ERRORS.AUTH_PERMISSION_DENIED.code, correlationId },
        { status: 403 }
      );
    }
    const inviterTeamName: string = inviterDoc.data()?.teamName || 'A Prix Six player';

    // GUID: API_INVITES_CREATE-004-v01
    // [Intent] Refuse invites to emails that already belong to a member — avoids confusing
    //          duplicate-account attempts and leaks no more than the inviter typing a
    //          friend's address already knows.
    // [Inbound Trigger] After email validation.
    // [Downstream Impact] Returns 409 PX-2104. Case-normalised to match users.email storage.
    const existingUser = await db.collection('users').where('email', '==', friendEmail).limit(1).get();
    if (!existingUser.empty) {
      return NextResponse.json(
        {
          success: false,
          error: 'That email already belongs to a Prix Six player — tell them to log in!',
          errorCode: ERRORS.INVITE_ALREADY_MEMBER.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // GUID: API_INVITES_CREATE-005-v01
    // [Intent] Reuse an existing pending invite from this inviter to this email (refreshing
    //          its expiry) instead of minting a new token — resending is idempotent and
    //          keeps at most one live token per inviter/friend pair.
    // [Inbound Trigger] After the already-member check.
    // [Downstream Impact] Equality-only query (no composite index needed). New expiresAt
    //                     extends the link's life by INVITE_TTL_DAYS from now.
    const now = Date.now();
    const expiresAt = new Date(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    let token: string;
    const existingInvite = await db.collection('invites')
      .where('email', '==', friendEmail)
      .where('invitedByUid', '==', verifiedUser.uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingInvite.empty) {
      token = existingInvite.docs[0].id;
      await existingInvite.docs[0].ref.update({ expiresAt, resentAt: FieldValue.serverTimestamp() });
    } else {
      token = generateInviteToken();
      await db.collection('invites').doc(token).set({
        email: friendEmail,
        invitedByUid: verifiedUser.uid,
        invitedByTeamName: inviterTeamName,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        correlationId,
      });
    }

    const baseUrl = request.headers.get('origin') || 'https://prix6.win';
    const inviteUrl = `${baseUrl}/signup?invite=${token}`;

    const emailResult = await sendEmail({
      toEmail: friendEmail,
      subject: `${inviterTeamName} has invited you to Prix Six — the F1 Prediction League 🏎️`,
      htmlContent: buildInviteEmailHtml(inviterTeamName, inviteUrl),
    });

    if (!emailResult.success) {
      // Invite doc stays pending — a retry reuses the same token and just resends.
      const traced = createTracedError(ERRORS.INVITE_SEND_FAILED, {
        correlationId,
        context: { friendEmail, inviterUid: verifiedUser.uid, emailError: emailResult.error },
      });
      await logTracedError(traced);
      return NextResponse.json(
        {
          success: false,
          error: 'We could not send the invite email. Please try again shortly.',
          errorCode: ERRORS.INVITE_SEND_FAILED.code,
          correlationId,
        },
        { status: 502 }
      );
    }

    await db.collection('audit_logs').add({
      userId: verifiedUser.uid,
      action: 'INVITE_SENT',
      details: {
        inviteeEmail: friendEmail,
        inviterTeamName,
        expiresAt: expiresAt.toISOString(),
        reused: !existingInvite.empty,
        correlationId,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: `Invite sent to ${friendEmail}`,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      correlationId,
    });
  } catch (error: any) {
    const traced = createTracedError(ERRORS.INVITE_SEND_FAILED, {
      correlationId,
      cause: error,
    });
    await logTracedError(traced);
    return NextResponse.json(
      {
        success: false,
        error: 'Invite could not be sent.',
        errorCode: ERRORS.INVITE_SEND_FAILED.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
