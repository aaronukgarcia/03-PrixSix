// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST (no GET handler — prevents browser/crawler trigger by design)
// Auth:        CRON_SECRET bearer token (NOT Firebase Auth); timing-safe comparison
// Reads:       OpenF1 /v1/sessions?year={year} (external API), race_schedule collection
// Writes:      race_schedule documents (qualifyingTime, sprintTime, raceTime, raceEndTime)
// Errors:      401 (bad/missing token), 500 (OpenF1/Firestore failure)
// Idempotent:  YES — re-running overwrites fields with same or updated values
// Side-effects: Updates race schedule timing in Firestore. The 1h in-memory cache in
//               race-schedule-server.ts is NOT cleared — next scheduled fetch picks up changes.
// Key gotcha:  OpenF1 session_name values: "Practice 1"/"Practice 2"/"Practice 3"/
//              "Sprint Qualifying"/"Sprint"/"Qualifying"/"Race"
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

// GUID: CRON_SYNC_SESSION_TIMES-002-v01
// [Intent] TypeScript interface for the OpenF1 /v1/sessions response shape.
//          Only the fields needed for schedule sync are declared.
// [Inbound Trigger] Used when parsing JSON from OpenF1 API.
// [Downstream Impact] Field name changes in OpenF1 API would require updating this interface.
interface OpenF1Session {
    session_key: number;
    session_name: string;   // "Practice 1/2/3", "Sprint Qualifying", "Sprint", "Qualifying", "Race"
    meeting_name: string;   // e.g. "Chinese Grand Prix"
    location: string;       // e.g. "Shanghai"
    date_start: string;     // ISO UTC e.g. "2026-03-13T07:00:00+00:00"
    date_end: string;       // ISO UTC
    year: number;
}

// GUID: CRON_SYNC_SESSION_TIMES-003-v01
// [Intent] POST handler — fetches this year's OpenF1 sessions, filters to next 30 days,
//          matches each session to a race_schedule document by meeting_name, and batch-writes
//          updated timing fields (qualifyingTime, sprintTime, raceTime, raceEndTime).
//          Sprint weekends: qualifyingTime is set from "Sprint Qualifying", not "Qualifying".
//          Normal weekends: qualifyingTime is set from "Qualifying".
// [Inbound Trigger] HTTP POST to /api/cron/sync-session-times from Cloud Function.
// [Downstream Impact] Updates race_schedule docs used by deadline enforcement + scoring cutoff.
//   - Predictions submitted before the updated qualifyingTime are scored for that race.
//   - Stale qualifying times (wrong by 30+ min) caused the Chinese GP pit lane incident (2026-03-13).
export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isAuthorized(request)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const year = new Date().getFullYear();
    const now = Date.now();
    const windowEnd = now + 30 * 24 * 60 * 60 * 1000; // 30 days ahead

    try {
        // ── Step 1: Fetch OpenF1 sessions for this year ────────────────
        const openF1Url = `https://api.openf1.org/v1/sessions?year=${year}`;
        let sessions: OpenF1Session[];

        try {
            const resp = await fetch(openF1Url, { signal: AbortSignal.timeout(30_000) });
            if (!resp.ok) {
                console.error(`[cron/sync-session-times] OpenF1 returned ${resp.status}`);
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
            return NextResponse.json({ success: true, updated: 0, message: 'No sessions returned by OpenF1' });
        }

        // Filter to sessions starting within the next 30 days (allow 1h in the past for in-progress sessions)
        const upcoming = sessions.filter(s => {
            if (!s.date_start) return false;
            const t = new Date(s.date_start).getTime();
            return t >= now - 60 * 60 * 1000 && t <= windowEnd;
        });

        if (upcoming.length === 0) {
            return NextResponse.json({ success: true, updated: 0, message: 'No upcoming sessions in next 30 days' });
        }

        // ── Step 2: Load race_schedule from Firestore ──────────────────
        const { db } = await getFirebaseAdmin();
        const scheduleSnap = await db.collection('race_schedule').get();

        if (scheduleSnap.empty) {
            console.error('[cron/sync-session-times] race_schedule collection is empty');
            return NextResponse.json({ success: false, error: 'race_schedule is empty' }, { status: 500 });
        }

        // Build lookup: normalised race name → { ref, hasSprint }
        const raceByName = new Map<string, { ref: FirebaseFirestore.DocumentReference; hasSprint: boolean }>();
        scheduleSnap.forEach(doc => {
            const d = doc.data();
            if (d.name) {
                raceByName.set(d.name.toLowerCase(), { ref: doc.ref, hasSprint: !!d.hasSprint });
            }
        });

        // ── Step 3: Match sessions to races and build updates ──────────
        // Accumulate: raceName → field updates (last write per field wins)
        const updateMap = new Map<string, { ref: FirebaseFirestore.DocumentReference; fields: Record<string, any> }>();

        for (const session of upcoming) {
            const meetingKey = session.meeting_name?.toLowerCase();
            if (!meetingKey) continue;

            const raceEntry = raceByName.get(meetingKey);
            if (!raceEntry) continue; // No matching race in our schedule

            const dateStart = new Date(session.date_start).toISOString();
            const dateEnd = session.date_end ? new Date(session.date_end).toISOString() : undefined;

            if (!updateMap.has(meetingKey)) {
                updateMap.set(meetingKey, { ref: raceEntry.ref, fields: {} });
            }
            const entry = updateMap.get(meetingKey)!;

            const sn = session.session_name;

            if (sn === 'Sprint Qualifying') {
                // Sprint weekends: Sprint Qualifying is the picks deadline
                entry.fields.qualifyingTime = dateStart;
            } else if (sn === 'Qualifying' && !raceEntry.hasSprint) {
                // Normal weekends only: Qualifying is the picks deadline
                entry.fields.qualifyingTime = dateStart;
            } else if (sn === 'Sprint') {
                entry.fields.sprintTime = dateStart;
            } else if (sn === 'Race') {
                entry.fields.raceTime = dateStart;
                if (dateEnd) entry.fields.raceEndTime = dateEnd;
            }
        }

        // ── Step 4: Batch-write updates ────────────────────────────────
        if (updateMap.size === 0) {
            return NextResponse.json({ success: true, updated: 0, message: 'No matching races to update' });
        }

        const batch = db.batch();
        let fieldCount = 0;

        for (const { ref, fields } of updateMap.values()) {
            if (Object.keys(fields).length === 0) continue;
            fields.updatedAt = FieldValue.serverTimestamp();
            batch.update(ref, fields);
            fieldCount += Object.keys(fields).length;
        }

        await batch.commit();

        const summary = Object.fromEntries(
            Array.from(updateMap.entries())
                .filter(([, v]) => Object.keys(v.fields).length > 0)
                .map(([name, v]) => [name, Object.keys(v.fields)])
        );

        console.log(`[cron/sync-session-times] Updated ${updateMap.size} races, ${fieldCount} fields`, summary);

        return NextResponse.json({
            success: true,
            updated: updateMap.size,
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
