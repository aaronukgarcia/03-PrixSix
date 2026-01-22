import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { findNextRace } from "@/lib/data";
import { Flag, Calendar } from "lucide-react";
import { DashboardClient } from "./_components/DashboardClient";
import { FeedbackForm } from "./_components/FeedbackForm";
import { HotNewsFeed, HotNewsFeedSkeleton } from "./_components/HotNewsFeed";
import { APP_VERSION } from '@/lib/version';


// Force dynamic rendering to avoid build-time Firestore access
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
    const nextRace = findNextRace();

    const qualifyingDate = new Date(nextRace.qualifyingTime);
    const raceDate = new Date(nextRace.raceTime);

    return (
        <div className="grid gap-6">
            <DashboardClient nextRace={nextRace} />

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

            <FeedbackForm />

            <div className="text-center">
                <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
            </div>
        </div>
    )
}
