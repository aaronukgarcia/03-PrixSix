// GUID: CRON_WHATSAPP_SCHEDULED-000-v01
// Auth:   CRON_SECRET bearer token (timing-safe), same pattern as the other cron routes.
// Runs:   every ~30 min via the whatsAppScheduledTick Cloud Function.
// [Intent] Time-driven WhatsApp alerts that the per-event call sites can't do: prediction-deadline
//          reminders (24h + 2h before qualifying lock), a late-prediction warning listing who still
//          hasn't predicted, a race-start reminder, and a weekly standings post. Each is gated by its
//          whatsapp_alerts toggle (via sendWhatsAppAlert) and de-duplicated in
//          admin_configuration/whatsappScheduledState so it fires once.
// [Downstream Impact] Enqueues whatsapp_queue messages (which wake the worker). Idempotent per tick.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { getRaceSchedule } from '@/lib/race-schedule-server';
import { sendWhatsAppAlert } from '@/lib/whatsapp-alert';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap } from '@/lib/cumulative-standings';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;

function isAuthorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? '').replace(/^﻿/, '');
  if (!secret) return false;
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ISO week key (year-Www) for weekly dedup
function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const actions: string[] = [];

  try {
    const { db, FieldValue } = await getFirebaseAdmin();
    const stateRef = db.collection('admin_configuration').doc('whatsappScheduledState');
    const state = (await stateRef.get()).data() || {};
    const races: Record<string, any> = state.races || {};
    const weekly: Record<string, boolean> = state.weekly || {};

    const schedule = await getRaceSchedule();

    // ── Per-race deadline / race reminders ────────────────────────────────
    // Find the next race whose prediction deadline (qualifyingTime) is still in the future.
    const upcoming = schedule
      .filter(r => r.qualifyingTime && new Date(r.qualifyingTime).getTime() > now - 2 * HOUR)
      .sort((a, b) => new Date(a.qualifyingTime).getTime() - new Date(b.qualifyingTime).getTime());

    const next = upcoming[0];
    if (next) {
      const key = String(next.round);
      const rstate = races[key] || {};
      const deadline = new Date(next.qualifyingTime).getTime();
      const raceStart = next.raceTime ? new Date(next.raceTime).getTime() : null;
      const fmt = (ms: number) => Math.round(ms / HOUR);

      // 24h nudge — first tick inside the 24h window (but before the 2h window)
      if (!rstate.sent24 && now >= deadline - 24 * HOUR && now < deadline - 2 * HOUR) {
        const res = await sendWhatsAppAlert('qualifyingReminder',
          `⏰ *Predictions for ${next.name} close in ~${fmt(deadline - now)}h* (at qualifying). Get your six in! 🏎️`);
        if (res.queued !== false) { rstate.sent24 = true; actions.push(`24h:${next.name}`); }
      }
      // 2h final call
      if (!rstate.sent2 && now >= deadline - 2 * HOUR && now < deadline) {
        const res = await sendWhatsAppAlert('qualifyingReminder',
          `🚨 *Last chance — predictions for ${next.name} close in under 2 hours!* Lock in your picks now.`);
        if (res.queued !== false) { rstate.sent2 = true; actions.push(`2h:${next.name}`); }
      }
      // Late-prediction warning (~3h before): list who still hasn't predicted
      if (!rstate.sentLate && now >= deadline - 3 * HOUR && now < deadline) {
        const missing = await getNonPredictors(db, next);
        if (missing.length > 0) {
          const res = await sendWhatsAppAlert('latePredictionWarning',
            `📋 *Still to predict ${next.name}:*\n${missing.map(m => `• ${m}`).join('\n')}\n\nClock's ticking! ⏳`);
          if (res.queued !== false) { rstate.sentLate = true; actions.push(`late:${next.name}`); }
        } else {
          rstate.sentLate = true; // everyone predicted — nothing to send, but mark done
        }
      }
      // Race-start reminder (~1h before lights out)
      if (raceStart && !rstate.sentRace && now >= raceStart - HOUR && now < raceStart) {
        const res = await sendWhatsAppAlert('raceReminder',
          `🏁 *${next.name} starts in ~${fmt(raceStart - now)}h!* Good luck — may your six be perfect. 🍀`);
        if (res.queued !== false) { rstate.sentRace = true; actions.push(`race:${next.name}`); }
      }
      races[key] = rstate;
    }

    // ── Weekly standings (Monday 18:00–18:59 Europe/London, once per ISO week) ─
    const londonNow = new Date(now);
    const londonHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }).format(londonNow));
    const londonDow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(londonNow);
    const wk = isoWeekKey(londonNow);
    if (londonDow === 'Mon' && londonHour === 18 && !weekly[wk]) {
      const standings = await buildStandingsText(db);
      if (standings) {
        const res = await sendWhatsAppAlert('weeklyStandingsUpdate', `📊 *Prix Six — Weekly Standings*\n\n${standings}`);
        if (res.queued !== false) { weekly[wk] = true; actions.push(`weekly:${wk}`); }
      }
    }

    await stateRef.set({ races, weekly, lastTickAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ success: true, actions });
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'production') console.error('[cron/whatsapp-scheduled]', error?.message);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

// Active teams (users with a teamName) that have NOT predicted the given race.
async function getNonPredictors(db: FirebaseFirestore.Firestore, race: { name: string }): Promise<string[]> {
  const usersSnap = await db.collection('users').get();
  const teams = new Map<string, string>(); // uid -> teamName
  usersSnap.forEach(d => { const x = d.data(); if (x.teamName) teams.set(d.id, x.teamName); });

  // A prediction doc lives at users/{uid}/predictions/{teamId}_{raceId}. Match by normalised race name.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const raceKey = norm(race.name);
  const predSnap = await db.collectionGroup('predictions').get();
  const predicted = new Set<string>();
  predSnap.forEach(d => {
    const uid = d.ref.parent.parent?.id;
    if (!uid) return;
    const data = d.data();
    const docRace = norm(`${data.raceId || d.id}`);
    if (docRace.includes(raceKey) || raceKey.includes(docRace)) predicted.add(uid);
  });
  return [...teams.entries()].filter(([uid]) => !predicted.has(uid)).map(([, name]) => name).sort();
}

// Top standings as a compact WhatsApp text block.
async function buildStandingsText(db: FirebaseFirestore.Firestore): Promise<string | null> {
  try {
    const { scores } = await computeRaceScores(db);
    const names = await buildTeamNamesMap(db);
    const standings = aggregateStandings(scores, names);
    if (!standings || standings.length === 0) return null;
    return standings.slice(0, 10)
      .map((s: any, i: number) => `${i + 1}. ${s.teamName} — ${s.totalPoints}`)
      .join('\n');
  } catch {
    return null;
  }
}
