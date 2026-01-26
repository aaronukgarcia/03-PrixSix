
'use client';

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  TrendingUp,
  Zap,
  Car,
  Timer,
  Award,
  MapPin,
  Gauge,
  CircleDot,
  Play,
  Book,
  ExternalLink,
  ChevronRight,
  Film
} from "lucide-react";
import { useFirestore, useCollection } from '@/firebase';
import { collection, query } from 'firebase/firestore';
import { APP_VERSION } from '@/lib/version';
import { SCORING_POINTS, SCORING_DERIVED } from '@/lib/scoring-rules';
import CinematicIntro from './_components/CinematicIntro';

interface Presence {
  id: string;
  online: boolean;
  sessions?: string[];
  sessionActivity?: { [sessionId: string]: number };
}

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const INTRO_STORAGE_KEY = 'prix-six-about-intro-seen';

const AboutPageClient = () => {
    const firestore = useFirestore();
    const [showIntro, setShowIntro] = useState(false);
    const [hasCheckedStorage, setHasCheckedStorage] = useState(false);

    // Check localStorage on mount to determine if intro should play
    useEffect(() => {
        const hasSeenIntro = localStorage.getItem(INTRO_STORAGE_KEY);
        if (!hasSeenIntro) {
            setShowIntro(true);
        }
        setHasCheckedStorage(true);
    }, []);

    const handleIntroComplete = () => {
        localStorage.setItem(INTRO_STORAGE_KEY, 'true');
        setShowIntro(false);
    };

    const handleReplayIntro = () => {
        setShowIntro(true);
    };

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

    // Don't render anything until we've checked storage to prevent flash
    if (!hasCheckedStorage) {
        return null;
    }

    // Show cinematic intro if needed
    if (showIntro) {
        return (
            <CinematicIntro
                totalTeams={totalTeamsCount}
                onlineUsers={onlineUserCount}
                onComplete={handleIntroComplete}
            />
        );
    }

    return (
        <div className="space-y-8">
            {/* Hero Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
                            Welcome to Prix Six
                        </h1>
                        <Badge variant="secondary" className="font-mono">v{APP_VERSION}</Badge>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReplayIntro}
                        className="gap-2"
                    >
                        <Film className="h-4 w-4" />
                        Watch Intro
                    </Button>
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

            {/* New to F1? */}
            <Card className="border-2 border-dashed border-primary/30">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Zap className="h-6 w-6 text-primary"/>
                        New to F1?
                    </CardTitle>
                    <CardDescription>
                        Never watched Formula 1 before? No worries - here's everything you need to know to join in the fun
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                    {/* What is F1? */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Car className="h-5 w-5 text-red-500"/>
                            What is Formula 1?
                        </h3>
                        <div className="p-4 rounded-lg bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20">
                            <p className="text-muted-foreground">
                                Formula 1 (or F1) is the world's most exciting motor racing championship.
                                Drivers race super-fast single-seater cars around circuits all over the world -
                                from Monaco's glamorous streets to Singapore's night race.
                            </p>
                            <p className="text-muted-foreground mt-3">
                                The cars can reach speeds over <span className="font-semibold text-foreground">350 km/h (220 mph)</span> and
                                pull forces that would make your head spin. It's basically the ultimate combination
                                of speed, technology, strategy, and driver skill.
                            </p>
                        </div>
                    </div>

                    {/* The Championships */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Trophy className="h-5 w-5 text-yellow-500"/>
                            Two Championships, One Season
                        </h3>
                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg border bg-card">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                                        <UserCircle className="h-4 w-4 text-blue-500"/>
                                    </div>
                                    <h4 className="font-medium">Drivers' Championship</h4>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Individual drivers earn points based on where they finish each race.
                                    The driver with the most points at the end of the season becomes
                                    <span className="font-semibold text-foreground"> World Champion</span>.
                                    This is the title everyone dreams of.
                                </p>
                            </div>
                            <div className="p-4 rounded-lg border bg-card">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                                        <Users className="h-4 w-4 text-orange-500"/>
                                    </div>
                                    <h4 className="font-medium">Constructors' Championship</h4>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Points from both drivers on a team are added together.
                                    The team (like Red Bull, Ferrari, or McLaren) with the most combined
                                    points wins. This determines prize money and bragging rights!
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* A Race Weekend */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-green-500"/>
                            What Happens on a Race Weekend?
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Each Grand Prix spans three days. Here's how it works:
                        </p>
                        <div className="space-y-3">
                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0">
                                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex flex-col items-center justify-center">
                                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">FRI</span>
                                        <Gauge className="h-4 w-4 text-blue-500"/>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-medium">Practice Sessions</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Teams test their cars, try different setups, and drivers learn the track.
                                        It's like a warm-up before the real action. Usually two 60-minute sessions.
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0">
                                    <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex flex-col items-center justify-center">
                                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400">SAT</span>
                                        <Timer className="h-4 w-4 text-purple-500"/>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-medium">Qualifying</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Drivers compete to set the fastest lap time. The quickest driver earns
                                        "pole position" (first place on the starting grid). Your Prix Six prediction
                                        must be in before this starts!
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 p-4 rounded-lg bg-muted/50">
                                <div className="flex-shrink-0">
                                    <div className="w-12 h-12 rounded-lg bg-red-500/20 flex flex-col items-center justify-center">
                                        <span className="text-xs font-bold text-red-600 dark:text-red-400">SUN</span>
                                        <Flag className="h-4 w-4 text-red-500"/>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-medium">The Race</h4>
                                    <p className="text-sm text-muted-foreground">
                                        The main event! Drivers line up on the grid, lights go out, and they race
                                        for about 90 minutes. Points are awarded to the top 10 finishers.
                                        This is what we're predicting in Prix Six!
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                            <span className="font-medium text-amber-700 dark:text-amber-400">Sprint Weekends:</span>
                            <span className="text-muted-foreground ml-1">
                                Some races have a shorter "Sprint" race on Saturday for extra points.
                                Prix Six covers these separately!
                            </span>
                        </div>
                    </div>

                    {/* Understanding Results */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Award className="h-5 w-5 text-amber-500"/>
                            Understanding Race Results
                        </h3>
                        <div className="grid sm:grid-cols-3 gap-3">
                            <div className="p-4 rounded-lg border text-center">
                                <div className="text-3xl mb-2">🥇🥈🥉</div>
                                <h4 className="font-medium text-sm">The Podium</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Top 3 finishers stand on the podium, spray champagne (or rosewater!),
                                    and collect trophies
                                </p>
                            </div>
                            <div className="p-4 rounded-lg border text-center">
                                <div className="text-3xl mb-2">⚡</div>
                                <h4 className="font-medium text-sm">Fastest Lap</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    The quickest single lap set during a race - a badge of honour
                                    but no longer awards bonus points (rule removed in 2025)
                                </p>
                            </div>
                            <div className="p-4 rounded-lg border text-center">
                                <div className="text-3xl mb-2">🚫</div>
                                <h4 className="font-medium text-sm">DNF</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    "Did Not Finish" - when a car retires due to a crash,
                                    mechanical failure, or other issues
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Key Terms */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Book className="h-5 w-5 text-cyan-500"/>
                            Key Terms You'll Hear
                        </h3>
                        <div className="grid sm:grid-cols-2 gap-3 text-sm">
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Pit Stop</span>
                                    <p className="text-muted-foreground">When a car stops in the pit lane to change tyres or make repairs. Teams aim for under 2 seconds!</p>
                                </div>
                            </div>
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Active Aero (2026)</span>
                                    <p className="text-muted-foreground">Cars have adjustable wings - 'Straight Mode' (low drag) and 'Corner Mode' (high downforce), replacing the old DRS system</p>
                                </div>
                            </div>
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Undercut / Overcut</span>
                                    <p className="text-muted-foreground">Strategy moves - pitting earlier or later than rivals to gain track position</p>
                                </div>
                            </div>
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Grid Penalty</span>
                                    <p className="text-muted-foreground">When a driver has to start further back as punishment for breaking rules or changing engine parts</p>
                                </div>
                            </div>
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Safety Car</span>
                                    <p className="text-muted-foreground">When there's a crash or debris, a safety car leads the pack at slow speed until it's cleared</p>
                                </div>
                            </div>
                            <div className="flex gap-3 p-3 rounded-lg border">
                                <CircleDot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5"/>
                                <div>
                                    <span className="font-medium">Tyre Compounds</span>
                                    <p className="text-muted-foreground">Soft (fast but wear quickly), Medium (balanced), Hard (slower but last longer) - shown as red, yellow, white</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Where to Learn More */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <ExternalLink className="h-5 w-5 text-indigo-500"/>
                            Want to Go Deeper?
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            You definitely don't need to know all the rules to enjoy Prix Six - just pick drivers
                            you think will do well! But if you're curious about the official regulations:
                        </p>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <a
                                href="https://www.fia.com/regulation/category/110"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-4 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors group"
                            >
                                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                                    <Car className="h-5 w-5 text-red-500"/>
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium flex items-center gap-1">
                                        Technical Regulations
                                        <ChevronRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform"/>
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        Rules about how cars must be built (FIA official)
                                    </p>
                                </div>
                            </a>
                            <a
                                href="https://www.fia.com/regulation/category/110"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-4 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors group"
                            >
                                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                    <Flag className="h-5 w-5 text-blue-500"/>
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium flex items-center gap-1">
                                        Sporting Regulations
                                        <ChevronRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform"/>
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        Rules about racing conduct and procedures (FIA official)
                                    </p>
                                </div>
                            </a>
                        </div>
                        <p className="text-xs text-muted-foreground italic">
                            The FIA (Fédération Internationale de l'Automobile) is the governing body that creates
                            and enforces all F1 rules - think of them as the referees of motorsport.
                        </p>
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
                        Got questions, spotted a bug, or have a suggestion? Use the{' '}
                        <a href="/dashboard" className="text-primary underline hover:no-underline">
                            Bug Report / Feature Request
                        </a>
                        {' '}form on the Dashboard or drop us a message at{' '}
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
