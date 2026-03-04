'use client';

// GUID: HOOK_VERSION_CHECK-000-v01
// [Intent] Custom hook that polls /api/version every 2 minutes and compares the server's
//          current version against APP_VERSION baked into the client bundle at build time.
//          Returns updateAvailable=true when they differ (i.e. a new build has been deployed
//          while this user has the old bundle loaded).
// [Inbound Trigger] Mounted once via NewVersionBanner in root layout.
// [Downstream Impact] Drives the "new version available" banner. Non-critical — failures
//                     are swallowed silently. Skips polling when the browser tab is hidden.

import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/version';

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const INITIAL_DELAY_MS = 45 * 1000;     // Wait 45s before first poll (let the page settle)

// GUID: HOOK_VERSION_CHECK-001-v01
// [Intent] Main hook body — sets up delayed first check then repeating interval.
//          Skips checks when the tab is hidden to avoid wasted fetches.
//          Returns { updateAvailable } — true when server version !== client version.
// [Inbound Trigger] Called by NewVersionBanner on mount.
// [Downstream Impact] Once updateAvailable becomes true it stays true (no going back).
//                     The user must reload to clear it.
export function useVersionCheck(): { updateAvailable: boolean } {
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        // Already detected — no need to keep polling
        if (updateAvailable) return;

        const check = async () => {
            if (document.hidden) return; // Skip when tab is in background
            try {
                const res = await fetch('/api/version', { cache: 'no-store' });
                if (!res.ok) return;
                const { version } = await res.json();
                if (version && version !== APP_VERSION) {
                    setUpdateAvailable(true);
                }
            } catch {
                // Silently swallow — version check is non-critical infrastructure
            }
        };

        let intervalId: ReturnType<typeof setInterval> | null = null;

        const timeoutId = setTimeout(() => {
            check();
            intervalId = setInterval(check, POLL_INTERVAL_MS);
        }, INITIAL_DELAY_MS);

        return () => {
            clearTimeout(timeoutId);
            if (intervalId) clearInterval(intervalId);
        };
    }, [updateAvailable]);

    return { updateAvailable };
}
