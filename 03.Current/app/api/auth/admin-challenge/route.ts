/**
 * POST /api/auth/admin-challenge
 *
 * GUID: API_ADMIN_CHALLENGE-001-v03
 * [Intent] Generate and send Admin Hot Link (Magic Link) for admin panel access.
 *          Only authenticated admin users can request a challenge link. Implements
 *          defensive rate limiting and audit logging to prevent abuse.
 * [Inbound Trigger] Admin user clicks "Access Admin Panel" button.
 * [Downstream Impact] Creates temporary token in admin_challenges collection,
 *                     sends email with magic link, logs attempt to audit trail.
 *                     Resolves ADMINCOMP-003 (client-side admin bypass).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminFirestore } from '@/lib/firebase-admin';
import {
  AdminChallengeRequestSchema,
  generateSecureToken,
  generateSecureCorrelationId,
  ADMIN_CHALLENGE_RATE_LIMITS
} from '@/lib/validation';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { sendEmail } from '@/lib/email';

/**
 * Helper: Extract client IP from request headers
 */
function getClientIP(request: NextRequest): string {
  // Try Cloudflare header first
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  // Try X-Forwarded-For
  const xForwarded = request.headers.get('x-forwarded-for');
  if (xForwarded) return xForwarded.split(',')[0].trim();

  // Try X-Real-IP
  const xRealIP = request.headers.get('x-real-ip');
  if (xRealIP) return xRealIP;

  // Fallback
  return 'unknown';
}

/**
 * Helper: Check rate limits for admin challenge requests
 */
async function checkRateLimit(
  db: FirebaseFirestore.Firestore,
  userId: string,
  email: string
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);

  // Check per-user rate limit
  const userChallengesRef = db.collection('admin_challenge_attempts')
    .where('userId', '==', userId)
    .where('createdAt', '>', oneHourAgo);

  const userSnapshot = await userChallengesRef.get();

  if (userSnapshot.size >= ADMIN_CHALLENGE_RATE_LIMITS.perUserPerHour) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${ADMIN_CHALLENGE_RATE_LIMITS.perUserPerHour} requests per hour`
    };
  }

  // Check global rate limit
  const globalChallengesRef = db.collection('admin_challenge_attempts')
    .where('createdAt', '>', oneHourAgo);

  const globalSnapshot = await globalChallengesRef.get();

  if (globalSnapshot.size >= ADMIN_CHALLENGE_RATE_LIMITS.globalPerHour) {
    return {
      allowed: false,
      reason: 'System rate limit exceeded. Please try again later.'
    };
  }

  return { allowed: true };
}

/**
 * Helper: Generate magic link email HTML
 */
function generateMagicLinkEmail(email: string, token: string, baseUrl: string): string {
  // URL-encode the token to prevent EMAIL-002 (URL injection)
  const encodedToken = encodeURIComponent(token);
  const verifyUrl = `${baseUrl}/admin/verify?token=${encodedToken}&email=${encodeURIComponent(email)}`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #e10600;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin: 20px 0;
        }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Prix Six Admin Access</h2>
        <p>You requested access to the Prix Six admin panel.</p>
        <p>Click the button below to verify your identity and access the admin panel:</p>
        <p>
          <a href="${verifyUrl}" class="button">Access Admin Panel</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; font-size: 12px; color: #666;">${verifyUrl}</p>
        <p><strong>This link expires in 10 minutes.</strong></p>
        <p>If you did not request this, please ignore this email.</p>
        <div class="footer">
          <p>Prix Six Admin System</p>
          <p>This is an automated message. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function POST(request: NextRequest) {
  const correlationId = generateSecureCorrelationId('admin_challenge');
  const db = adminFirestore;

  try {
    // 1. Verify Firebase Auth token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createTracedError(ERRORS.AUTH_MISSING_TOKEN, { correlationId });
    }

    const token = authHeader.substring(7);
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    // 2. Verify user is admin
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      throw createTracedError(ERRORS.AUTH_USER_NOT_FOUND, { correlationId });
    }

    const userData = userDoc.data();
    const isAdmin = userData?.isAdmin === true;

    if (!isAdmin) {
      throw createTracedError(ERRORS.AUTH_INSUFFICIENT_PERMISSIONS, {
        correlationId,
        context: { userId, email: userData?.email }
      });
    }

    const email = userData.email;

    // 3. Check rate limits
    const rateLimitCheck = await checkRateLimit(db, userId, email);
    if (!rateLimitCheck.allowed) {
      throw createTracedError(ERRORS.RATE_LIMIT_EXCEEDED, {
        correlationId,
        context: { reason: rateLimitCheck.reason }
      });
    }

    // 4. Generate secure token
    const challengeToken = generateSecureToken(32); // 64-char hex string
    const now = Date.now();
    const expiresAt = now + (10 * 60 * 1000); // 10 minutes

    const ipAddress = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // 5. Store challenge token
    await db.collection('admin_challenges').doc(challengeToken).set({
      token: challengeToken,
      email,
      userId,
      createdAt: now,
      expiresAt,
      status: 'pending',
      correlationId,
      ipAddress,
      userAgent,
    });

    // 6. Log rate limit attempt
    await db.collection('admin_challenge_attempts').add({
      userId,
      email,
      createdAt: now,
      correlationId,
      ipAddress,
      userAgent,
    });

    // 7. Send magic link email
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://prix6.win';
    const emailHtml = generateMagicLinkEmail(email, challengeToken, baseUrl);

    await sendEmail(
      email,
      'Prix Six Admin Access - Verify Your Identity',
      emailHtml
    );

    // 8. Log successful challenge generation
    console.log({
      message: 'ADMIN_CHALLENGE_SENT',
      correlationId,
      userId,
      email,
      timestamp: new Date().toISOString(),
      severity: 'INFO',
    });

    return NextResponse.json({
      success: true,
      message: 'Magic link sent to your email. Please check your inbox.',
      expiresInMinutes: 10,
      correlationId,
    });

  } catch (error) {
    // Log error with correlation ID
    await logTracedError(error as Error, db);

    // Return standardized error response
    const tracedError = error instanceof Error
      ? createTracedError(ERRORS.INTERNAL_ERROR, {
          correlationId,
          originalError: error
        })
      : error;

    return NextResponse.json(
      {
        success: false,
        error: (tracedError as any).message || 'Internal server error',
        errorCode: (tracedError as any).code || 'PX-9999',
        correlationId,
      },
      { status: (tracedError as any).status || 500 }
    );
  }
}
