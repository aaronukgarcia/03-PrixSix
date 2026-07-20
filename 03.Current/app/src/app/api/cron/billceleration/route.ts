// GUID: CRON_BILLCELERATION-000-v01
// Auth:   CRON_SECRET bearer token (timing-safe), same pattern as the other cron routes.
// Runs:   at :10 :25 :40 :55 every hour via the billcelerationTick Cloud Function
//         (Europe/London) — the :55 tick hits the 06:55 daily slot exactly; the 15-min grid
//         gives the final-call slot a 0-15 min margin before qualifying closes.
// [Intent] The Billceleration autonomous AI team's brain-stem (v3.7.0). Decides whether this
//          tick is a submission slot (daily 06:55 on hot-news days, or the final call in the
//          last hour before the pit lane shuts), gathers verified inputs (rival pack, real WDC
//          form, headlines, trackside, weather), asks the Gemini picker for six, validates the
//          answer against the F1Drivers roster, and submits through the REAL
//          /api/submit-prediction route with a minted bot ID token — so every deadline gate and
//          the splitbrain roast/WhatsApp pipeline fire exactly as for a human submission.
// [Inbound Trigger] POST from billcelerationTick (functions/index.js) every 15 minutes.
// [Downstream Impact] Prediction docs for team Billceleration; billceleration_log history;
//          GR#17 status doc admin_configuration/billcelerationStatus written on EVERY exit path
//          (checked by /health-check CHECK 11, maxAgeH 2). Kill switch:
//          admin_configuration/billceleration.enabled (10-min config cache).
// [Season gate] Route-local: "some race has qualifyingTime in (now, now+7d]". Deliberately
//          simpler than the inSeason/isRaceWeek closures inline in functions/index.js
//          publishHotNewsToWhatsApp (extracting those is out of scope; divergence documented).

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { getRaceSchedule, RaceScheduleDoc } from '@/lib/race-schedule-server';
import { getBotConfig, mintBotIdToken, buildPackSummary, submitAsBot } from '@/lib/billceleration';
import { pickBillcelerationSix, PickerOutput } from '@/ai/flows/billceleration-picker';
import { fetchRealWdcByDriverId, buildTracksideNewsFacts } from '@/lib/cheeky-bill-context';
import { fetchF1Standings, fetchF1Headlines, getVenueWeatherLine } from '@/ai/flows/hot-news-feed';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { F1Drivers } from '@/lib/data';
import { generateRaceId } from '@/lib/normalize-race-id';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

// GUID: CRON_BILLCELERATION-001-v01
// [Intent] GR#17 heartbeat: write the status doc on EVERY exit path, including no-ops, so
//          /health-check CHECK 11 can hold a tight 2h freshness bound year-round — the state
//          field explains WHY the bot was idle, the timestamp proves the tick is alive.
// [Inbound Trigger] Every return path of the POST handler.
// [Downstream Impact] admin_configuration/billcelerationStatus; never throws (best-effort).
async function writeStatus(db: FirebaseFirestore.Firestore, state: string, detail: string, correlationId: string): Promise<void> {
  try {
    await db.collection('admin_configuration').doc('billcelerationStatus').set({
      lastRunAt: new Date().toISOString(),
      state,
      detail,
      correlationId,
    });
  } catch (err: any) {
    console.error('[cron/billceleration] status write failed:', err?.message || err);
  }
}

// GUID: CRON_BILLCELERATION-002-v01
// [Intent] Validate a picker answer against the live roster: exactly six, unique, every id a
//          real F1Drivers id (GR#15 — the allowlist derives from data, never hardcoded).
// [Inbound Trigger] After each picker call, before any submission.
// [Downstream Impact] Returns the reason string on failure (fed back to the retry prompt).
function validatePicks(picks: unknown): string | null {
  if (!Array.isArray(picks) || picks.length !== 6) return 'need exactly 6 picks';
  const valid = new Set(F1Drivers.map((d) => d.id));
  const seen = new Set<string>();
  for (const p of picks) {
    if (typeof p !== 'string' || !valid.has(p)) return `"${String(p)}" is not a legal roster id`;
    if (seen.has(p)) return `"${p}" appears more than once`;
    seen.add(p);
  }
  return null;
}

