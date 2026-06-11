// GUID: API_TEAM_NAME_SUGGESTIONS-000-v02
// @SECURITY_FIX (SEC-DOS-001): This public, unauthenticated endpoint previously ran a full
//   `users` collection scan on EVERY request with no rate limiting — a denial-of-wallet / DoS
//   vector (Firestore reads scale with both request rate and user count). Two mitigations added:
//   (1) per-IP fixed-window rate limit via lib/rate-limit.ts → HTTP 429 on flood;
//   (2) module-level TTL cache of existing team names → at most one collection scan per
//       CACHE_TTL_MS per instance instead of one per request.
// [Intent] Public GET endpoint that returns 50 shuffled F1-themed team name suggestions,
//          filtered against existing team names (both primary and secondary) in Firestore.
// [Inbound Trigger] Fetched by signup and complete-profile pages on mount.
// [Downstream Impact] Powers the dynamic team name suggestion UI. No auth required since
//                     the signup page is public; abuse is bounded by rate limit + cache.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { generateSuggestions } from '@/lib/team-name-suggestions';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// GUID: API_TEAM_NAME_SUGGESTIONS-002-v01
// [Intent] Per-IP rate limit budget for this endpoint. 30 requests/minute comfortably covers the
//          legitimate pattern (one fetch on signup/complete-profile mount, plus a few retries),
//          while throttling automated floods.
// [Inbound Trigger] Passed to checkRateLimit on every GET.
// [Downstream Impact] Lowering these tightens protection but risks blocking legitimate bursts.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// GUID: API_TEAM_NAME_SUGGESTIONS-003-v01
// [Intent] TTL for the cached existing-team-name set. Team names change rarely (only on signup),
//          so a 60s staleness window is harmless: the worst case is a just-taken name briefly
//          remaining in the suggestion pool, and complete-oauth-profile re-checks uniqueness on
//          submit anyway. This is the core denial-of-wallet fix — it caps collection scans.
// [Inbound Trigger] Compared against the cache timestamp in getExistingNames().
// [Downstream Impact] Larger values reduce Firestore reads further but increase staleness.
const CACHE_TTL_MS = 60 * 1000;

// GUID: API_TEAM_NAME_SUGGESTIONS-004-v01
// [Intent] Module-level cache of existing team names, shared across all requests to one instance.
// [Inbound Trigger] Read/written by getExistingNames().
// [Downstream Impact] Eliminates the per-request full collection scan. Lives for the instance lifetime.
let nameCache: { names: string[]; fetchedAt: number } | null = null;

// GUID: API_TEAM_NAME_SUGGESTIONS-005-v01
// [Intent] Return the set of existing team names, served from the module cache when fresh,
//          otherwise refreshed with a single `users` collection read.
// [Inbound Trigger] Called by the GET handler after the rate-limit check passes.
// [Downstream Impact] At most one Firestore collection scan per CACHE_TTL_MS per instance.
async function getExistingNames(): Promise<string[]> {
  const now = Date.now();
  if (nameCache && now - nameCache.fetchedAt < CACHE_TTL_MS) {
    return nameCache.names;
  }

  const { db } = await getFirebaseAdmin();
  const allUsersSnapshot = await db.collection('users').get();
  const existingNames: string[] = [];
  allUsersSnapshot.forEach((doc) => {
    const data = doc.data();
    if (data.teamName) existingNames.push(data.teamName);
    if (data.secondaryTeamName) existingNames.push(data.secondaryTeamName);
  });

  nameCache = { names: existingNames, fetchedAt: now };
  return existingNames;
}

// GUID: API_TEAM_NAME_SUGGESTIONS-001-v02
// @SECURITY_FIX (SEC-DOS-001): Added per-IP rate limiting and cached existing-name lookup.
// [Intent] GET handler that returns 50 filtered, shuffled suggestions from the curated pool,
//          guarded by a per-IP rate limit and backed by a TTL cache of existing names.
// [Inbound Trigger] GET /api/team-name-suggestions
// [Downstream Impact] Returns { suggestions: string[] }. Returns 429 when the caller exceeds the
//                     per-IP budget. On error, returns empty array so the client degrades gracefully.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  // GUID: API_TEAM_NAME_SUGGESTIONS-006-v01
  // [Intent] Throttle abusive callers before touching Firestore.
  // [Inbound Trigger] Every request, keyed by client IP.
  // [Downstream Impact] On breach, returns 429 with Retry-After and ERRORS.RATE_LIMIT_EXCEEDED;
  //                     no Firestore work is done for blocked requests.
  const ip = getClientIp(request);
  const rl = checkRateLimit(`team-name-suggestions:${ip}`, {
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (!rl.allowed) {
    return NextResponse.json(
      {
        suggestions: [],
        error: ERRORS.RATE_LIMIT_EXCEEDED.message,
        errorCode: ERRORS.RATE_LIMIT_EXCEEDED.code,
        correlationId,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const existingNames = await getExistingNames();
    const suggestions = generateSuggestions(existingNames, 50);

    return NextResponse.json({ suggestions, correlationId });
  } catch (error) {
    // @GOLDEN_RULE_1: Proper error logging with 4-pillar pattern (Phase 4 compliance).
    const { db: errorDb } = await getFirebaseAdmin();
    // @FIX: ERRORS.DATABASE_READ_FAILED does not exist (ERRORS is Record<string,…> so it resolved
    //   to undefined at runtime). Corrected to ERRORS.FIRESTORE_READ_FAILED (PX-4001).
    const traced = createTracedError(ERRORS.FIRESTORE_READ_FAILED, {
      correlationId,
      context: { route: '/api/team-name-suggestions', action: 'GET' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    // Return empty suggestions array for graceful degradation, but include error details for debugging
    return NextResponse.json({
      suggestions: [],
      error: traced.definition.message,
      errorCode: traced.definition.code,
      correlationId: traced.correlationId,
    });
  }
}
