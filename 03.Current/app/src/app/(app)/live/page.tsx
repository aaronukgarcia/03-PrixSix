// GUID: PAGE_LIVE-000-v02
// [Intent] Server component wrapper for the player-facing Live Timing page.
//          Reads initial timing data from Firestore via Admin SDK (server-side)
//          to avoid a loading flash on first render. Passes data to the client
//          component which handles auto-refresh polling.
// [Inbound Trigger] User navigates to /live from the sidebar or direct URL.
// [Downstream Impact] Renders LiveTimingClient with initial data; client takes
//                     over for subsequent auto-refresh every 2 minutes.

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import type { PubChatTimingData } from '@/firebase/firestore/settings';
import LiveTimingClient from './_components/LiveTimingClient';

export const metadata: Metadata = { title: 'PubChat | Prix Six' };

// Force dynamic so the server-side Firestore read always gets fresh data.
export const dynamic = 'force-dynamic';

// GUID: PAGE_LIVE-001-v03
// [Intent] Server-side initial data fetch from app-settings/pub-chat-timing.
//          Returns null if the document doesn't exist — client handles null gracefully.
// [Inbound Trigger] Called once on each page request (server-side render).
// [Downstream Impact] Prevents the loading spinner on first paint; client then
//                     takes over polling. Errors are swallowed — null fallback.
// @FIX(v02) Strip fetchedAt (Admin SDK Timestamp) before passing to Client Component.
// @FIX(v03) BUG: v02 stripped only the ONE Timestamp field known at the time. During
//           the 2026-07-27 live session, /api/live/refresh-timing merged a second
//           Timestamp (refreshClaimedAt) into the doc and the RSC render crashed for
//           every /live visitor (digest 3582422298, PX-9001 burst 13:27 UTC).
//           Now strips EVERY Timestamp-like value (GR#16: never trust TS types about
//           Firestore data) — duck-typed on .toMillis so a bundler-duplicated
//           Timestamp class can't dodge an instanceof check. None of these fields are
//           needed client-side: the client re-reads Firestore on mount.
async function getInitialTimingData(): Promise<PubChatTimingData | null> {
  try {
    const { db } = await getFirebaseAdmin();
    const snap = await db.doc('app-settings/pub-chat-timing').get();
    if (!snap.exists) return null;
    const raw = snap.data()!;
    const serializable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      // Drop any Admin SDK Timestamp (fetchedAt, refreshClaimedAt, future fields) —
      // class instances cannot cross the Server→Client Component boundary.
      if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') continue;
      serializable[key] = value;
    }
    return serializable as unknown as PubChatTimingData;
  } catch {
    return null;
  }
}

// GUID: PAGE_LIVE-002-v01
// [Intent] Skeleton shown while the Suspense boundary waits for server data.
// [Inbound Trigger] Displayed during streaming SSR before LiveTimingClient mounts.
// [Downstream Impact] Prevents layout shift — same card dimensions as the real content.
function LiveTimingSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-lg">
      <div className="rounded-3xl bg-muted/20 border border-border animate-pulse h-[600px]" />
    </div>
  );
}

// GUID: PAGE_LIVE-003-v01
// [Intent] Page root — fetches initial data and renders the client component.
// [Inbound Trigger] Next.js router renders this on every GET /live request.
// [Downstream Impact] LiveTimingClient receives initialTimingData prop and
//                     immediately shows content without a client-side loading flash.
export default async function LivePage() {
  const initialData = await getInitialTimingData();

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <Suspense fallback={<LiveTimingSkeleton />}>
        <LiveTimingClient initialTimingData={initialData} />
      </Suspense>
    </div>
  );
}
