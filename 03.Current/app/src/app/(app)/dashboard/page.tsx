// GUID: PAGE_DASHBOARD-000-v03
// [Intent] Server-rendered dashboard page. Displays next race info (qualifying/race dates),
//          pre-season banner, hot news feed, feedback form, and version number.
//          Delegates client-side interactivity to DashboardClient.
// [Inbound Trigger] User navigates to /dashboard after successful login.
// [Downstream Impact] Calls findNextRace() for schedule data. Renders DashboardClient (countdown,
//                     pit lane status), HotNewsFeed (Suspense-wrapped), and FeedbackForm.

import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { findNextRace, RaceSchedule } from "@/lib/data";
import { Flag, Calendar } from "lucide-react";
import { DashboardClient } from "./_components/DashboardClient";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { generateRaceIdLowercase } from "@/lib/normalize-race-id";
import { FeedbackLink } from "./_components/FeedbackLink";
import { ResolvedFeedbackNotifier } from "./_components/ResolvedFeedbackNotifier";
import { HotNewsFeed, HotNewsFeedSkeleton } from "./_components/HotNewsFeed";
import { WelcomeCTA } from "./_components/WelcomeCTA";
import { APP_VERSION } from '@/lib/version';

// Pre-season banner moved to PreSeasonBanner.tsx — now shown on all pages via layout.tsx


// GUID: PAGE_DASHBOARD-002-v03
// [Intent] Force dynamic rendering to prevent Next.js from attempting Firestore access at build time.
// [Inbound Trigger] Next.js build/render system reads this exported constant.
// [Downstream Impact] Ensures page is always server-rendered at request time, never statically generated.
export const dynamic = 'force-dynamic';

// GUID: PAGE_DASHBOARD-003-v04
// [Intent] Main dashboard page component — fetches pit lane state + next unscored race from
//          Firestore server-side, computes effective isPitlaneOpen (admin override + auto clock),
//          then passes these to DashboardClient for real-time countdown and status display.
// [Inbound Trigger] Route navigation to /dashboard.
// [Downstream Impact] DashboardClient receives server-computed nextRace + isPitlaneOpen.
//                     DashboardClient auto-reloads when countdown expires to get the updated race.
export default async function DashboardPage() {
    // Server-side: fetch race_results + pit-lane override to compute correct state
    const { db } = await getFirebaseAdmin();
    const [raceResultsSnap, pitLaneSnap] = await Promise.all([
        db.collection('race_results').get(),
        db.collection('app-settings').doc('pit-lane').get(),
    ]);

    const resultIds = new Set(raceResultsSnap.docs.map(d => d.id.toLowerCase()));
    const pitLaneOverride = pitLaneSnap.exists ? (pitLaneSnap.data()?.override ?? null) : null;

    // Find first unscored race (same logic as predictions page)
    let nextRace = RaceSchedule[RaceSchedule.length - 1];
    for (const race of RaceSchedule) {
        const gpId = generateRaceIdLowercase(race.name, 'gp');
        if (!resultIds.has(gpId)) { nextRace = race; break; }
    }

    // Effective pit lane state: override wins, then auto clock logic
    const autoOpen = !resultIds.has(generateRaceIdLowercase(nextRace.name, 'gp'))
                  && new Date(nextRace.qualifyingTime) > new Date();
    const isPitlaneOpen = pitLaneOverride === 'open'  ? true
                        : pitLaneOverride === 'close' ? false
                        : autoOpen;

    const qualifyingDate = new Date(nextRace.qualifyingTime);
    const raceDate = new Date(nextRace.raceTime);

    return (
        <div className="grid gap-6">
            <WelcomeCTA />

            <DashboardClient nextRace={nextRace} isPitlaneOpen={isPitlaneOpen} />

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
            <FeedbackLink />

            <div className="text-center">
                <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
            </div>
        </div>
    )
}
