"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { FlaskConical } from "lucide-react";

// Set to false when the F1 season officially starts and all test data has been purged.
export const IS_PRE_SEASON = true;

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
