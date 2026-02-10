// GUID: LIB_CSRF-000-v01
// @SECURITY_FIX: CSRF protection utility for authentication endpoints (GEMINI-005).
// [Intent] Provides Origin/Referer validation middleware to prevent cross-site request forgery attacks.
// [Inbound Trigger] Called by authentication API routes before processing state-changing operations.
// [Downstream Impact] Rejects requests from untrusted origins. Returns 403 for CSRF attempts.

import { NextRequest, NextResponse } from 'next/server';

// GUID: LIB_CSRF-001-v01
// [Intent] List of allowed origins for CSRF protection.
// [Inbound Trigger] Checked against Origin/Referer headers in validateCsrfProtection().
// [Downstream Impact] Adding/removing origins affects which domains can call auth endpoints.
const ALLOWED_ORIGINS = [
  'https://prix6.win',
  'https://www.prix6.win',
  'http://localhost:3000',
  'http://localhost:9002', // Dev server port
];

// Add Vercel preview URLs if in preview environment
if (process.env.VERCEL_URL) {
  ALLOWED_ORIGINS.push(`https://${process.env.VERCEL_URL}`);
}

// GUID: LIB_CSRF-002-v01
// [Intent] Validates that the request Origin or Referer header matches an allowed domain.
//          Prevents CSRF attacks by rejecting cross-origin requests from malicious sites.
// [Inbound Trigger] Called at the start of auth endpoint handlers before processing credentials.
// [Downstream Impact] Returns null if valid, or NextResponse with 403 if CSRF attempt detected.
/**
 * Validates CSRF protection by checking Origin/Referer headers
 * @param request - Next.js request object
 * @param correlationId - Correlation ID for error tracking
 * @returns null if valid, or NextResponse with 403 error if CSRF detected
 */
export function validateCsrfProtection(
  request: NextRequest,
  correlationId: string
): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // GUID: LIB_CSRF-003-v01
  // [Intent] Extract the origin from Referer header if Origin header is missing.
  // [Inbound Trigger] When Origin header is not present (some browsers/tools).
  // [Downstream Impact] Ensures CSRF protection works even without Origin header.
  let requestOrigin: string | null = origin;
  if (!requestOrigin && referer) {
    try {
      const refererUrl = new URL(referer);
      requestOrigin = refererUrl.origin;
    } catch {
      // Invalid referer URL
      requestOrigin = null;
    }
  }

  // GUID: LIB_CSRF-004-v01
  // [Intent] Reject requests without Origin or Referer headers (potential CSRF).
  // [Inbound Trigger] When both headers are missing from the request.
  // [Downstream Impact] Blocks anonymous/automated requests without origin information.
  if (!requestOrigin) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing origin information',
        correlationId,
      },
      { status: 403 }
    );
  }

  // GUID: LIB_CSRF-005-v01
  // [Intent] Validate that the request origin matches one of the allowed origins.
  // [Inbound Trigger] After extracting origin from Origin or Referer header.
  // [Downstream Impact] Rejects requests from untrusted domains, preventing CSRF.
  const isAllowed = ALLOWED_ORIGINS.some(allowed => {
    if (requestOrigin === allowed) return true;

    // Also check if origin starts with allowed (for subdomains)
    if (allowed.startsWith('https://') && requestOrigin?.startsWith(allowed)) {
      return true;
    }

    return false;
  });

  if (!isAllowed) {
    console.warn(`[CSRF] Blocked request from untrusted origin: ${requestOrigin}`);
    return NextResponse.json(
      {
        success: false,
        error: 'Request origin not allowed',
        correlationId,
      },
      { status: 403 }
    );
  }

  // Valid origin - allow request to proceed
  return null;
}
