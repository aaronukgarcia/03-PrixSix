// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST (no GET handler — prevents browser/crawler trigger by design)
// Auth:        CRON_SECRET bearer token (NOT Firebase Auth); timing-safe comparison
// Reads:       OpenF1 /v1/sessions?year={year} (external API), race_schedule collection
// Writes:      race_schedule documents (qualifyingTime, sprintTime, raceTime, raceEndTime)
// Errors:      401 (bad/missing token), 500 (OpenF1/Firestore failure, or an upcoming OpenF1
//              race meeting that maps to no race_schedule doc)
// Idempotent:  YES — only fields that differ from OpenF1 are written
// Side-effects: Updates race schedule timing in Firestore and clears this instance's 1h
//               in-memory cache (other instances pick the change up within the hour).
// Key gotcha:  /v1/sessions has NO meeting_name — meetings are matched to docs by race weekend
//              (lib/session-sync.ts). OpenF1 answers 401 to anonymous calls while a session is
//              live, and 05:00 UTC falls inside Asian practice sessions — so we authenticate.
//              Sprint weekends: qualifyingTime = Sprint Qualifying (NOT main Qualifying)
//              Called daily at 05:00 UTC by syncSessionTimes Cloud Function (functions/index.js).
// ──────────────────────────────────────────────────────────────────

// GUID: CRON_SYNC_SESSION_TIMES-000-v01
// [Intent] Daily cron route that syncs official FOM session start/end times from OpenF1
//          into the Firestore race_schedule collection. Ensures qualifying deadlines and
//          race times reflect actual FOM-published times, not the static estimates in data.ts.
//          On sprint weekends, updates qualifyingTime from the Sprint Qualifying session (not
//          main Qualifying) because that is the pick deadline for the sprint race.
// [Inbound Trigger] POST from syncSessionTimes Cloud Function in functions/index.js (05:00 UTC daily).
//                   Authorization: Bearer {CRON_SECRET} header required.
// [Downstream Impact] race_schedule Firestore docs are used by:
//   - /api/submit-prediction (deadline enforcement via race-schedule-server.ts)
//   - /api/calculate-scores (qualifyingTime for scoring cutoff computation)
//   - dashboard/page.tsx (pit lane auto-open/close clock)
//   Stale data risk: if OpenF1 hasn't yet published accurate session times (e.g. mid-week
//   before a race weekend), updates will simply write the currently-known times back.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getCachedToken, setCachedToken } from '@/lib/pit-wall-cache';
import { getSecret } from '@/lib/secrets-manager';
import { clearScheduleCache } from '@/lib/race-schedule-server';
import { planSessionSync, type OpenF1Session, type ScheduleDocTimes } from '@/lib/session-sync';

export const dynamic = 'force-dynamic';

// GUID: CRON_SYNC_SESSION_TIMES-001-v01
// [Intent] Validate the Authorization: Bearer header against CRON_SECRET using timing-safe
//          comparison to prevent token oracle attacks. BOM-stripped for Secret Manager compat.
// [Inbound Trigger] Called at the start of POST handler before any external I/O.
// [Downstream Impact] Unauthorized calls are rejected before OpenF1 or Firestore access.
function isAuthorized(request: NextRequest): boolean {
    const secret = (process.env.CRON_SECRET ?? '').replace(/^\uFEFF/, '');
    if (!secret) return false;
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;
    const provided = Buffer.from(authHeader);
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}

// GUID: CRON_SYNC_SESSION_TIMES-002-v02
// @BUGFIX (v3.25.4, BUG-SCHED-SYNC-001): OpenF1 refuses anonymous requests (401) while a session
//   is live; the 05:00 UTC run landed inside FP1 and FP3 at Sepang and failed two days running.
//   (v01 of this GUID was the OpenF1Session interface, now in lib/session-sync.ts.)
// [Intent] Best-effort OpenF1 bearer token, sharing the pit-wall token cache and the same
//          openf1-username/openf1-password secrets as every other OpenF1 caller.
// [Inbound Trigger] Called once per POST before the sessions fetch.
// [Downstream Impact] Returns null on any failure — the caller then tries anonymously, which
//                     works outside live sessions; a 401 there still fails the run loudly.
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

async function getOpenF1Token(): Promise<string | null> {
    try {
        const cached = getCachedToken();
        if (cached && cached.expiresAt > Date.now()) return cached.token;

        const username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
        const password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
        const res = await fetch(OPENF1_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username, password, grant_type: 'password' }).toString(),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            console.error(`[cron/sync-session-times] OpenF1 token request returned ${res.status}`);
            return null;
        }
        const data = await res.json();
        if (!data?.access_token) return null;
        const token = data.access_token as string;
        setCachedToken({ token, expiresAt: Date.now() + ((data.expires_in ?? 300) - 60) * 1000 });
        return token;
    } catch (err: any) {
        console.error('[cron/sync-session-times] OpenF1 token request failed:', err?.message ?? err);
        return null;
    }
}

