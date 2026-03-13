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

// GUID: PAGE_DASHBOARD-001-v03
// [Note] IS_PRE_SEASON flag moved to PreSeasonBanner.tsx (now controls all-pages banner via layout.tsx).

// GUID: PAGE_DASHBOARD-002-v03
// [Intent] Force dynamic rendering to prevent Next.js from attempting Firestore access at build time.
// [Inbound Trigger] Next.js build/render system reads this exported constant.
// [Downstream Impact] Ensures page is always server-rendered at request time, never statically generated.
export const dynamic = 'force-dynamic';

// GUID: PAGE_DASHBOARD-003-v06
// [Intent] Main dashboard page component — fetches pit lane state + next unscored race from
//          Firestore server-side, computes effective isPitlaneOpen (admin override + auto clock),
//          then passes these to DashboardClient for real-time countdown and status display.
//          Two race pointers are maintained:
//            activeRace    — first unscored race (drives pit lane state and prediction doc ID)
//            countdownRace — next race with qualifying in the future (fallback for completed weekends)
//          nextMilestone is the next upcoming SESSION within the active race weekend:
//            qualifying → sprint (if sprint weekend) → GP race → next race qualifying
//          This ensures the countdown always reflects the actual next event, not just next qualifying.
// [Inbound Trigger] Route navigation to /dashboard.
// [Downstream Impact] DashboardClient receives nextMilestone + pitLaneClosedAt + lockedSessions.
//                     DashboardClient auto-reloads when milestone expires to advance to next session.
export default async function DashboardPage() {
    // Server-side: fetch race_results + pit-lane override to compute correct state
    const { db } = await getFirebaseAdmin();
    const [raceResultsSnap, pitLaneSnap] = await Promise.all([
        db.collection('race_results').get(),
        db.collection('app-settings').doc('pit-lane').get(),
    ]);

    const resultIds = new Set(raceResultsSnap.docs.map(d => d.id.toLowerCase()));
    const pitLaneData = pitLaneSnap.exists ? pitLaneSnap.data() : null;
    const pitLaneOverride = pitLaneData?.override ?? null;

    // activeRace: first unscored race — governs pit lane state and prediction submission
    let activeRace = RaceSchedule[RaceSchedule.length - 1];
    for (const race of RaceSchedule) {
        const gpId = generateRaceIdLowercase(race.name, 'gp');
        if (!resultIds.has(gpId)) { activeRace = race; break; }
    }

    // countdownRace: next race whose qualifying is still in the future (fallback only).
    const now = new Date();
    let countdownRace = activeRace;
    if (new Date(activeRace.qualifyingTime) <= now) {
        const activeIdx = RaceSchedule.indexOf(activeRace);
        for (let i = activeIdx + 1; i < RaceSchedule.length; i++) {
            if (new Date(RaceSchedule[i].qualifyingTime) > now) {
                countdownRace = RaceSchedule[i];
                break;
            }
        }
    }

    // Effective pit lane state: override wins, then auto clock logic (based on activeRace)
    const autoOpen = !resultIds.has(generateRaceIdLowercase(activeRace.name, 'gp'))
                  && new Date(activeRace.qualifyingTime) > now;
    const isPitlaneOpen = pitLaneOverride === 'open'  ? true
                        : pitLaneOverride === 'close' ? false
                        : autoOpen;

    // GUID: PAGE_DASHBOARD-004-v01
    // [Intent] Compute the next upcoming milestone within the active race weekend.
    //          Walks qualifying → sprint (sprint weekends) → GP race in order.
    //          If all sessions are past (awaiting results entry), falls back to next race qualifying.
    //          This drives the countdown label and target time so the timer always shows the
    //          actual next event — not the next race's qualifying when we're mid-weekend.
    // [Inbound Trigger] Called once per server render with activeRace + now.
    // [Downstream Impact] Passed to DashboardClient as nextMilestone prop.
    type Milestone = { targetTime: string; label: string; sessionType: 'qualifying' | 'sprint' | 'race' | 'next-qualifying' };
    let nextMilestone: Milestone;

    if (new Date(activeRace.qualifyingTime) > now) {
        const sessionLabel = activeRace.hasSprint ? 'Sprint Qualifying' : 'Qualifying';
        nextMilestone = { targetTime: activeRace.qualifyingTime, label: `${activeRace.location} ${sessionLabel}`, sessionType: 'qualifying' };
    } else if (activeRace.hasSprint && activeRace.sprintTime && new Date(activeRace.sprintTime) > now) {
        nextMilestone = { targetTime: activeRace.sprintTime, label: `${activeRace.location} Sprint Race`, sessionType: 'sprint' };
    } else if (new Date(activeRace.raceTime) > now) {
        nextMilestone = { targetTime: activeRace.raceTime, label: `${activeRace.location} Grand Prix`, sessionType: 'race' };
    } else {
        // All sessions done — count to next race qualifying while awaiting results entry
        nextMilestone = { targetTime: countdownRace.qualifyingTime, label: `${countdownRace.location} Qualifying`, sessionType: 'next-qualifying' };
    }

    // GUID: PAGE_DASHBOARD-005-v01
    // [Intent] Compute the actual pit lane close time for display in the closed card.
    //          Uses overriddenAt (admin manual close) if it exists and is a 'close' action,
    //          otherwise falls back to the scheduled qualifyingTime.
    //          Also computes lockedSessions — the list of upcoming sessions within the active
    //          race weekend that predictions are now locked in for.
    // [Inbound Trigger] Called once per render when isPitlaneOpen is false.
    // [Downstream Impact] Passed to DashboardClient as pitLaneClosedAt + lockedSessions.
    //   GOTCHA #15: Firestore Timestamps stripped to ISO strings before passing as Server→Client props.
    let pitLaneClosedAt: string | null = null;
    let lockedSessions = '';
    if (!isPitlaneOpen) {
        const overrideTs = pitLaneData?.overriddenAt?.toDate?.();
        if (overrideTs && pitLaneOverride === 'close') {
            pitLaneClosedAt = overrideTs.toISOString();
        } else {
            pitLaneClosedAt = new Date(activeRace.qualifyingTime).toISOString();
        }

        if (activeRace.hasSprint) {
            if (new Date(activeRace.qualifyingTime) > now) {
                lockedSessions = 'Sprint Qualifying · Sprint Race · Grand Prix';
            } else if (activeRace.sprintTime && new Date(activeRace.sprintTime) > now) {
                lockedSessions = 'Sprint Race · Grand Prix';
            } else {
                lockedSessions = 'Grand Prix';
            }
        } else {
            lockedSessions = 'Qualifying · Grand Prix';
        }
    }

    // Upcoming sessions for the info cards — show active race weekend, not next race
    type SessionCard = { label: string; date: Date; icon: 'flag' | 'calendar' };
    const upcomingSessions: SessionCard[] = [];
    if (new Date(activeRace.qualifyingTime) > now) {
        upcomingSessions.push({ label: activeRace.hasSprint ? 'Sprint Qualifying' : 'Qualifying', date: new Date(activeRace.qualifyingTime), icon: 'flag' });
    }
    if (activeRace.hasSprint && activeRace.sprintTime && new Date(activeRace.sprintTime) > now) {
        upcomingSessions.push({ label: 'Sprint Race', date: new Date(activeRace.sprintTime), icon: 'flag' });
    }
    if (new Date(activeRace.raceTime) > now) {
        upcomingSessions.push({ label: 'Grand Prix', date: new Date(activeRace.raceTime), icon: 'calendar' });
    }
    // Fallback: if nothing left in current race, show next race qualifying
    if (upcomingSessions.length === 0) {
        upcomingSessions.push({ label: `${countdownRace.location} Qualifying`, date: new Date(countdownRace.qualifyingTime), icon: 'flag' });
        upcomingSessions.push({ label: `${countdownRace.location} Grand Prix`, date: new Date(countdownRace.raceTime), icon: 'calendar' });
    }
    // Cap at 2 for the 2-column grid
    const sessionCards = upcomingSessions.slice(0, 2);

    return (
        <div className="grid gap-6">
            <WelcomeCTA />

            <DashboardClient
                nextRace={activeRace}
                nextMilestone={nextMilestone}
                isPitlaneOpen={isPitlaneOpen}
                pitLaneClosedAt={pitLaneClosedAt}
                lockedSessions={lockedSessions}
            />

            <div className="grid gap-6 md:grid-cols-2">
                {sessionCards.map((session) => (
                    <Card key={session.label}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium">{session.label}</CardTitle>
                            {session.icon === 'flag'
                                ? <Flag className="h-4 w-4 text-muted-foreground" />
                                : <Calendar className="h-4 w-4 text-muted-foreground" />
                            }
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {session.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {session.date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (Your Time)
                            </p>
                        </CardContent>
                    </Card>
                ))}
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
