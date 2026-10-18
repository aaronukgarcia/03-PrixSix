// GUID: LIB_WORKER_WINDOW-000-v01
// [Intent] COST-PROBE-001 (Aaron, 2026-10-14): the WhatsApp worker is an Azure Container App that
//          runs ONLY inside race windows (COST-CONTAINER-001, worker 2.2.7). Container Apps ingress
//          scales from zero on ANY HTTP request, so a mid-week health probe cold-starts a billed
//          replica and keeps it up for the cooldown — the admin health panel was doing that every
//          30 seconds while open. This module answers "is the worker scheduled to be on right now?"
//          so callers can skip the probe instead of waking the worker.
//          The window rule MUST match whatsapp-worker/scale-schedule.js (00:00 UTC three days before
//          race day to 00:00 UTC two days after); both derive from RaceSchedule in data.ts (GGR30:
//          from data, never typed). If the schedule script's --days-before / --days-after defaults
//          change, change DAYS_BEFORE / DAYS_AFTER here in the same commit.
// [Inbound Trigger] getWorkerWindow(now) from /api/admin/whatsapp/health (and any future caller
//                   that would otherwise contact the worker outside a race window).
// [Downstream Impact] A wrong window here either wakes the worker needlessly (cost) or hides a
//                     real outage during a race weekend (the panel would say "scheduled off" while
//                     the bot is actually down). Keep it in lock-step with the KEDA cron rules.

import { RaceSchedule } from '@/lib/data';

export const DAYS_BEFORE = 3;
export const DAYS_AFTER = 2;
const DAY_MS = 86_400_000;

export interface WorkerWindow {
    name: string;
    start: Date; // inclusive, 00:00Z
    end: Date;   // exclusive, 00:00Z
}

export interface WorkerWindowStatus {
    inWindow: boolean;
    current: WorkerWindow | null; // the window containing `now`, if any
    next: WorkerWindow | null;    // the first window starting after `now`, if any
}

// GUID: LIB_WORKER_WINDOW-001-v01
// [Intent] Build the race windows from the static calendar exactly as scale-schedule.js does:
//          utcMidnight(raceTime) - DAYS_BEFORE days  ..  utcMidnight(raceTime) + DAYS_AFTER days.
// [Inbound Trigger] getWorkerWindow.
// [Downstream Impact] Pure; returns windows sorted by start. Unparseable raceTime entries are
//                     skipped rather than thrown (a bad calendar row must not take the health
//                     route down), but the schedule script would refuse them, so they will be
//                     caught at the next worker deploy.
export function buildWorkerWindows(daysBefore = DAYS_BEFORE, daysAfter = DAYS_AFTER): WorkerWindow[] {
    const windows: WorkerWindow[] = [];
    for (const race of RaceSchedule) {
        const t = new Date(race.raceTime);
        if (Number.isNaN(t.getTime())) continue;
        const raceDay = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
        windows.push({
            name: race.name,
            start: new Date(raceDay - daysBefore * DAY_MS),
            end: new Date(raceDay + daysAfter * DAY_MS),
        });
    }
    return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// GUID: LIB_WORKER_WINDOW-002-v01
// [Intent] Is the worker scheduled on at `now`? Returns the containing window and the next one so
//          the caller can say "scheduled off until <date> (<race>)".
// [Inbound Trigger] /api/admin/whatsapp/health before it fetches the worker.
// [Downstream Impact] inWindow:false means "do not contact the worker"; callers must not treat it
//                     as an outage.
export function getWorkerWindow(now: Date = new Date()): WorkerWindowStatus {
    const ms = now.getTime();
    const windows = buildWorkerWindows();
    const current = windows.find((w) => ms >= w.start.getTime() && ms < w.end.getTime()) ?? null;
    const next = windows.find((w) => w.start.getTime() > ms) ?? null;
    return { inWindow: current !== null, current, next };
}
