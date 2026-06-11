// GUID: LIB_RATE_LIMIT-000-v01
// [Intent] Reusable in-memory, per-key fixed-window rate limiter for public/unauthenticated
//          API routes. Deliberately in-memory (module-level Map) rather than Firestore-backed:
//          the endpoints this protects are exactly the ones an attacker floods, so adding a
//          Firestore read/write per request would AMPLIFY the denial-of-wallet vector it is meant
//          to close (SEC-DOS-001). In-memory state is per-instance and resets on cold start, which
//          is acceptable for coarse abuse throttling — App Hosting fans out to few instances and a
//          flood from a single IP still hits the same instance's limiter under load.
// [Inbound Trigger] Imported by API route handlers that need coarse abuse protection
//                   (first user: /api/team-name-suggestions).
// [Downstream Impact] No external dependencies. Memory is bounded by periodic sweep of expired keys.
//                     Returning { allowed: false } causes the caller to respond HTTP 429.

import type { NextRequest } from 'next/server';

// GUID: LIB_RATE_LIMIT-001-v01
// [Intent] Per-key window state: when the current window started and how many hits it has seen.
// [Inbound Trigger] Stored in the module-level buckets Map, keyed by `${name}:${ip}`.
// [Downstream Impact] Mutated in place by checkRateLimit on every call.
interface WindowState {
  windowStart: number;
  count: number;
}

// GUID: LIB_RATE_LIMIT-002-v01
// [Intent] Module-level store of window state. Persists for the lifetime of the server instance.
// [Inbound Trigger] Read and written by checkRateLimit.
// [Downstream Impact] Bounded by sweepExpired(); never grows without limit.
const buckets = new Map<string, WindowState>();

// GUID: LIB_RATE_LIMIT-003-v01
// [Intent] Hard cap on distinct tracked keys. If exceeded, a sweep runs to drop expired windows
//          before inserting new ones — a backstop against memory exhaustion from IP-spoofed floods.
// [Inbound Trigger] Compared against buckets.size inside checkRateLimit.
// [Downstream Impact] Prevents the limiter itself from becoming a memory-DoS vector.
const MAX_TRACKED_KEYS = 50_000;

// GUID: LIB_RATE_LIMIT-004-v01
// [Intent] Remove window entries whose window has fully elapsed, freeing memory.
// [Inbound Trigger] Called lazily from checkRateLimit when the key count crosses MAX_TRACKED_KEYS.
// [Downstream Impact] Mutates the buckets Map. O(n) over tracked keys; only runs under pressure.
function sweepExpired(now: number, windowMs: number): void {
  for (const [key, state] of buckets) {
    if (now - state.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

// GUID: LIB_RATE_LIMIT-005-v01
// [Intent] Derive the originating client IP from proxy/CDN headers in priority order. Mirrors the
//          convention used by getClientIP in api/leagues/join-by-code/route.ts so abuse keys are
//          consistent across endpoints.
// [Inbound Trigger] Called by route handlers to produce the rate-limit key.
// [Downstream Impact] Returns 'unknown' when no header is present (local/dev); all such callers
//                     then share one bucket, which is acceptable for abuse throttling.
export function getClientIp(req: NextRequest): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0].trim();
  return 'unknown';
}

// GUID: LIB_RATE_LIMIT-006-v01
// [Intent] Result of a rate-limit check. retryAfterSeconds is set only when blocked, for the
//          HTTP Retry-After header.
// [Inbound Trigger] Returned by checkRateLimit.
// [Downstream Impact] Callers branch on `allowed`; build 429 responses from the other fields.
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
}

// GUID: LIB_RATE_LIMIT-007-v01
// [Intent] Fixed-window per-key rate limit. Increments the key's hit count within the current
//          window; when the window elapses it resets. Returns whether the request is allowed.
// [Inbound Trigger] Called at the top of a protected route handler with a stable key (typically
//                   `${routeName}:${clientIp}`).
// [Downstream Impact] When allowed=false the caller returns HTTP 429 with ERRORS.RATE_LIMIT_EXCEEDED.
//                     Fail-open is NOT applicable here — the limiter cannot throw (pure in-memory).
export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) {
    sweepExpired(now, windowMs);
  }

  const state = buckets.get(key);

  // No window yet, or the previous window has fully elapsed → start a fresh window.
  if (!state || now - state.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: limit - 1, limit, retryAfterSeconds: 0 };
  }

  // Within the active window.
  if (state.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - state.windowStart)) / 1000));
    return { allowed: false, remaining: 0, limit, retryAfterSeconds };
  }

  state.count += 1;
  return { allowed: true, remaining: limit - state.count, limit, retryAfterSeconds: 0 };
}
