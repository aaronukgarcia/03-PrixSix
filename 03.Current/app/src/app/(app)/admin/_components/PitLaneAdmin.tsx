'use client';

// GUID: ADMIN_PIT_LANE-000-v01
// [Intent] Admin panel component for monitoring and overriding the pit lane open/closed state.
//          The pit lane auto-opens/closes by clock (qualifying time). This panel lets an admin
//          force-open, force-close, or clear the override back to automatic.
//          Shows live countdowns to qualifying and race in BOTH track local time and admin's local time.
//          All override actions are written to audit_logs via /api/admin/pit-lane.
// [Inbound Trigger] Rendered inside the "Pit Lane" admin tab.
// [Downstream Impact] Writes to app-settings/pit-lane (read by predictions page, dashboard,
//                     submit-prediction API). Writes to audit_logs.

import { useAuth, useFirestore, useDoc, useCollection } from "@/firebase";
import { findNextRace, RaceSchedule } from "@/lib/data";
import { useMemo, useState, useEffect } from "react";
import { doc, collection, query, where, orderBy, limit } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Unlock, RotateCcw, Flag, Timer, CheckCircle2, AlertCircle, Info, Clock } from "lucide-react";

// GUID: ADMIN_PIT_LANE-001-v01
// [Intent] Format a UTC ISO datetime string in a given IANA timezone for track-local display.
//          Uses Intl.DateTimeFormat (no external library).
// [Inbound Trigger] Called by countdown cards to render track-local qualifying/race times.
function formatInTimezone(isoString: string, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit',
            timeZoneName: 'short',
        }).format(new Date(isoString));
    } catch {
        return new Date(isoString).toUTCString();
    }
}

// GUID: ADMIN_PIT_LANE-002-v01
// [Intent] Format a UTC ISO datetime string in the browser's local timezone for admin display.
function formatLocal(isoString: string): string {
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short',
    }).format(new Date(isoString));
}

