// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST
// Auth:        Firebase Auth bearer token + isAdmin check
// Reads:       users (lookup by userId)
// Writes:      users (mustChangePin=true), Firebase Auth (new PIN password), email_logs, audit_logs
// Errors:      401 (unauthenticated), 403 (not admin), 400 (missing userId), 404 (user not found), 500
// Idempotent:  NO — generates a new PIN and sends an email on every call
// Side-effects: Changes the user's Firebase Auth password; sends email via Microsoft Graph
// ──────────────────────────────────────────────────────────────────
// GUID: API_ADMIN_RESEND_WELCOME-000-v01
// [Intent] Admin-only endpoint that generates a fresh 6-digit PIN for a user, updates their
//          Firebase Auth password, sets mustChangePin=true, and sends a welcome email via
//          Microsoft Graph. Used when a user never received or lost their original welcome email.
// [Inbound Trigger] POST from the TeamManager "Resend Welcome Email" button in the admin UI.
// [Downstream Impact] User's Firebase Auth password changes immediately; they must use the new
//          PIN on next login and will be prompted to change it. Email is sent via sendWelcomeEmail
//          (Microsoft Graph). Writes to email_logs and audit_logs for admin audit trail.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { sendWelcomeEmail } from '@/lib/email';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_RESEND_WELCOME-001-v01
// [Intent] POST handler — verifies admin auth, looks up the user by userId, generates a new
//          6-digit PIN, updates Firebase Auth, sets mustChangePin, and sends a welcome email.
// [Inbound Trigger] HTTP POST with JSON body { userId: string }.
// [Downstream Impact] User's PIN changes; welcome email sent via Microsoft Graph.
export async function POST(request: NextRequest) {
    const correlationId = generateCorrelationId();

    try {
        // Auth: verify Firebase token
        const authHeader = request.headers.get('Authorization');
        const verifiedUser = await verifyAuthToken(authHeader);
        if (!verifiedUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const { db, FieldValue } = await getFirebaseAdmin();
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth();

        // Auth: verify admin status
        const callerDoc = await db.collection('users').doc(verifiedUser.uid).get();
        if (!callerDoc.exists || !callerDoc.data()?.isAdmin) {
            return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
        }

        const { userId } = await request.json();
        if (!userId) {
            return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
        }

        // Look up target user
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
        }

        const userData = userDoc.data()!;
        const toEmail = userData.email as string;
        const teamName = userData.teamName as string;

        // Generate new cryptographically secure 6-digit PIN
        const newPin = crypto.randomInt(100000, 1000000).toString();

        // Update Firebase Auth password
        await auth.updateUser(userId, { password: newPin });

        // Set mustChangePin so user is prompted to set their own PIN on next login
        await userDoc.ref.update({ mustChangePin: true, updatedAt: FieldValue.serverTimestamp() });

        // Send welcome email via Microsoft Graph
        const emailResult = await sendWelcomeEmail({ toEmail, teamName, pin: newPin });

        // Audit log
        await db.collection('audit_logs').add({
            userId: verifiedUser.uid,
            action: 'admin_resend_welcome_email',
            details: {
                targetUserId: userId,
                targetEmail: toEmail,
                teamName,
                emailGuid: emailResult.emailGuid,
                emailSuccess: emailResult.success,
                queued: emailResult.queued ?? false,
            },
            timestamp: FieldValue.serverTimestamp(),
        });

        if (!emailResult.success && !emailResult.queued) {
            return NextResponse.json({
                success: false,
                error: 'PIN reset succeeded but email failed to send. Check email logs.',
                correlationId,
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            queued: emailResult.queued ?? false,
            emailGuid: emailResult.emailGuid,
            correlationId,
        });

    } catch (error: any) {
        const { db: errorDb } = await getFirebaseAdmin();
        const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
            correlationId,
            context: { route: '/api/admin/resend-welcome-email', action: 'POST' },
            cause: error instanceof Error ? error : undefined,
        });
        await logTracedError(traced, errorDb);
        return NextResponse.json({
            success: false,
            error: traced.definition.message,
            errorCode: traced.definition.code,
            correlationId: traced.correlationId,
        }, { status: 500 });
    }
}
