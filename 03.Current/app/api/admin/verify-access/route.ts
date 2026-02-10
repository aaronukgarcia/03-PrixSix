/**
 * POST /api/admin/verify-access
 *
 * GUID: API_ADMIN_VERIFY-001-v03
 * [Intent] Verify Admin Hot Link token and upgrade session to grant admin panel access.
 *          Implements single-use token consumption, 10-minute expiry enforcement, and
 *          comprehensive audit logging. Sets session-level adminVerified claim.
 * [Inbound Trigger] User clicks magic link from email → /admin/verify page → POST here.
 * [Downstream Impact] Consumes token (single-use), sets adminVerified session cookie,
 *                     logs successful/failed attempts. Resolves ADMINCOMP-003.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminFirestore } from '@/lib/firebase-admin';
import { AdminHotLinkSchema, generateSecureCorrelationId } from '@/lib/validation';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { cookies } from 'next/headers';

/**
 * Helper: Extract client IP from request headers
 */
function getClientIP(request: NextRequest): string {
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  const xForwarded = request.headers.get('x-forwarded-for');
  if (xForwarded) return xForwarded.split(',')[0].trim();

  const xRealIP = request.headers.get('x-real-ip');
  if (xRealIP) return xRealIP;

  return 'unknown';
}

export async function POST(request: NextRequest) {
  const correlationId = generateSecureCorrelationId('admin_verify');
  const db = adminFirestore;

  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const result = AdminHotLinkSchema.safeParse(body);

    if (!result.success) {
      throw createTracedError(ERRORS.INVALID_INPUT, {
        correlationId,
        context: { errors: result.error.format() }
      });
    }

    const { token, email } = result.data;

    // 2. Fetch token from admin_challenges collection
    const challengeRef = db.collection('admin_challenges').doc(token);
    const challengeDoc = await challengeRef.get();

    if (!challengeDoc.exists) {
      throw createTracedError(ERRORS.AUTH_INVALID_TOKEN, {
        correlationId,
        context: { email }
      });
    }

    const challengeData = challengeDoc.data();

    // 3. Verify ownership (email must match)
    if (challengeData?.email !== email) {
      // Log potential attack attempt
      console.warn({
        message: 'ADMIN_TOKEN_OWNERSHIP_MISMATCH',
        correlationId,
        requestedEmail: email,
        tokenEmail: challengeData?.email,
        timestamp: new Date().toISOString(),
        severity: 'WARNING',
      });

      throw createTracedError(ERRORS.AUTH_UNAUTHORIZED, {
        correlationId,
        context: { reason: 'Email mismatch' }
      });
    }

    // 4. Verify expiry (10-minute TTL)
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    if (now > challengeData.expiresAt) {
      // Clean up expired token
      await challengeRef.delete();

      throw createTracedError(ERRORS.AUTH_TOKEN_EXPIRED, {
        correlationId,
        context: {
          expiredAt: new Date(challengeData.expiresAt).toISOString(),
          now: new Date(now).toISOString()
        }
      });
    }

    // 5. Consume token (single-use - delete immediately)
    await challengeRef.delete();

    // 6. Set adminVerified session cookie (httpOnly, secure, sameSite)
    const cookieStore = cookies();
    const adminVerifiedCookie = {
      name: 'adminVerified',
      value: 'true',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 4, // 4 hours
      path: '/admin',
    };

    // Note: cookies() from next/headers is async in App Router
    cookieStore.set(adminVerifiedCookie);

    // 7. Update user document with adminVerifiedAt timestamp
    const userId = challengeData.userId;
    await db.collection('users').doc(userId).update({
      adminVerifiedAt: now,
      lastAdminAccess: now,
    });

    // 8. Log successful verification
    const ipAddress = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';

    console.log({
      message: 'ADMIN_ACCESS_GRANTED',
      correlationId,
      userId,
      email,
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString(),
      severity: 'INFO',
    });

    // 9. Log to audit_logs collection
    await db.collection('audit_logs').add({
      userId,
      action: 'ADMIN_ACCESS_VERIFIED',
      email,
      correlationId,
      ipAddress,
      userAgent,
      timestamp: now,
      metadata: {
        tokenCreatedAt: challengeData.createdAt,
        tokenExpiresAt: challengeData.expiresAt,
        verifiedAt: now,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Admin access verified. Redirecting to admin panel...',
      redirectTo: '/admin',
      correlationId,
    });

  } catch (error) {
    // Log error with correlation ID
    await logTracedError(error as Error, db);

    // Log failed verification attempt
    const ipAddress = getClientIP(request);
    const userAgent = request.headers.get('user-agent') || 'unknown';

    console.error({
      message: 'ADMIN_VERIFICATION_FAILED',
      correlationId,
      error: (error as Error).message,
      ipAddress,
      userAgent,
      timestamp: new Date().toISOString(),
      severity: 'ERROR',
    });

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
        error: (tracedError as any).message || 'Verification failed',
        errorCode: (tracedError as any).code || 'PX-9999',
        correlationId,
      },
      { status: (tracedError as any).status || 500 }
    );
  }
}