// GUID: ADMIN_PIT_LANE-003-v01
// [Intent] Compute a human-readable countdown string from now to a target date.
//          Returns "NOW / PAST" if target is in the past.
function formatCountdown(targetIso: string): string {
    const diff = new Date(targetIso).getTime() - Date.now();
    if (diff <= 0) return 'Started / Past';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

// GUID: ADMIN_PIT_LANE-004-v01
// [Intent] Compute the effective pit lane state from the admin override + automatic clock logic.
//          Auto logic: open if qualifying time is in the future AND race has no results doc.
//          Override 'open' / 'close' take precedence over auto.
// [Inbound Trigger] Called on every render with current Firestore pit-lane doc data.
function computeEffectiveState(
    override: string | null | undefined,
    nextRaceQualifyingTime: string,
    hasResults: boolean,
): { effective: boolean; reason: string } {
    const autoOpen = !hasResults && new Date(nextRaceQualifyingTime) > new Date();
    if (override === 'open')  return { effective: true,     reason: 'Admin override: force open'  };
    if (override === 'close') return { effective: false,    reason: 'Admin override: force closed' };
    if (hasResults)           return { effective: false,    reason: 'Auto: race results entered'   };
    if (!autoOpen)            return { effective: false,    reason: 'Auto: qualifying has started' };
    return                           { effective: true,     reason: 'Auto: qualifying not started' };
}

// GUID: ADMIN_PIT_LANE-005-v01
// [Intent] Main PitLaneAdmin component. Subscribes to app-settings/pit-lane and race_results
//          to compute and display effective pit lane state. Provides override controls with
//          two-step confirm. Shows dual-timezone countdowns for qualifying and race.
export function PitLaneAdmin() {
    const { firebaseUser } = useAuth();
    const firestore = useFirestore();
    const [isActing, setIsActing] = useState(false);
    const [pendingAction, setPendingAction] = useState<'open' | 'close' | 'clear' | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

    // GUID: ADMIN_PIT_LANE-006-v01
    // [Intent] Subscribe to app-settings/pit-lane in real-time to reflect current override state.
    const pitLaneRef = useMemo(() => {
        if (!firestore) return null;
        const ref = doc(firestore, 'app-settings', 'pit-lane');
        (ref as any).__memo = true;
        return ref;
    }, [firestore]);
    const { data: pitLane } = useDoc(pitLaneRef);

    // GUID: ADMIN_PIT_LANE-007-v01
    // [Intent] Subscribe to race_results to detect if current race has results (auto-close trigger).
    const raceResultsRef = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'race_results'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);
    const { data: raceResults } = useCollection<{ id: string }>(raceResultsRef);

    // Find next race (first unscored)
    const nextRace = useMemo(() => {
        const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
        for (const race of RaceSchedule) {
            const gpId = `${race.name.replace(/\s+/g, '-').toLowerCase()}-gp`;
            if (!resultIds.has(gpId)) return race;
        }
        return findNextRace();
    }, [raceResults]);

    const hasResults = useMemo(() => {
        const resultIds = new Set((raceResults || []).map(r => r.id.toLowerCase()));
        const gpId = `${nextRace.name.replace(/\s+/g, '-').toLowerCase()}-gp`;
        return resultIds.has(gpId);
    }, [raceResults, nextRace]);

    const override = pitLane?.override ?? null;
    const { effective: isOpen, reason } = computeEffectiveState(override, nextRace.qualifyingTime, hasResults);

    // GUID: ADMIN_PIT_LANE-008-v01
    // [Intent] Live countdown tick — update every second for qualifying and race.
    const [qualCountdown, setQualCountdown] = useState('');
    const [raceCountdown, setRaceCountdown] = useState('');
    useEffect(() => {
        const tick = () => {
            setQualCountdown(formatCountdown(nextRace.qualifyingTime));
            setRaceCountdown(formatCountdown(nextRace.raceTime));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [nextRace]);

    // GUID: ADMIN_PIT_LANE-009-v01
    // [Intent] Execute the admin override action — POST to /api/admin/pit-lane.
    //          Writes both the override state and audit log (server-side batch).
    const executeAction = async (action: 'open' | 'close' | 'clear') => {
        if (!firebaseUser) return;
        setIsActing(true);
        setFeedback(null);
        try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch('/api/admin/pit-lane', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const label = action === 'open' ? 'Force-opened' : action === 'close' ? 'Force-closed' : 'Override cleared';
            setFeedback({ type: 'ok', msg: `${label}. Audit log written.` });
        } catch (err: any) {
            setFeedback({ type: 'err', msg: `Action failed: ${err.message}` });
        } finally {
            setIsActing(false);
            setPendingAction(null);
        }
    };

    const handleAction = (action: 'open' | 'close' | 'clear') => {
        if (pendingAction === action) {
            executeAction(action);
        } else {
            setPendingAction(action);
            setFeedback(null);
        }
    };

    const overriddenAt = pitLane?.overriddenAt?.toDate?.()
        ? new Date(pitLane.overriddenAt.toDate()).toLocaleString('en-GB')
        : null;

    return (
        <div className="space-y-4">

            {/* ── Status + Controls ── */}
            {/* GUID: ADMIN_PIT_LANE-010-v01 */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                {isOpen
                                    ? <Unlock className="h-5 w-5 text-green-500" />
                                    : <Lock className="h-5 w-5 text-red-500" />}
                                Pit Lane — {nextRace.name}
                            </CardTitle>
                            <CardDescription className="mt-1">{reason}</CardDescription>
                        </div>
                        <Badge
                            className={`text-base px-4 py-1.5 ${isOpen
                                ? 'bg-green-500 hover:bg-green-500 text-white'
                                : 'bg-red-600 hover:bg-red-600 text-white'}`}
                        >
                            {isOpen ? 'OPEN' : 'CLOSED'}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">

                    {/* Override info */}
                    {override && (
                        <Alert className="border-amber-500/50 bg-amber-50/10">
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                            <AlertDescription className="text-amber-700 dark:text-amber-300">
                                <span className="font-semibold">Override active:</span> {override === 'open' ? 'Force OPEN' : 'Force CLOSED'}
                                {pitLane?.overriddenBy && <> by <span className="font-mono">{pitLane.overriddenBy}</span></>}
                                {overriddenAt && <> at {overriddenAt}</>}
                            </AlertDescription>
                        </Alert>
                    )}

                    {!override && (
                        <Alert className="border-blue-500/30 bg-blue-50/10">
                            <Info className="h-4 w-4 text-blue-500" />
                            <AlertDescription className="text-blue-700 dark:text-blue-300">
                                <span className="font-semibold">Automatic mode:</span> pit lane opens/closes by clock. Use override buttons below to force a state.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Feedback */}
                    {feedback && (
                        <Alert className={feedback.type === 'ok' ? 'border-green-500/50' : 'border-red-500/50'}>
                            {feedback.type === 'ok'
                                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                : <AlertCircle className="h-4 w-4 text-red-500" />}
                            <AlertDescription>{feedback.msg}</AlertDescription>
                        </Alert>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2">
                        {/* Force Open */}
                        <Button
                            variant={pendingAction === 'open' ? 'default' : 'outline'}
                            className={pendingAction === 'open' ? 'bg-green-600 hover:bg-green-700 text-white' : 'border-green-500 text-green-600 hover:bg-green-50'}
                            disabled={isActing}
                            onClick={() => handleAction('open')}
                        >
                            <Unlock className="h-4 w-4 mr-2" />
                            {pendingAction === 'open' ? 'Confirm Force Open' : 'Force Open'}
                        </Button>

                        {/* Force Close */}
                        <Button
                            variant={pendingAction === 'close' ? 'destructive' : 'outline'}
                            className={pendingAction !== 'close' ? 'border-red-500 text-red-600 hover:bg-red-50' : ''}
                            disabled={isActing}
                            onClick={() => handleAction('close')}
                        >
                            <Lock className="h-4 w-4 mr-2" />
                            {pendingAction === 'close' ? 'Confirm Force Close' : 'Force Close'}
                        </Button>

                        {/* Clear Override */}
                        {override && (
                            <Button
                                variant={pendingAction === 'clear' ? 'default' : 'outline'}
                                disabled={isActing}
                                onClick={() => handleAction('clear')}
                            >
                                <RotateCcw className="h-4 w-4 mr-2" />
                                {pendingAction === 'clear' ? 'Confirm Clear Override' : 'Clear Override (use clock)'}
                            </Button>
                        )}

                        {/* Cancel confirm */}
                        {pendingAction && (
                            <Button
                                variant="ghost"
                                disabled={isActing}
                                onClick={() => setPendingAction(null)}
                            >
                                Cancel
                            </Button>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        All override actions are recorded in the audit log.
                    </p>
                </CardContent>
            </Card>

            {/* ── Countdowns ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Qualifying countdown */}
                {/* GUID: ADMIN_PIT_LANE-011-v01 */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Flag className="h-4 w-4 text-primary" />
                            Qualifying
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-3xl font-bold font-mono tabular-nums ${
                            new Date(nextRace.qualifyingTime) <= new Date() ? 'text-muted-foreground' : ''
                        }`}>
                            {qualCountdown}
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                            <div>
                                <span className="font-medium text-foreground">Track ({nextRace.location}):</span>{' '}
                                {formatInTimezone(nextRace.qualifyingTime, nextRace.trackTimezone)}
                            </div>
                            <div>
                                <span className="font-medium text-foreground">Your time:</span>{' '}
                                {formatLocal(nextRace.qualifyingTime)}
                            </div>
                        </div>
                        <div className="mt-3 text-xs text-amber-600 dark:text-amber-400 font-medium">
                            Close pit lane BEFORE this time
                        </div>
                    </CardContent>
                </Card>

                {/* Race countdown */}
                {/* GUID: ADMIN_PIT_LANE-012-v01 */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Timer className="h-4 w-4 text-primary" />
                            Race Start
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-3xl font-bold font-mono tabular-nums ${
                            new Date(nextRace.raceTime) <= new Date() ? 'text-muted-foreground' : ''
                        }`}>
                            {raceCountdown}
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                            <div>
                                <span className="font-medium text-foreground">Track ({nextRace.location}):</span>{' '}
                                {formatInTimezone(nextRace.raceTime, nextRace.trackTimezone)}
                            </div>
                            <div>
                                <span className="font-medium text-foreground">Your time:</span>{' '}
                                {formatLocal(nextRace.raceTime)}
                            </div>
                        </div>
                        <div className="mt-3 text-xs text-blue-600 dark:text-blue-400 font-medium">
                            Enter results after the race to auto-advance to next race
                        </div>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}
