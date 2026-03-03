/**
 * GUID: CRON_HOT_NEWS-000-v01
 *
 * [Intent] Cron-authenticated POST endpoint that triggers AI hot news regeneration.
 *          Called hourly by the Firebase Cloud Function refreshHotNews (functions/index.js).
 *          Can also be tested manually via curl with the CRON_SECRET bearer token.
 *
 * [Inbound Trigger] POST from refreshHotNews Cloud Function (hourly, top of the hour).
 *                   Authorization: Bearer {CRON_SECRET} header required.
 *
 * [Downstream Impact] Calls hotNewsFeedFlow() which writes to app-settings/hot-news
 *                     in Firestore. Dashboard HotNewsFeed component reads that document.
 *
 * Security:
 *   - POST only — no GET handler means browser/crawler cannot trigger it
 *   - Bearer token validated against CRON_SECRET env var (set via apphosting:secrets:set)
 *   - Returns 401 on missing/wrong token, 405 on wrong method
 *   - No sensitive data in error responses (no token echoing, no stack traces)
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { hotNewsFeedFlow } from '@/ai/flows/hot-news-feed';

// GUID: CRON_HOT_NEWS-001-v01
// [Intent] Validate the Authorization: Bearer header against the CRON_SECRET env var
//          using a timing-safe comparison to prevent token oracle attacks.
//          Returns true only if the token is present, non-empty, and matches exactly.
// [Inbound Trigger] Called at the top of the POST handler before any work is done.
// [Downstream Impact] Unauthorized calls are rejected before any AI or Firestore work.
// @SECURITY_FIX (GR#11): Use timingSafeEqual instead of === to prevent timing oracle attacks
//   on the bearer token. Buffers are pre-padded to equal length to avoid length-leaking.
function isAuthorized(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;
    const provided = Buffer.from(authHeader);
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}

// GUID: CRON_HOT_NEWS-002-v01
// [Intent] POST handler — validates bearer token then runs hotNewsFeedFlow().
//          Returns { success: true, refreshCount } on success or an error JSON on failure.
// [Inbound Trigger] HTTP POST to /api/cron/refresh-hot-news from the Cloud Function.
// [Downstream Impact] Triggers full AI generation + Firestore write via hotNewsFeedFlow.
export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isAuthorized(request)) {
        return NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
        );
    }

    try {
        const result = await hotNewsFeedFlow();
        return NextResponse.json({
            success: true,
            refreshCount: result.refreshCount ?? null,
        });
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.error('[cron/refresh-hot-news] hotNewsFeedFlow error:', error);
        }
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
