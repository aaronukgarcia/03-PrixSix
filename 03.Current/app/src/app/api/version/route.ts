// GUID: API_VERSION-000-v01
// [Intent] Lightweight public endpoint that returns the currently deployed app version.
//          Used by the client-side version check hook to detect when a new build has been
//          deployed — if the server version differs from the client's baked-in version,
//          the user has a stale bundle and should refresh.
// [Inbound Trigger] GET /api/version — polled every 2 minutes by useVersionCheck hook.
// [Downstream Impact] Drives the NewVersionBanner component. No auth required — returns
//                     only the version string, which is already public on /about.

import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

export async function GET() {
    return NextResponse.json(
        { version: APP_VERSION },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
}
