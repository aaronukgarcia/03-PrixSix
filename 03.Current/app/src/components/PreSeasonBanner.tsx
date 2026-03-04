"use client";

// GUID: COMPONENT_PRE_SEASON_BANNER-000-v01
// [Intent] IS_PRE_SEASON flag (toggle to disable banner when season starts) and the amber alert banner component — informs players that accumulated test points will be reset before race 1.
// [Inbound Trigger] Rendered on the dashboard and standings pages; IS_PRE_SEASON=false disables it immediately with a null return.
// [Downstream Impact] IS_PRE_SEASON is checked in MEMORY.md — set to false when real-season data is live and test users are purged.
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FlaskConical } from "lucide-react";

// Set to false when the F1 season officially starts and all test data has been purged.
export const IS_PRE_SEASON = false;

export function PreSeasonBanner() {
    if (!IS_PRE_SEASON) return null;

    return (
        <Alert className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
            <FlaskConical className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Pre-Season Testing</strong> — This is a simulation of the upcoming season.
                Other teams may have accumulated points from earlier testing rounds, so don&apos;t worry
                if you&apos;re behind. All predictions and scores will be reset before the first race.
                Have fun experimenting!
            </AlertDescription>
        </Alert>
    );
}
