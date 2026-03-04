'use client';

// GUID: COMPONENT_NEW_VERSION_BANNER-000-v01
// [Intent] Proactive stale-bundle banner — detects when a new build has been deployed while
//          the user has the old bundle loaded, and prompts them to refresh BEFORE they hit
//          a ChunkLoadError. Sits fixed at the top of the viewport above all other content.
//          Dismissable (snoozes for the session). One-click refresh.
// [Inbound Trigger] Mounted in root layout. useVersionCheck polls /api/version every 2 min.
// [Downstream Impact] When shown, notifies the user a new version is available. Clicking
//                     "Refresh now" reloads the page (fetches the new bundle). Dismissing
//                     hides the banner for the session — ChunkErrorHandler still catches any
//                     chunk errors that occur if the user ignores the banner.

import { useState } from 'react';
import { useVersionCheck } from '@/hooks/use-version-check';
import { RefreshCw, X } from 'lucide-react';

// GUID: COMPONENT_NEW_VERSION_BANNER-001-v01
// [Intent] Renders a slim fixed top bar when a new version is detected. Hidden otherwise.
//          Dismissed state is local to the session — reappears if user opens a new tab.
// [Inbound Trigger] useVersionCheck returns updateAvailable=true.
// [Downstream Impact] "Refresh now" → window.location.reload() → fresh bundle, no chunk errors.
//                     Dismiss → hides banner; ChunkErrorHandler remains the safety net.
export function NewVersionBanner() {
    const { updateAvailable } = useVersionCheck();
    const [dismissed, setDismissed] = useState(false);

    if (!updateAvailable || dismissed) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between gap-3 bg-primary px-4 py-2 text-primary-foreground text-sm shadow-lg">
            <span className="flex items-center gap-2 min-w-0">
                <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">A new version of Prix Six is available.</span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
                <button
                    onClick={() => window.location.reload()}
                    className="rounded bg-primary-foreground/15 hover:bg-primary-foreground/25 px-3 py-1 text-xs font-medium transition-colors"
                >
                    Refresh now
                </button>
                <button
                    onClick={() => setDismissed(true)}
                    className="p-0.5 hover:opacity-70 transition-opacity"
                    aria-label="Dismiss update notification"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
