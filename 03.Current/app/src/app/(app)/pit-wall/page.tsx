// GUID: PAGE_PIT_WALL-000-v01
// [Intent] Server component wrapper for the Pit Wall live race data page.
//          No server-side data fetch needed — all data is fetched client-side
//          from the OpenF1 API via /api/pit-wall/live-data on a user-configured interval.
//          Renders the PitWallClient orchestrator with the dark theme enforced.
// [Inbound Trigger] User navigates to /pit-wall from the sidebar.
// [Downstream Impact] Renders PitWallClient which handles all polling, state, and layout.

import type { Metadata } from 'next';
import PitWallClient from './PitWallClient';

export const metadata: Metadata = { title: 'Pit Wall | Prix Six' };

// Force dynamic — page has no static output and must always be rendered fresh.
export const dynamic = 'force-dynamic';

// GUID: PAGE_PIT_WALL-001-v01
// [Intent] Render the Pit Wall client component inside a full-height dark wrapper.
//          The dark theme is enforced at page level so sub-components can use
//          dark-mode-only Tailwind classes without relying on the OS/user preference.
// [Inbound Trigger] Called once per request by Next.js App Router.
// [Downstream Impact] PitWallClient takes over; no further server-side work.
export default function PitWallPage() {
  return (
    <div className="h-full w-full bg-slate-950 text-slate-100 overflow-hidden" data-theme="dark">
      <PitWallClient />
    </div>
  );
}