// GUID: CRON_BILLCELERATION-003-v01
// [Intent] Deterministic fallback ladder when the picker fails twice: (1) real WDC top-6 in
//          order with a canned sheep rationale; (2) the bot's previous picks for this race
//          unchanged; (3) null = skip the slot (status 'error', claim released for retry).
// [Inbound Trigger] Picker invalid/thrown after the feedback retry.
// [Downstream Impact] Fallback picks are always legal roster ids; fallbackUsed is logged.
async function fallbackPicks(previousOwn: string[] | null): Promise<{ picks: string[]; rationale: string; selfDoubt: string; fallbackUsed: string } | null> {
  const wdc = await fetchRealWdcByDriverId().catch(() => null);
  if (wdc) {
    const valid = new Set(F1Drivers.map((d) => d.id));
    const top6 = [...wdc.entries()]
      .filter(([id]) => valid.has(id))
      .sort((a, b) => a[1].rank - b[1].rank)
      .slice(0, 6)
      .map(([id]) => id);
    if (top6.length === 6) {
      return {
        picks: top6,
        rationale: "I copied the form book, driver for driver. I am following the pack because we are all sheep.",
        selfDoubt: 'Zero imagination has never once won a countback.',
        fallbackUsed: 'wdc-top6',
      };
    }
  }
  if (previousOwn && previousOwn.length === 6) {
    return {
      picks: previousOwn,
      rationale: 'Sticking with my previous six. Decisiveness, or a fancy word for giving up.',
      selfDoubt: 'Doing the same thing twice and expecting different points.',
      fallbackUsed: 'previous-own',
    };
  }
  return null;
}

