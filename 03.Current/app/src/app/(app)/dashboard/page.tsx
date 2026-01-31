// GUID: PAGE_DASHBOARD-000-v03
// [Intent] Server-rendered dashboard page. Displays next race info (qualifying/race dates),
//          pre-season banner, hot news feed, feedback form, and version number.
//          Delegates client-side interactivity to DashboardClient.
// [Inbound Trigger] User navigates to /dashboard after successful login.
// [Downstream Impact] Calls findNextRace() for schedule data. Renders DashboardClient (countdown,
//                     pit lane status), HotNewsFeed (Suspense-wrapped), and FeedbackForm.

import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { findNextRace } from "@/lib/data";
import { Flag, Calendar, FlaskConical } from "lucide-react";
import { DashboardClient } from "./_components/DashboardClient";
import { FeedbackForm } from "./_components/FeedbackForm";
import { ResolvedFeedbackNotifier } from "./_components/ResolvedFeedbackNotifier";
import { HotNewsFeed, HotNewsFeedSkeleton } from "./_components/HotNewsFeed";
import { WelcomeCTA } from "./_components/WelcomeCTA";
import { APP_VERSION } from '@/lib/version';

// GUID: PAGE_DASHBOARD-001-v03
// [Intent] Pre-season flag — controls visibility of the pre-season testing banner.
//          Set to false when the F1 season officially starts.
// [Inbound Trigger] Evaluated at render time.
// [Downstream Impact] When true, shows amber "Pre-Season Testing" alert on dashboard.
const IS_PRE_SEASON = true;


// GUID: PAGE_DASHBOARD-002-v03
// [Intent] Force dynamic rendering to prevent Next.js from attempting Firestore access at build time.
// [Inbound Trigger] Next.js build/render system reads this exported constant.
// [Downstream Impact] Ensures page is always server-rendered at request time, never statically generated.
export const dynamic = 'force-dynamic';

// GUID: PAGE_DASHBOARD-003-v03
// [Intent] Main dashboard page component — computes next race dates, renders countdown client,
//          qualifying/race date cards, hot news feed, feedback form, and version footer.
// [Inbound Trigger] Route navigation to /dashboard.
// [Downstream Impact] findNextRace() provides schedule data. DashboardClient handles real-time
//                     countdown and pit lane status. HotNewsFeed loads asynchronously.
export default function DashboardPage() {
    const nextRace = findNextRace();

    const qualifyingDate = new Date(nextRace.qualifyingTime);
    const raceDate = new Date(nextRace.raceTime);

    return (
        <div className="grid gap-6">
            <DashboardClient nextRace={nextRace} />

            {IS_PRE_SEASON && (
                <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <FlaskConical className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-200">
                        <strong>Pre-Season Testing</strong> — Predictions and scores with test results will be purged prior to the first race. Have fun experimenting!
                    </AlertDescription>
                </Alert>
            )}

            <WelcomeCTA />

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Qualifying</CardTitle>
                        <Flag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {qualifyingDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {qualifyingDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (Your Time)
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Race Day</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                           {raceDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                         <p className="text-xs text-muted-foreground">
                            {raceDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (Your Time)
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Hot News Feed - loads asynchronously via Suspense */}
            <Suspense fallback={<HotNewsFeedSkeleton />}>
                <HotNewsFeed />
            </Suspense>

            <ResolvedFeedbackNotifier />
            <FeedbackForm />

            <div className="text-center">
                <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
            </div>
        </div>
    )
}
