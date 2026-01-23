
'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Mail,
  Trophy,
  Target,
  Calendar,
  BarChart3,
  UserCircle,
  Flag,
  Clock,
  CheckCircle2,
  Circle,
  Sparkles,
  HelpCircle,
  ListChecks,
  TrendingUp
} from "lucide-react";
import { useFirestore, useCollection } from '@/firebase';
import { collection, query } from 'firebase/firestore';
import { APP_VERSION } from '@/lib/version';
import { SCORING_POINTS, SCORING_DERIVED } from '@/lib/scoring-rules';

interface Presence {
  id: string;
  online: boolean;
  sessions?: string[];
  sessionActivity?: { [sessionId: string]: number };
}

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const AboutPageClient = () => {
    const firestore = useFirestore();

    const allUsersQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'users'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: allUsers } = useCollection(allUsersQuery);

    const presenceQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'presence'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: presenceDocs, isLoading } = useCollection<Presence>(presenceQuery);

    const totalTeamsCount = useMemo(() => {
        if (!allUsers) return 0;
        const secondaryTeamCount = allUsers.filter((u: any) => u.secondaryTeamName).length;
        return allUsers.length + secondaryTeamCount;
    }, [allUsers]);

    const onlineUserCount = useMemo(() => {
        if (!presenceDocs) return 0;
        const now = Date.now();
        return presenceDocs
            .filter(doc => doc.sessions && doc.sessions.length > 0)
            .reduce((acc, doc) => {
                if (!doc.sessions) return acc;
                const activeSessions = doc.sessions.filter(sessionId => {
                    if (doc.sessionActivity) {
                        const lastActivity = doc.sessionActivity[sessionId];
                        return lastActivity && (now - lastActivity) < SESSION_TIMEOUT_MS;
                    }
                    return true;
                });
                return acc + activeSessions.length;
            }, 0);
    }, [presenceDocs]);

    return (
        <div className="space-y-8">
            {/* Hero Section */}
            <div className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
                        Welcome to Prix Six
                    </h1>
                    <Badge variant="secondary" className="font-mono">v{APP_VERSION}</Badge>
                </div>
                <p className="text-lg text-muted-foreground max-w-2xl">
                    Prix Six is a friendly prediction game where you compete against friends to guess
                    which Formula 1 drivers will finish in the top 6 positions of each race.
                    No expert knowledge required - just pick your drivers and have fun!
                </p>
            </div>

            {/* Quick Stats */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Teams Playing</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalTeamsCount}</div>
                        <p className="text-xs text-muted-foreground">Competing for the championship</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Online Now</CardTitle>
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                        </span>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : onlineUserCount}</div>
                        <p className="text-xs text-muted-foreground">Active users right now</p>
                    </CardContent>
                </Card>
            </div>

            {/* How to Play */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Target className="h-6 w-6 text-primary"/>
                        How to Play
                    </CardTitle>
                    <CardDescription>
                        Everything you need to know to get started - it only takes a minute!
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* The Goal */}
                    <div className="space-y-3">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-yellow-500"/>
                            The Goal
                        </h3>
                        <p className="text-muted-foreground">
                            Predict which 6 drivers will finish in the top 6 positions of each Formula 1 race.
                            The closer your predictions are to the actual results, the more points you earn.
                            The team with the most points at the end of the season wins!
                        </p>
                    </div>

                    {/* Step by Step */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <ListChecks className="h-5 w-5 text-primary"/>
                            Getting Started
                        </h3>

                        <div className="grid gap-4">
                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">1</div>
                                <div>
                                    <h4 className="font-medium">Go to My Predictions</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Click on "My Predictions" in the menu. You'll see the upcoming race and a grid where you can select your drivers.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
                                <div>
                                    <h4 className="font-medium">Pick Your 6 Drivers</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Select 6 different drivers and arrange them in the order you think they'll finish (1st through 6th).
                                        Tap a driver to add them, drag to reorder.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">3</div>
                                <div>
                                    <h4 className="font-medium">Submit Before the Deadline</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Make sure to submit your prediction before qualifying starts (usually Saturday).
                                        A countdown timer on the Dashboard shows how much time you have left.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">4</div>
                                <div>
                                    <h4 className="font-medium">Watch the Race & Check Your Score</h4>
                                    <p className="text-sm text-muted-foreground">
                                        After the race, your score will be calculated automatically. Check the Standings page to see how you rank against other teams!
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* What's Required vs Optional */}
                    <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2 text-green-600 dark:text-green-400">
                                <CheckCircle2 className="h-5 w-5"/>
                                Required
                            </h3>
                            <ul className="space-y-2 text-sm">
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0"/>
                                    <span>Pick exactly 6 different drivers</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0"/>
                                    <span>Submit before qualifying starts</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 flex-shrink-0"/>
                                    <span>Verified email address</span>
                                </li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                <Circle className="h-5 w-5"/>
                                Optional (But Helpful!)
                            </h3>
                            <ul className="space-y-2 text-sm">
                                <li className="flex items-start gap-2">
                                    <Circle className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0"/>
                                    <span>Update predictions each race (your last one carries forward automatically)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <Circle className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0"/>
                                    <span>Run a second team for double the fun</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <Circle className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0"/>
                                    <span>Check standings and compare with friends</span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    {/* How to Win */}
                    <div className="space-y-3">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-yellow-500"/>
                            How Scoring Works
                        </h3>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="p-3 rounded-lg border bg-card text-center">
                                <div className="text-2xl font-bold text-green-500">+{SCORING_POINTS.exactPosition}</div>
                                <div className="text-sm text-muted-foreground">Exact position</div>
                            </div>
                            <div className="p-3 rounded-lg border bg-card text-center">
                                <div className="text-2xl font-bold text-blue-500">+{SCORING_POINTS.onePositionOff}</div>
                                <div className="text-sm text-muted-foreground">1 position off</div>
                            </div>
                            <div className="p-3 rounded-lg border bg-card text-center">
                                <div className="text-2xl font-bold text-orange-500">+{SCORING_POINTS.twoPositionsOff}</div>
                                <div className="text-sm text-muted-foreground">2 positions off</div>
                            </div>
                            <div className="p-3 rounded-lg border bg-card text-center">
                                <div className="text-2xl font-bold text-purple-500">+{SCORING_POINTS.bonusAll6}</div>
                                <div className="text-sm text-muted-foreground">All 6 in top 6 bonus</div>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Maximum possible per race: <span className="font-semibold">{SCORING_DERIVED.maxPointsPerRace} points</span> (all 6 drivers in exact positions + bonus).
                            See the <a href="/rules" className="text-primary underline hover:no-underline">Rules page</a> for full details.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Prix Six Features */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <HelpCircle className="h-6 w-6 text-primary"/>
                        Prix Six Features
                    </CardTitle>
                    <CardDescription>
                        Here's what you can do in the app
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Flag className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Dashboard</h4>
                                <p className="text-sm text-muted-foreground">
                                    Your home base. See the countdown to the next deadline, quick access to submit predictions, and your current position in the standings.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Target className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">My Predictions</h4>
                                <p className="text-sm text-muted-foreground">
                                    Select your 6 drivers for the upcoming race. View your prediction history and see how you scored in past races.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <TrendingUp className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Standings</h4>
                                <p className="text-sm text-muted-foreground">
                                    The league table showing all teams ranked by total points. See who's leading the championship and where you stand.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <BarChart3 className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Results</h4>
                                <p className="text-sm text-muted-foreground">
                                    After each race, see the official top 6 finishers and how everyone's predictions compared. Great for post-race chat!
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Calendar className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Schedule</h4>
                                <p className="text-sm text-muted-foreground">
                                    View the full F1 calendar with race dates, times, and locations. Never miss a prediction deadline again.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Users className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Teams</h4>
                                <p className="text-sm text-muted-foreground">
                                    Browse all teams in the league. See who else is playing and their current predictions (once the deadline passes).
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <UserCircle className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Profile</h4>
                                <p className="text-sm text-muted-foreground">
                                    Manage your account, change your team name, verify your email, or set up a second team if you want double the action.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 rounded-lg border">
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Clock className="h-5 w-5 text-primary" />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-medium">Submissions</h4>
                                <p className="text-sm text-muted-foreground">
                                    See a live feed of who has submitted predictions. Know if your friends have locked in their picks before the deadline.
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Support */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-6 w-6 text-primary"/>
                        Need Help?
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">
                        Got questions, spotted a bug, or have a suggestion? Drop us a message at{' '}
                        <a href="mailto:aaron@garcia.ltd" className="text-primary underline hover:no-underline">
                            aaron@garcia.ltd
                        </a>
                        {' '}and we'll get back to you.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
};

export default function AboutPage() {
    return <AboutPageClient />;
}
