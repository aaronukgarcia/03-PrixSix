// GUID: LIB_CSRF-000-v02
// @SECURITY_FIX: CSRF protection utility for authentication endpoints (GEMINI-005).
// @SECURITY_FIX: Replaced prefix/substring origin match with exact allowlist check to prevent
//   subdomain/prefix bypass attacks where 'https://prix6.win.evil.com' would match
//   'https://prix6.win' via startsWith (GEMINI-AUDIT-108).
// [Intent] Provides Origin/Referer validation middleware to prevent cross-site request forgery attacks.
// [Inbound Trigger] Called by authentication API routes before processing state-changing operations.
// [Downstream Impact] Rejects requests from untrusted origins. Returns 403 for CSRF attempts.

import { NextRequest, NextResponse } from 'next/server';

// GUID: LIB_CSRF-001-v02
// @SECURITY_FIX: Allowlist now uses exact equality only — no prefix/substring match (GEMINI-AUDIT-108).
// [Intent] Explicit allowlist of trusted origins for CSRF protection. Each entry is matched with
//          strict equality (===) only; no prefix, substring, or wildcard matching is performed.
//          This prevents attackers from bypassing checks with domains like
//          'https://prix6.win.evil.com' or 'https://evil-prix6.win.com'.
// [Inbound Trigger] Checked against Origin/Referer headers in validateCsrfProtection().
// [Downstream Impact] Adding/removing origins affects which domains can call auth endpoints.
//          To add a new allowed origin, append the exact origin string — never use a prefix.
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

// GUID: LIB_CSRF-002-v02
// @SECURITY_FIX: Origin validation now uses exact allowlist match only (GEMINI-AUDIT-108).
// [Intent] Validates that the request Origin or Referer header exactly matches an allowed domain.
//          Prevents CSRF attacks by rejecting cross-origin requests from malicious sites.
//          SECURITY: Origin comparison is strict equality (===). The previous prefix-match
//          branch has been removed — it allowed bypass via 'https://prix6.win.evil.com'.
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

  // GUID: LIB_CSRF-005-v02
  // @SECURITY_FIX: Exact allowlist match only — removed insecure startsWith prefix check
  //   that allowed bypass via 'https://prix6.win.evil.com' (GEMINI-AUDIT-108).
  // [Intent] Validate that the request origin exactly matches one of the allowed origins.
  //          Only strict equality (===) is used. No prefix, substring, or regex matching.
  // [Inbound Trigger] After extracting origin from Origin or Referer header.
  // [Downstream Impact] Rejects requests from untrusted domains, preventing CSRF.
  //          Attack vector closed: 'https://prix6.win.evil.com'.startsWith('https://prix6.win')
  //          was true under the old code — it is no longer evaluated.
  const isAllowed = ALLOWED_ORIGINS.includes(requestOrigin);

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