// GUID: CRON_BILLCELERATION-004-v01
// [Intent] POST handler: slot decision → transactional claim → input gathering → picker with
//          one feedback retry → fallback ladder → persist lastPick + billceleration_log →
//          submit via the real route (per session; sprint weekends submit Sprint AND GP).
// [Inbound Trigger] billcelerationTick, every 15 min.
// [Downstream Impact] See file header. Transactional claim-before-work prevents double
//          submission from overlapping ticks; hard failure releases the claim so the next
//          in-window tick retries.
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const correlationId = generateCorrelationId();
  const now = Date.now();
  const { db, FieldValue } = await getFirebaseAdmin();

  try {
    const cfg = await getBotConfig(db);
    if (!cfg || !cfg.enabled) {
      await writeStatus(db, 'disabled', cfg ? 'enabled=false' : 'config doc missing', correlationId);
      return NextResponse.json({ success: true, state: 'disabled' });
    }

    const schedule = await getRaceSchedule();
    const candidates = schedule
      .filter((r) => {
        const dl = r.qualifyingTime ? new Date(r.qualifyingTime).getTime() : NaN;
        return Number.isFinite(dl) && dl > now && dl <= now + 7 * DAY;
      })
      .sort((a, b) => new Date(a.qualifyingTime).getTime() - new Date(b.qualifyingTime).getTime());

    if (candidates.length === 0) {
      await writeStatus(db, 'idle-offseason', 'no race with a submission deadline in the next 7 days', correlationId);
      return NextResponse.json({ success: true, state: 'idle-offseason' });
    }

    const race = candidates[0];
    const deadline = new Date(race.qualifyingTime).getTime();

    // Admin force-close beats the clock — save a doomed Gemini call (the submit route
    // re-enforces this regardless).
    const pitLane = (await db.collection('app-settings').doc('pit-lane').get()).data();
    if (pitLane?.override === 'close') {
      await writeStatus(db, 'pitlane-closed', `admin override close; next race ${race.name}`, correlationId);
      return NextResponse.json({ success: true, state: 'pitlane-closed' });
    }

    // ── Slot decision (London wall-clock) ─────────────────────────────────
    const londonParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(now));
    const part = (t: string) => londonParts.find((p) => p.type === t)?.value || '';
    const londonDow = part('weekday');
    const londonMinutes = Number(part('hour')) * 60 + Number(part('minute'));
    const todayLondon = `${part('year')}-${part('month')}-${part('day')}`;

    const stateRef = db.collection('admin_configuration').doc('billcelerationState');
    const raceKey = String(race.round);

    const preState = (await stateRef.get()).data() || {};
    const isFinalWindow = now >= deadline - HOUR && now < deadline && !(preState.finalDone || {})[raceKey];
    // Daily: hot-news days (Sun/Thu/Fri/Sat), 06:55-07:25 London — the :55 tick lands first.
    const isDailyWindow = ['Sun', 'Thu', 'Fri', 'Sat'].includes(londonDow)
      && londonMinutes >= 6 * 60 + 55 && londonMinutes < 7 * 60 + 25
      && preState.lastDailyDate !== todayLondon;

    const slot: 'final' | 'daily' | null = isFinalWindow ? 'final' : isDailyWindow ? 'daily' : null;
    if (!slot) {
      await writeStatus(db, 'idle-waiting', `next deadline ${race.qualifyingTime} (${race.name})`, correlationId);
      return NextResponse.json({ success: true, state: 'idle-waiting' });
    }

    // ── Transactional slot claim (claim-before-work) ──────────────────────
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      const s = snap.data() || {};
      if (slot === 'final') {
        if ((s.finalDone || {})[raceKey]) return false;
        tx.set(stateRef, { finalDone: { ...(s.finalDone || {}), [raceKey]: true } }, { merge: true });
      } else {
        if (s.lastDailyDate === todayLondon) return false;
        tx.set(stateRef, { lastDailyDate: todayLondon }, { merge: true });
      }
      return true;
    });
    if (!claimed) {
      await writeStatus(db, 'already-done', `${slot} slot already claimed for ${race.name}`, correlationId);
      return NextResponse.json({ success: true, state: 'already-done' });
    }

    const releaseClaim = async () => {
      try {
        if (slot === 'final') {
          await stateRef.set({ finalDone: { [raceKey]: FieldValue.delete() } }, { merge: true });
        } else {
          await stateRef.set({ lastDailyDate: FieldValue.delete() }, { merge: true });
        }
      } catch { /* best-effort */ }
    };

    try {
      // ── Gather inputs (parallel, each degrades to '') ───────────────────
      const sessions: ('sprint' | 'gp')[] = race.hasSprint ? ['sprint', 'gp'] : ['gp'];
      const prevOwnBySession = new Map<string, string[] | null>();
      for (const session of sessions) {
        const raceId = generateRaceId(race.name, session);
        const doc = await db.collection('users').doc(cfg.uid).collection('predictions').doc(`${cfg.uid}_${raceId}`).get().catch(() => null);
        const arr = doc?.exists ? (doc.data() as any)?.predictions : null;
        prevOwnBySession.set(session, Array.isArray(arr) && arr.length === 6 ? arr : null);
      }
      const anyPrev = prevOwnBySession.get('gp') || prevOwnBySession.get('sprint') || null;

      const rosterBlock = F1Drivers.map((d) => `${d.id} — ${d.name} (${d.team})`).join('\n');
      const [packSummary, wdcFormBlock, headlines, tracksideBlock, weatherLine] = await Promise.all([
        buildPackSummary(db, generateRaceId(race.name, 'gp'), cfg.uid).catch(() => ''),
        fetchF1Standings().then((s) => s || '').catch(() => ''),
        fetchF1Headlines().then((h) => h.map((x) => `- ${x}`).join('\n')).catch(() => ''),
        buildTracksideNewsFacts(anyPrev || F1Drivers.slice(0, 6).map((d) => d.id)).catch(() => ''),
        getVenueWeatherLine(race.location).catch(() => ''),
      ]);

      // ── Pick + submit per session ───────────────────────────────────────
      const idToken = await mintBotIdToken(cfg.uid);
      const results: { session: string; picks: string[]; fallbackUsed?: string }[] = [];
      let lastPickForRoast: { raceId: string; rationale: string; selfDoubt: string } | null = null;

      for (const session of sessions) {
        const raceId = generateRaceId(race.name, session);
        const previousOwn = prevOwnBySession.get(session) || null;
        const baseInput = {
          raceName: sanitizeForPrompt(race.name, 80) || 'the next race',
          session,
          slot,
          hoursToQuali: Math.max(0, Math.round(((deadline - now) / HOUR) * 10) / 10),
          rosterBlock,
          packSummary,
          wdcFormBlock,
          headlinesBlock: headlines,
          tracksideBlock,
          weatherLine,
          previousOwnPicks: previousOwn
            ? previousOwn.map((id, i) => `${i + 1}. ${id}`).join('\n')
            : '(none yet for this race)',
          validationFeedback: '',
        };

        let out: PickerOutput | null = null;
        let fallbackUsed: string | undefined;
        try {
          out = await pickBillcelerationSix(baseInput);
          let reason = validatePicks(out.picks);
          if (reason) {
            out = await pickBillcelerationSix({ ...baseInput, validationFeedback: reason });
            reason = validatePicks(out.picks);
            if (reason) out = null;
          }
        } catch (err: any) {
          console.error(`[cron/billceleration] picker failed (${session}):`, err?.message || err);
          out = null;
        }
        if (!out) {
          const fb = await fallbackPicks(previousOwn);
          if (!fb) {
            throw new Error(`no picks available for ${session} (picker + all fallbacks failed)`);
          }
          out = { picks: fb.picks, rationale: fb.rationale, selfDoubt: fb.selfDoubt };
          fallbackUsed = fb.fallbackUsed;
        }

        // Persist the pick BEFORE submitting so the splitbrain roast can quote it.
        lastPickForRoast = { raceId, rationale: out.rationale, selfDoubt: out.selfDoubt };
        await stateRef.set({
          lastPick: {
            raceId,
            mode: slot,
            picks: out.picks,
            rationale: out.rationale,
            selfDoubt: out.selfDoubt,
            at: FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        await db.collection('billceleration_log').add({
          raceId,
          mode: slot,
          session,
          picks: out.picks,
          rationale: out.rationale,
          selfDoubt: out.selfDoubt,
          fallbackUsed: fallbackUsed || null,
          correlationId,
          at: FieldValue.serverTimestamp(),
        });

        await submitAsBot(idToken, cfg.uid, 'Billceleration', race, session, out.picks);
        results.push({ session, picks: out.picks, fallbackUsed });
      }

      await writeStatus(db, 'submitted',
        `${slot} slot for ${race.name}: ${results.map((r) => `${r.session}${r.fallbackUsed ? ` (fallback:${r.fallbackUsed})` : ''}`).join(', ')}`,
        correlationId);
      return NextResponse.json({ success: true, state: 'submitted', slot, race: race.name, results });
    } catch (slotErr: any) {
      await releaseClaim();
      console.error('[cron/billceleration] slot failed, claim released:', slotErr?.message || slotErr);
      await writeStatus(db, 'error', `${slot} slot for ${race.name} failed: ${String(slotErr?.message || slotErr).slice(0, 300)}`, correlationId);
      return NextResponse.json({ success: false, state: 'error', correlationId }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[cron/billceleration]', error?.message || error);
    await writeStatus(db, 'error', String(error?.message || error).slice(0, 300), correlationId);
    return NextResponse.json({ success: false, error: 'Internal error', correlationId }, { status: 500 });
  }
}