// GUID: CRON_SYNC_SESSION_TIMES-003-v02
// @BUGFIX (v3.25.4, BUG-SCHED-SYNC-001): matching moved to planSessionSync (race weekend, not
//   the non-existent meeting_name); the 30-day window is gone (every unfinished meeting is in
//   scope); and an upcoming meeting that maps to no doc now FAILS the run instead of returning
//   200 "updated: 0" — the silent no-op that hid a dead sync from 2026-03-13 to 2026-10-03.
// [Intent] POST handler — fetches this year's OpenF1 sessions, plans the race_schedule updates,
//          batch-writes the fields that differ (qualifyingTime, sprintTime, raceTime, raceEndTime).
// [Inbound Trigger] HTTP POST to /api/cron/sync-session-times from Cloud Function.
// [Downstream Impact] Updates race_schedule docs used by deadline enforcement + scoring cutoff.
//   A non-2xx here is written to error_logs (PX-3204) by the syncSessionTimes Cloud Function.
export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isAuthorized(request)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const year = new Date().getFullYear();
    const now = Date.now();

    try {
        // ── Step 1: Fetch OpenF1 sessions for this year ────────────────
        const openF1Url = `https://api.openf1.org/v1/sessions?year=${year}`;
        let sessions: OpenF1Session[];

        try {
            const token = await getOpenF1Token();
            const resp = await fetch(openF1Url, {
                headers: token
                    ? { Accept: 'application/json', Authorization: `Bearer ${token}` }
                    : { Accept: 'application/json' },
                signal: AbortSignal.timeout(30_000),
            });
            if (!resp.ok) {
                console.error(`[cron/sync-session-times] OpenF1 returned ${resp.status} (authenticated: ${!!token})`);
                return NextResponse.json(
                    { success: false, error: `OpenF1 API error: ${resp.status}` },
                    { status: 500 }
                );
            }
            sessions = await resp.json();
        } catch (err: any) {
            console.error('[cron/sync-session-times] OpenF1 fetch failed:', err?.message ?? err);
            return NextResponse.json(
                { success: false, error: 'OpenF1 fetch failed' },
                { status: 500 }
            );
        }

        if (!Array.isArray(sessions) || sessions.length === 0) {
            console.error('[cron/sync-session-times] OpenF1 returned no sessions');
            return NextResponse.json(
                { success: false, error: 'OpenF1 returned no sessions' },
                { status: 500 }
            );
        }

        // ── Step 2: Load race_schedule from Firestore ──────────────────
        const { db } = await getFirebaseAdmin();
        const scheduleSnap = await db.collection('race_schedule').get();

        if (scheduleSnap.empty) {
            console.error('[cron/sync-session-times] race_schedule collection is empty');
            return NextResponse.json({ success: false, error: 'race_schedule is empty' }, { status: 500 });
        }

        const docs: ScheduleDocTimes[] = scheduleSnap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                name: d.name,
                raceTime: d.raceTime,
                qualifyingTime: d.qualifyingTime,
                sprintTime: d.sprintTime,
                raceEndTime: d.raceEndTime,
            };
        });

        // ── Step 3: Plan and write ─────────────────────────────────────
        const plan = planSessionSync(sessions, docs, now);

        if (plan.updates.length > 0) {
            const batch = db.batch();
            for (const update of plan.updates) {
                batch.update(db.collection('race_schedule').doc(update.id), {
                    ...update.fields,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            clearScheduleCache();
        }

        const summary = Object.fromEntries(plan.updates.map(u => [u.id, u.fields]));
        console.log(
            `[cron/sync-session-times] meetings=${plan.meetingsConsidered} matched=${plan.meetingsMatched} ` +
            `updated=${plan.updates.length} unmatched=${plan.unmatched.length}`,
            JSON.stringify({ summary, unmatched: plan.unmatched })
        );

        // An upcoming race weekend we could not place is a failure, not a quiet zero: the matched
        // updates above are kept, but the run reports 500 so it lands in error_logs.
        if (plan.unmatched.length > 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: `${plan.unmatched.length} upcoming OpenF1 meeting(s) matched no race_schedule doc`,
                    unmatched: plan.unmatched,
                    updated: plan.updates.length,
                    races: summary,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            updated: plan.updates.length,
            meetings: plan.meetingsConsidered,
            races: summary,
        });

    } catch (error: any) {
        console.error('[cron/sync-session-times] Unexpected error:', error?.message ?? error);
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        );
    }
}
