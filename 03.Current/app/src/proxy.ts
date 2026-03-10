// GUID: MIDDLEWARE-000-v03
// @SECURITY_FIX (GEMINI-AUDIT-074): Documented CSRF posture and known limitations.
// [Intent] Next.js Edge middleware enforcing CSRF origin checks on state-changing API requests
//          and setting baseline security response headers.
// [CSRF Posture]
//   Current implementation: origin/host header comparison for cross-origin CSRF prevention.
//   Known limitation: same-origin XSS attacks bypass origin checks — the browser sends a
//   matching Origin header from the same origin, so the check passes.
//   Why additional CSRF tokens are not implemented:
//     1. All auth uses httpOnly SameSite=Strict Firebase ID tokens in Authorization Bearer headers.
//        A cross-origin CSRF attacker cannot read the ID token (Same-Origin Policy), so cannot
//        forge a valid Authorization header. Bearer token = primary CSRF defence for this API.
//     2. Adding synchroniser-token CSRF requires server-side session state which does not exist
//        in this stateless Next.js/Firebase architecture.
//   Residual risk: XSS-driven same-origin CSRF. Primary mitigations: CSP, escapeHtml(),
//   React JSX default escaping, DOMPurify on dangerouslySetInnerHTML.
//   Conclusion: origin-check + SameSite=Strict + Bearer token is appropriate for this architecture.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // CSRF protection for state-changing requests (see GUID block above for full posture)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');

    // Only check when Origin header is present (browsers send it for cross-origin requests)
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        // Check X-Forwarded-Host for reverse proxy/cloud environments (Firebase App Hosting, Cloud Run)
        const forwardedHost = request.headers.get('x-forwarded-host');
        if (originHost !== host && originHost !== forwardedHost) {
          return new NextResponse(JSON.stringify({ error: 'CSRF check failed' }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'X-Content-Type-Options': 'nosniff',
              'X-Frame-Options': 'DENY',
            },
          });
        }
      } catch {
        return new NextResponse(JSON.stringify({ error: 'Invalid origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const response = NextResponse.next();

  // Security response headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Vary', 'Origin');

  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
