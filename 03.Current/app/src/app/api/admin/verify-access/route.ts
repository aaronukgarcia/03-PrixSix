// GUID: API_ADMIN_VERIFY_ACCESS-000-v01
// [Intent] API route for verifying admin access via a token-based magic link.
//          Validates the token, checks expiry and re-use, marks as used, and logs audit event.
// [Inbound Trigger] POST request from /admin/verify page when user clicks magic link.
// [Downstream Impact] Marks token as used in admin_verification_tokens, writes audit_logs.
//                     Resolves ADMINCOMP-003 admin verification requirement.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';

// GUID: API_ADMIN_VERIFY_ACCESS-001-v01
// [Intent] POST handler that validates admin verification token (constant-time comparison),
//          checks expiry and re-use, verifies admin status, marks token as used, and logs audit.
// [Inbound Trigger] POST /api/admin/verify-access with JSON body containing token and uid.
// [Downstream Impact] Updates admin_verification_tokens/{uid} (used=true), writes audit_logs.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { token, uid } = body;

    // GUID: API_ADMIN_VERIFY_ACCESS-002-v01
    // [Intent] Validate that both required fields (token and uid) are present.
    // [Inbound Trigger] Missing token or uid in request body.
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS.
    if (!token || !uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: token and uid',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // GUID: API_ADMIN_VERIFY_ACCESS-003-v01
    // [Intent] Retrieve verification token document and perform security checks:
    //          existence, constant-time comparison, re-use check, expiry check.
    // [Inbound Trigger] Valid token and uid provided.
    // [Downstream Impact] Returns 400 for invalid/expired/used tokens.
    const tokenRef = db.collection('admin_verification_tokens').doc(uid);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid verification link',
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const tokenData = tokenDoc.data();

    if (!tokenData) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid verification link',
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if token matches (constant-time comparison to prevent timing attacks)
    if (!crypto.timingSafeEqual(Buffer.from(tokenData.token), Buffer.from(token))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid verification link',
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if already used
    if (tokenData.used) {
      return NextResponse.json(
        {
          success: false,
          error: 'Verification link already used',
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if expired
    const now = new Date();
    const expiresAt = tokenData.expiresAt.toDate();
    if (now > expiresAt) {
      return NextResponse.json(
        {
          success: false,
          error: 'Verification link expired. Please request a new one.',
          errorCode: ERROR_CODES.AUTH_SESSION_EXPIRED.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_VERIFY_ACCESS-004-v01
    // [Intent] Verify the user still has admin privileges.
    // [Inbound Trigger] Token is valid and not expired.
    // [Downstream Impact] Returns 403 if user is no longer an admin.
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Admin privileges revoked',
          errorCode: ERROR_CODES.AUTH_ADMIN_REQUIRED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    const userData = userDoc.data();

    // GUID: API_ADMIN_VERIFY_ACCESS-005-v01
    // [Intent] Mark the token as used to prevent replay attacks.
    // [Inbound Trigger] All validation checks passed.
    // [Downstream Impact] Updates admin_verification_tokens/{uid}.used = true.
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // GUID: API_ADMIN_VERIFY_ACCESS-006-v01
    // [Intent] Log successful admin verification to audit log.
    // [Inbound Trigger] Token marked as used.
    // [Downstream Impact] Writes to audit_logs collection.
    await db.collection('audit_logs').add({
      timestamp: Timestamp.now(),
      userId: uid,
      email: userData?.email || tokenData.email,
      action: 'ADMIN_VERIFICATION_SUCCESS',
      metadata: {
        teamName: userData?.teamName,
        tokenCreatedAt: tokenData.createdAt,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
      },
      correlationId,
    });

    // GUID: API_ADMIN_VERIFY_ACCESS-007-v03
    // [Intent] Set httpOnly adminVerified cookie to grant admin panel access.
    //          Server Component reads this cookie securely - no client-readable cookie needed.
    // [Inbound Trigger] All verification checks passed, audit logged.
    // [Downstream Impact] httpOnly cookie prevents XSS manipulation. Server Component wrapper
    //                     reads cookie and passes verification status to client component.
    //                     Cookie expires in 24 hours for security.
    const response = NextResponse.json({
      success: true,
      message: 'Admin access verified successfully',
      correlationId,
    });

    // Set secure HTTP-only cookie (24 hour expiry) - server-side only
    // SECURITY: httpOnly=true prevents JavaScript access, stopping XSS-based bypass attacks
    response.cookies.set('adminVerified', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    });

    return response;

  } catch (error: any) {
    console.error('Admin verification error:', error);

    // GOLDEN RULE #1: Log error to error_logs collection
    const { db } = await getFirebaseAdmin();
    await db.collection('error_logs').add({
      timestamp: Timestamp.now(),
      correlationId,
      errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
      errorMessage: error.message || 'Internal server error',
      context: {
        endpoint: '/api/admin/verify-access',
        method: 'POST',
        stack: error.stack,
      },
      severity: 'high',
    }).catch(() => {}); // Silent fail on logging error

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
