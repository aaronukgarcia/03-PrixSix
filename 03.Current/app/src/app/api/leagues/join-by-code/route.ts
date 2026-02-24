/**
 * POST /api/leagues/join-by-code
 *
 * GUID: API_LEAGUE_JOIN-001-v07
 * [Intent] Server-side API for joining leagues by invite code. Validates code,
 *          checks league capacity, and atomically adds user to league. Resolves
 *          FIRESTORE-003 by removing need for client-side inviteCode visibility.
 *          Supports secondary teams via optional teamId parameter (v04 addition).
 * [Inbound Trigger] User submits invite code from "Join League" UI.
 * [Downstream Impact] Adds user (or teamId for secondary teams) to league memberUserIds array,
 *                     logs audit event. Prevents unauthorized league access by validating server-side.
 * @SECURITY_FIX(v06) LEAGUES-003: Added per-IP rate limiting (10 attempts / 15 min) to prevent
 *                    invite code brute-force enumeration. Stored in join_rate_limits collection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import type { Firestore } from 'firebase-admin/firestore';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Maximum leagues per user (from lib/types/league.ts)
const MAX_LEAGUES_PER_USER = 5;

// GUID: API_LEAGUE_JOIN-002-v01
// @SECURITY_FIX: Per-IP rate limiting to prevent invite code brute-force enumeration (LEAGUES-003).
// [Intent] Rate limit configuration — max 10 join attempts per IP per 15-minute window.
//          Chosen to allow legitimate retries (mistyped codes) while blocking enumeration.
// [Inbound Trigger] Referenced by checkJoinRateLimit() and recordJoinAttempt().
// [Downstream Impact] Exceeding the limit returns HTTP 429 before any Firestore league lookup,
//                     preventing an attacker from discovering valid codes via response timing/content.
const JOIN_RATE_LIMIT_MAX = 10;
const JOIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// GUID: API_LEAGUE_JOIN-003-v01
// @SECURITY_FIX: Extract real client IP accounting for proxy/CDN headers (LEAGUES-003).
// [Intent] Derive the originating client IP from request headers in priority order.
// [Inbound Trigger] Called once at the top of POST before any auth or DB operations.
// [Downstream Impact] The returned IP is the key used to look up rate limit state in Firestore.
function getClientIP(req: NextRequest): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0].trim();
  return 'unknown';
}

// GUID: API_LEAGUE_JOIN-004-v02
// @SECURITY_FIX: Firestore-backed per-IP rate limit check for join-by-code (LEAGUES-003).
// @SECURITY_FIX (Wave 10): NODE_ENV gate applied to console.error in read error catch.
// [Intent] Check whether the given IP has exceeded JOIN_RATE_LIMIT_MAX attempts within the
//          current 15-minute window. Returns false on any read failure (fail-open for availability).
// [Inbound Trigger] Called at the top of POST after extracting clientIP, before auth verification.
// [Downstream Impact] When true: caller returns HTTP 429. When false: caller proceeds normally.
async function checkJoinRateLimit(
  db: Firestore,
  ip: string,
  correlationId: string
): Promise<boolean> {
  try {
    const safeIP = ip.replace(/[^a-zA-Z0-9._-]/g, '_');
    const doc = await db.collection('join_rate_limits').doc(safeIP).get();
    if (!doc.exists) return false;
    const data = doc.data()!;
    if (Date.now() - (data.windowStart ?? 0) >= JOIN_RATE_LIMIT_WINDOW_MS) return false;
    return (data.attempts ?? 0) >= JOIN_RATE_LIMIT_MAX;
  } catch (error: any) {
    // @SECURITY_FIX (Wave 10): NODE_ENV gate
    if (process.env.NODE_ENV !== 'production') { console.error(`[JoinByCode] Rate limit check failed [${ERRORS.FIRESTORE_READ_FAILED.code}] correlationId=${correlationId}:`, error); }
    return false; // fail-open: don't block legitimate users on read error
  }
}

// GUID: API_LEAGUE_JOIN-005-v02
// @SECURITY_FIX: Records each join attempt for the IP's rate limit window (LEAGUES-003).
// @SECURITY_FIX (Wave 10): NODE_ENV gate applied to console.error in write error catch.
// [Intent] Increment attempt counter for this IP. Resets window if expired or doc missing.
//          Write failures are logged but non-blocking — one missed count is acceptable.
// [Inbound Trigger] Called in POST on every request that passes auth, regardless of code validity.
//                   Recording failed lookups is essential: attackers must be counted on wrong codes.
// [Downstream Impact] Feeds checkJoinRateLimit(). A failed write = one uncounted attempt (acceptable).
async function recordJoinAttempt(
  db: Firestore,
  ip: string,
  correlationId: string
): Promise<void> {
  try {
    const safeIP = ip.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docRef = db.collection('join_rate_limits').doc(safeIP);
    const doc = await docRef.get();
    const now = Date.now();
    if (!doc.exists || now - (doc.data()?.windowStart ?? 0) >= JOIN_RATE_LIMIT_WINDOW_MS) {
      await docRef.set({ attempts: 1, windowStart: now, ip, updatedAt: now });
    } else {
      await docRef.update({ attempts: (doc.data()!.attempts ?? 0) + 1, updatedAt: now });
    }
  } catch (error: any) {
    // @SECURITY_FIX (Wave 10): NODE_ENV gate
    if (process.env.NODE_ENV !== 'production') { console.error(`[JoinByCode] Rate limit record failed [${ERRORS.FIRESTORE_WRITE_FAILED.code}] correlationId=${correlationId}:`, error); }
  }
}

interface JoinByCodeRequest {
  inviteCode: string;
  teamId?: string; // Optional: for secondary team joining (format: userId-secondary)
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId('league_join');

  try {
    // GUID: API_LEAGUE_JOIN-006-v01
    // @SECURITY_FIX: Per-IP rate limit gate — runs before auth to block unauthenticated
    //                enumeration. Initialises Firebase Admin here (before auth check) because
    //                the rate limit check is a prerequisite for all other processing (LEAGUES-003).
    // [Intent] Enforce max 10 join attempts per IP per 15-minute window. Returns HTTP 429 if
    //          exceeded, before any league data is accessed.
    // [Inbound Trigger] Every POST to /api/leagues/join-by-code.
    // [Downstream Impact] join_rate_limits collection is written on every attempt that passes this
    //                     gate (see recordJoinAttempt call below, after DB init at step 3).
    const clientIP = getClientIP(request);
    const { db: rateLimitDb } = await getFirebaseAdmin();
    if (await checkJoinRateLimit(rateLimitDb, clientIP, correlationId)) {
      console.warn(`[JoinByCode] Rate limit exceeded [${ERRORS.AUTH_PERMISSION_DENIED.code}] ip=${clientIP} correlationId=${correlationId}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please wait before trying again.',
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 429 }
      );
    }

    // 1. Verify Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AUTH_INVALID_TOKEN.message,
          errorCode: ERRORS.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    const userId = verifiedUser.uid;
    const body: JoinByCodeRequest = await request.json();
    const { inviteCode, teamId } = body;

    // Determine the member ID to add (primary team = userId, secondary = userId-secondary)
    // Security: validate teamId format to prevent injection; must be userId or userId-secondary
    const memberIdToAdd = (teamId && teamId === `${userId}-secondary`) ? teamId : userId;

    // 2. Validate invite code format
    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.VALIDATION_INVALID_FORMAT.message,
          errorCode: ERRORS.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Normalize invite code (uppercase, trim)
    const normalizedCode = inviteCode.trim().toUpperCase();

    if (normalizedCode.length !== 6) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.VALIDATION_MISSING_FIELDS.message,
          errorCode: ERRORS.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // 3. Look up league by invite code (server-side via Admin SDK)
    const { db, FieldValue } = await getFirebaseAdmin();

    // Record this attempt against the IP's rate limit window (non-blocking on failure)
    await recordJoinAttempt(db, clientIP, correlationId);

    const leaguesSnapshot = await db.collection('leagues')
      .where('inviteCode', '==', normalizedCode)
      .limit(1)
      .get();

    if (leaguesSnapshot.empty) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.RACE_NOT_FOUND.message,
          errorCode: ERRORS.RACE_NOT_FOUND.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    const leagueDoc = leaguesSnapshot.docs[0];
    const leagueData = leagueDoc.data();
    const leagueId = leagueDoc.id;

    // 4. Check if user/team is already a member
    const memberUserIds = leagueData.memberUserIds || [];
    if (memberUserIds.includes(memberIdToAdd)) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.VALIDATION_DUPLICATE_ENTRY.message,
          errorCode: ERRORS.VALIDATION_DUPLICATE_ENTRY.code,
          correlationId,
        },
        { status: 409 }
      );
    }

    // 5. Check if league is the global league (cannot join via code)
    if (leagueData.isGlobal === true) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AUTH_PERMISSION_DENIED.message,
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // 6. Check if user has reached max leagues limit
    const userLeaguesSnapshot = await db.collection('leagues')
      .where('memberUserIds', 'array-contains', userId)
      .get();

    if (userLeaguesSnapshot.size >= MAX_LEAGUES_PER_USER) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AUTH_PERMISSION_DENIED.message,
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // 7. Atomically add user to league and log audit event
    const batch = db.batch();

    // Update league document
    const leagueRef = db.collection('leagues').doc(leagueId);
    batch.update(leagueRef, {
      memberUserIds: FieldValue.arrayUnion(memberIdToAdd),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log audit event
    const auditRef = db.collection('audit_logs').doc();
    batch.set(auditRef, {
      userId,
      action: 'LEAGUE_JOINED',
      details: {
        leagueId,
        leagueName: leagueData.name,
        inviteCode: normalizedCode,
        memberIdAdded: memberIdToAdd,
        joinedAt: new Date().toISOString(),
      },
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit atomic batch
    await batch.commit();

    // 8. Return success with league details
    return NextResponse.json({
      success: true,
      message: `Successfully joined ${leagueData.name}`,
      league: {
        id: leagueId,
        name: leagueData.name,
        description: leagueData.description,
        memberCount: memberUserIds.length + 1,
      },
      correlationId,
    });

  } catch (error: any) {
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/leagues/join-by-code', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        correlationId: traced.correlationId
      },
      { status: 500 }
    );
  }
}
