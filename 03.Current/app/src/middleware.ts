import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // CSRF protection for state-changing requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');

    // Only check when Origin header is present (browsers send it for cross-origin requests)
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
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
