// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       race_results (all), collectionGroup(predictions) via cumulative-standings,
//              users (team names), standings_adjustments, users/{uid}/predictions (one user),
//              api.jolpi.ca (external, cached 6h) for real WDC standings,
//              api.openf1.org (external, cached 60-90s) + Autosport RSS (external, cached 10min)
//              — only when includeTracksideNews is requested (news roast mode)
// Writes:      none — pure compute
// Errors:      none surfaced — decorative feature, every failure degrades to empty facts
// Idempotent:  yes
// Side-effects: none (module-level caches only)
// Key gotcha:  race_results docs only store the TOP 6 finishers (driver1..driver6).
//              A driver absent from lastRaceTop6 did NOT finish top 6 — we cannot say
//              where they actually finished. The prompt instructions account for this.
//              Previous-submission comparison is CROSS-RACE only: by the time the
//              fire-and-forget block runs, the same-race doc has already been
//              overwritten by the new submission (merge write in GUID-006).
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_CHEEKY_BILL_CONTEXT-000-v03
// @CHANGE (v3.6.0): news-correlated roast mode — buildTracksideNewsFacts combines OpenF1
//   race_control messages (live/recent session only, the low-latency "trackside news" source)
//   with Autosport RSS headlines (reused from HOT_NEWS_FLOW-011). Opt-in via
//   includeTracksideNews on the builder input; output gains newsFacts.
// @CHANGE (v3.4.14): situational awareness — adds previous-submission comparison facts
//   (identical / same-six-shuffled / wholesale changes vs the team's last cross-race
//   submission) and real-world form facts (picks' actual WDC positions via Jolpica,
//   outsider-pick and championship-table-copy flags). Builder input widened from a bare
//   teamId to { teamId, userId, raceId, predictions }.
// [Intent] Assembles factual banter ammunition for the Cheeky Bill AI roast: the last completed
//          race's official top-6 finishing order, the submitting team's current championship
//          position, how the new picks compare to the team's previous submission, and how the
//          picks stack up against the REAL F1 drivers' championship (the "form book"). Facts come
//          from the cumulative-standings SSOT helpers and the Jolpica API already used by the
//          hot-news bulletin (Golden Rule #3) so Bill's digs always match reality.
// [Inbound Trigger] Called by submit-prediction/route.ts inside the fire-and-forget WhatsApp
//          notification block, right before generateCheekyComment.
// [Downstream Impact] Output strings are interpolated into the Vertex AI prompt in
//          ai/flows/cheeky-bill.ts. Empty strings = Bill roasts without that fact (graceful degrade).

import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  readStandingsAdjustments,
  buildRaceRunMillisMap,
} from '@/lib/cumulative-standings';
import { normalizeRaceIdForComparison, generateRaceId } from '@/lib/normalize-race-id';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { RaceSchedule, F1Drivers } from '@/lib/data';
import type { getFirebaseAdmin } from '@/lib/firebase-admin';
import { getCachedToken, setCachedToken } from '@/lib/pit-wall-cache';
import { getSecret } from '@/lib/secrets-manager';
import { fetchF1Headlines } from '@/ai/flows/hot-news-feed';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

export interface CheekyBillContextInput {
  /** Primary user UID that owns the predictions subcollection. */
  userId: string;
  /** Team the submission belongs to: userId or `${userId}-secondary`. */
  teamId: string;
  /** Normalised raceId of the CURRENT submission (excluded from history comparison). */
  raceId: string;
  /** The six driver IDs just submitted, P1 first. */
  predictions: string[];
  /** When true (news roast mode only), also fetch OpenF1 race_control + RSS headline facts.
   *  Off by default so 2/3 of submissions never touch the external news endpoints. */
  includeTracksideNews?: boolean;
}

export interface CheekyBillContext {
  /** e.g. "Last completed race: British Grand Prix. Official top 6: P1 Verstappen, ... P6 Alonso.
   *  Any driver not listed did not finish in the top 6." Empty string if no results yet. */
  lastRaceFacts: string;
  /** e.g. "Team \"Kwik Fitties\" is currently P7 of 22 in the championship with 143 points
   *  (leader: Iron Maidens on 210)." Empty string if team/standings unavailable. */
  standingsFacts: string;
  /** Comparison against the team's previous (different-race) submission — identical /
   *  same-six-shuffled / wholesale changes. Empty string on first-ever submission. */
  previousSubmissionFacts: string;
  /** Real WDC positions of their picks + outsider / table-copy flags from Jolpica.
   *  Empty string if the standings feed is unavailable. */
  formFacts: string;
  /** Fresh trackside (OpenF1 race_control) + news-headline context for the news roast mode.
   *  Always '' unless includeTracksideNews was requested AND something relevant was found. */
  newsFacts: string;
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-001-v01
// [Intent] Module-level cache of the expensive Firestore aggregate (all race_results + all predictions
//          + all users). Prediction submissions cluster in the hours before qualifying, so a short
//          TTL saves hundreds of reads per burst while staying fresh enough for banter purposes.
// [Inbound Trigger] Read/written by buildCheekyBillContext on every call.
// [Downstream Impact] Worst case a roast quotes standings up to 10 minutes stale — acceptable for
//          a decorative comment; the standings page itself is unaffected.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; lastRaceFacts: string; standings: { rank: number; userId: string; teamName: string; totalPoints: number }[] } | null = null;

// GUID: LIB_CHEEKY_BILL_CONTEXT-002-v01
// [Intent] Find the most recent completed race (a race_results doc whose scheduled run time is
//          the latest) and render its official top-6 as a fact line for the prompt. Result doc
//          IDs are matched to RaceSchedule entries via normalizeRaceIdForComparison, so both
//          Title-Case and lowercase stored IDs resolve (SSOT-001 casing gotcha).
// [Inbound Trigger] Called by buildCheekyBillContext on cache miss.
// [Downstream Impact] Returns '' when no results exist (season start) — Bill roasts statless.
async function buildLastRaceFacts(db: AdminFirestore): Promise<string> {
  const snap = await db.collection('race_results').get();
  if (snap.empty) return '';

  // Map normalised schedule keys → { name, runMillis } for both GP and sprint sessions.
  const scheduleByKey = new Map<string, { label: string; runMillis: number }>();
  for (const race of RaceSchedule) {
    if (race.raceTime) {
      scheduleByKey.set(normalizeRaceIdForComparison(generateRaceId(race.name, 'gp')), {
        label: race.name,
        runMillis: new Date(race.raceTime).getTime(),
      });
    }
    if (race.hasSprint && race.sprintTime) {
      scheduleByKey.set(normalizeRaceIdForComparison(generateRaceId(race.name, 'sprint')), {
        label: `${race.name} (Sprint)`,
        runMillis: new Date(race.sprintTime).getTime(),
      });
    }
  }

  let best: { label: string; runMillis: number; top6: string[] } | null = null;
  snap.forEach((doc) => {
    const sched = scheduleByKey.get(normalizeRaceIdForComparison(doc.id));
    if (!sched) return; // result doc for a race not in the schedule — skip, never throw
    if (best && sched.runMillis <= best.runMillis) return;
    const data = doc.data();
    const top6 = [data.driver1, data.driver2, data.driver3, data.driver4, data.driver5, data.driver6]
      .map((id: string) => F1Drivers.find((d) => d.id === id)?.name || id)
      .filter(Boolean);
    best = { label: sched.label, runMillis: sched.runMillis, top6 };
  });

  if (!best) return '';
  const { label, top6 } = best as { label: string; runMillis: number; top6: string[] };
  const order = top6.map((name, i) => `P${i + 1} ${name}`).join(', ');
  return `Last completed race: ${label}. Official top 6: ${order}. Any driver NOT listed there failed to finish in the top 6 of that race.`;
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-004-v01
// [Intent] Compare the just-submitted six against the team's most recent submission for a
//          DIFFERENT race and emit a deterministic comparison fact (identical / same six with
//          N shuffled / N new faces). Comparison is computed in TypeScript — the LLM is never
//          asked to diff lists (it would get it wrong). Cloned docs (isCloned) are skipped:
//          the player didn't submit those. Reads only this user's predictions subcollection
//          (≤ ~50 docs) and filters in memory — no composite index required.
// [Inbound Trigger] Called by buildCheekyBillContext per submission.
// [Downstream Impact] Empty string on first-ever submission or any failure. The prompt uses
//          this for the "minimal effort" / "panic overhaul" class of roast.
async function buildPreviousSubmissionFacts(
  db: AdminFirestore,
  input: CheekyBillContextInput,
): Promise<string> {
  const currentKey = normalizeRaceIdForComparison(input.raceId);
  const snap = await db.collection('users').doc(input.userId).collection('predictions').get();

  let prev: { predictions: string[]; raceName: string; ts: number } | null = null;
  snap.forEach((doc) => {
    const d: any = doc.data();
    if (d.teamId !== input.teamId) return;
    if (d.isCloned) return;
    if (!Array.isArray(d.predictions) || d.predictions.length !== 6) return;
    if (!d.raceId || normalizeRaceIdForComparison(d.raceId) === currentKey) return;
    const ts = d.submittedAt && typeof d.submittedAt.toMillis === 'function' ? d.submittedAt.toMillis() : 0;
    if (!prev || ts > prev.ts) {
      prev = { predictions: d.predictions, raceName: d.raceName || 'their previous race', ts };
    }
  });

  if (!prev) return '';
  const { predictions: prevPicks, raceName: prevRace } = prev as { predictions: string[]; raceName: string; ts: number };

  const identical = prevPicks.every((id, i) => id === input.predictions[i]);
  if (identical) {
    return `SUBMISSION HISTORY: this is IDENTICAL, driver-for-driver in the same order, to their previous submission (${prevRace}). Copy, paste, submit.`;
  }

  const prevSet = new Set(prevPicks);
  const sameSet = input.predictions.every((id) => prevSet.has(id));
  if (sameSet) {
    const moved = input.predictions.filter((id, i) => id !== prevPicks[i]).length;
    return `SUBMISSION HISTORY: exactly the same six drivers as their previous submission (${prevRace}), just ${moved} of them shuffled around. Minimal effort.`;
  }

  const newFaces = input.predictions.filter((id) => !prevSet.has(id)).length;
  if (newFaces >= 4) {
    return `SUBMISSION HISTORY: wholesale panic — ${newFaces} of the six are new compared to their previous submission (${prevRace}).`;
  }
  return `SUBMISSION HISTORY: ${newFaces} change${newFaces === 1 ? '' : 's'} from their previous submission (${prevRace}).`;
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-005-v01
// [Intent] Fetch the REAL full F1 drivers' championship from Jolpica (api.jolpi.ca — the same
//          free, keyless Ergast successor the hot-news bulletin uses, GR#3) and cache it for
//          6 hours module-level. Maps Jolpica familyName → Prix Six driver id by
//          diacritic-stripped lowercase surname (Hülkenberg→hulkenberg, Pérez→perez); all 22
//          grid surnames are unique so surname matching is unambiguous.
// [Inbound Trigger] buildFormFacts on cache miss.
// [Downstream Impact] Returns null on any failure → form facts are omitted from the roast.
const FORM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let formCache: { at: number; byId: Map<string, { rank: number; points: number }> } | null = null;

async function fetchRealWdcByDriverId(): Promise<Map<string, { rank: number; points: number }> | null> {
  try {
    if (formCache && Date.now() - formCache.at < FORM_CACHE_TTL_MS) return formCache.byId;
    const resp = await fetch('https://api.jolpi.ca/ergast/f1/current/driverstandings/?limit=30', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const rows = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const byId = new Map<string, { rank: number; points: number }>();
    for (const row of rows) {
      const surname = stripDiacritics(row?.Driver?.familyName || '');
      const rank = parseInt(row.position, 10);
      // Skip malformed rows — a NaN rank would render as "PNaN" in the prompt fact line.
      if (!surname || !Number.isFinite(rank)) continue;
      byId.set(surname, { rank, points: parseFloat(row.points) });
    }
    formCache = { at: Date.now(), byId };
    return byId;
  } catch {
    return null;
  }
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-006-v01
// [Intent] Turn the real WDC standings into roast ammunition for THIS submission: every pick's
//          actual championship position, an OUTSIDER flag for any podium pick (P1–P3) whose real
//          WDC rank is 10+, and a ZERO-IMAGINATION flag when the six exactly copy the real WDC
//          top six in order. All flags are computed here — the LLM only quotes them.
// [Inbound Trigger] Called by buildCheekyBillContext per submission.
// [Downstream Impact] Empty string when the Jolpica feed is down. The prompt uses this for the
//          "brave outside chance" / "copy of the form book" class of roast.
async function buildFormFacts(predictions: string[]): Promise<string> {
  const wdc = await fetchRealWdcByDriverId();
  if (!wdc) return '';

  const nameOf = (id: string) => F1Drivers.find((d) => d.id === id)?.name || id;
  const lines: string[] = [];

  const perPick = predictions
    .map((id, i) => {
      const real = wdc.get(id);
      return real ? `their P${i + 1} pick ${nameOf(id)} is P${real.rank} in the real championship` : null;
    })
    .filter(Boolean) as string[];
  if (perPick.length) {
    lines.push(`REAL-WORLD FORM (actual F1 drivers' championship): ${perPick.join('; ')}.`);
  }

  predictions.slice(0, 3).forEach((id, i) => {
    const real = wdc.get(id);
    if (real && real.rank >= 10) {
      lines.push(`OUTSIDER ALERT: ${nameOf(id)} predicted P${i + 1} but is P${real.rank} in the real championship — a proper long shot / pundits' outside chance.`);
    }
  });

  const realTop6 = Array.from(wdc.entries())
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, 6)
    .map(([id]) => id);
  if (realTop6.length === 6 && predictions.every((id, i) => id === realTop6[i])) {
    lines.push('ZERO IMAGINATION: their six is a straight copy of the real championship top six, in exact order.');
  }

  return lines.join('\n');
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-008-v01
// [Intent] Minimal authenticated OpenF1 GET for the news roast mode. Reuses the SHARED token
//          cache in pit-wall-cache (getCachedToken/setCachedToken) and the same
//          openf1-username/openf1-password secrets as the Pit Wall, so no duplicate token
//          round-trips — but keeps its own small fetch (5s timeout) rather than refactoring
//          the latency-critical pit-wall route (known duplication, BOW: openf1-client consolidation).
// [Inbound Trigger] buildTracksideNewsFacts, only when a submission rolls news mode.
// [Downstream Impact] Returns null on ANY failure (missing secrets, timeout, non-2xx, bad JSON)
//                     — news facts degrade to '', never blocking the roast.
const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

async function openF1Get<T>(path: string): Promise<T | null> {
  try {
    const cached = getCachedToken();
    let token = cached && cached.expiresAt > Date.now() ? cached.token : null;
    if (!token) {
      const username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
      const password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
      const res = await fetch(OPENF1_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password, grant_type: 'password' }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.access_token) return null;
      const freshToken = data.access_token as string;
      setCachedToken({ token: freshToken, expiresAt: Date.now() + ((data.expires_in ?? 300) - 60) * 1000 });
      token = freshToken;
    }
    const res = await fetch(`${OPENF1_BASE}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-007-v01
// [Intent] "Trackside news" ammunition for the news-correlated roast mode: OpenF1 race_control
//          messages from a LIVE or just-ended session (the lowest-latency incident source —
//          crashes, offs, flags, within minutes) plus Autosport RSS headlines as background.
//          Deterministic eligibility gate: returns non-empty ONLY when there are fresh
//          race_control messages OR a headline names one of the six picked drivers — otherwise
//          '' and the caller degrades the roast to standard mode. All external text passes
//          through sanitizeForPrompt; timestamp/venue framing is built OUTSIDE the sanitised
//          payload (the sanitiser's allowlist strips ':' and '[]').
// [Inbound Trigger] buildCheekyBillContext when includeTracksideNews is set (~1/3 of submissions).
// [Downstream Impact] Interpolated into the news-mode prompt block in ai/flows/cheeky-bill.ts.
//                     Stale-session gotcha: /sessions?session_key=latest returns the LAST session
//                     even days later — the date_end + 2h gate below is mandatory or Bill would
//                     "correlate" a submission with week-old FP1 messages.
const SESSION_CACHE_TTL_MS = 90 * 1000;
const RACE_CONTROL_CACHE_TTL_MS = 60 * 1000;
const HEADLINES_CACHE_TTL_MS = 10 * 60 * 1000;
const RACE_CONTROL_FRESH_WINDOW_MS = 45 * 60 * 1000;
let sessionCache: { at: number; session: { session_name?: string; location?: string; date_start?: string; date_end?: string } | null } | null = null;
let raceControlCache: { at: number; messages: { date?: string; message?: string }[] } | null = null;
let headlinesCache: { at: number; headlines: string[] } | null = null;

async function buildTracksideNewsFacts(predictions: string[]): Promise<string> {
  try {
    const now = Date.now();

    // 1. Session gate — is a session live or ended < 2h ago?
    if (!sessionCache || now - sessionCache.at > SESSION_CACHE_TTL_MS) {
      const sessions = await openF1Get<any[]>('/sessions?session_key=latest');
      sessionCache = { at: now, session: Array.isArray(sessions) && sessions.length ? sessions[0] : null };
    }
    const session = sessionCache.session;
    const start = session?.date_start ? new Date(session.date_start).getTime() : NaN;
    const end = session?.date_end ? new Date(session.date_end).getTime() : NaN;
    const sessionRelevant = Number.isFinite(start) && Number.isFinite(end)
      && now >= start && now <= end + 2 * 60 * 60 * 1000;

    // 2. Race control messages (only worth fetching when the session gate passes).
    const tracksideLines: string[] = [];
    if (sessionRelevant) {
      if (!raceControlCache || now - raceControlCache.at > RACE_CONTROL_CACHE_TTL_MS) {
        const msgs = await openF1Get<any[]>('/race_control?session_key=latest');
        raceControlCache = { at: now, messages: Array.isArray(msgs) ? msgs : [] };
      }
      const fresh = raceControlCache.messages
        .filter((m) => {
          const t = m.date ? new Date(m.date).getTime() : NaN;
          return Number.isFinite(t) && now - t <= RACE_CONTROL_FRESH_WINDOW_MS;
        })
        .slice(-8);
      const sessionLabel = `${sanitizeForPrompt(session?.session_name || 'Session', 40)} at ${sanitizeForPrompt(session?.location || 'the circuit', 40)}`;
      const liveness = now <= end ? 'LIVE NOW' : 'just finished';
      for (const m of fresh) {
        const ageMin = Math.max(0, Math.round((now - new Date(m.date!).getTime()) / 60000));
        const text = sanitizeForPrompt(m.message || '', 160);
        if (text) tracksideLines.push(`[${ageMin} min ago] ${text}`);
      }
      if (tracksideLines.length) {
        tracksideLines.unshift(`TRACKSIDE (${sessionLabel}, ${liveness}):`);
      }
    }

    // 3. Background headlines (already sanitised inside fetchF1Headlines — GR#3, one parser).
    if (!headlinesCache || now - headlinesCache.at > HEADLINES_CACHE_TTL_MS) {
      headlinesCache = { at: now, headlines: await fetchF1Headlines() };
    }
    const headlines = headlinesCache.headlines;

    // 4. Deterministic eligibility gate (GR#15 — surnames derive from F1Drivers, not a list here).
    const pickedSurnames = predictions
      .map((id) => F1Drivers.find((d) => d.id === id)?.name.toLowerCase())
      .filter(Boolean) as string[];
    const headlineMentionsPick = headlines.some((h) => {
      const lower = h.toLowerCase();
      return pickedSurnames.some((s) => lower.includes(s));
    });
    const hasTrackside = tracksideLines.length > 0;
    if (!hasTrackside && !headlineMentionsPick) return '';

    const parts: string[] = [];
    if (hasTrackside) parts.push(tracksideLines.join('\n'));
    if (headlines.length) parts.push(`NEWS HEADLINES:\n${headlines.map((h) => `- ${h}`).join('\n')}`);
    return parts.join('\n');
  } catch (err: any) {
    console.error('[cheeky-bill-context] trackside news facts failed (non-fatal):', err?.message || err);
    return '';
  }
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-003-v03
// @CHANGE (v3.6.0): optional includeTracksideNews on the input — when set, also builds newsFacts
//   (OpenF1 race_control + RSS headlines via GUID-007) in the same concurrent batch. Output
//   always carries newsFacts ('' unless requested and relevant).
// @CHANGE (v3.4.14): input widened to { userId, teamId, raceId, predictions }; now also builds
//   previous-submission comparison facts and real-WDC form facts (both best-effort, in parallel
//   with the cached aggregate).
// [Intent] Build the full banter context for one submitting team: last-race facts (cached),
//          that team's championship rank/points line, submission-history comparison, and
//          real-world form flags. Never throws — this feeds a decorative WhatsApp one-liner
//          and must not disturb the submission path (matches the established non-fatal
//          console.error convention of API_SUBMIT_PREDICTION-009).
// [Inbound Trigger] submit-prediction/route.ts fire-and-forget WhatsApp block, per submission.
// [Downstream Impact] Any field may be '' — generateCheekyComment handles missing facts by
//          roasting with whatever remains.
export async function buildCheekyBillContext(db: AdminFirestore, input: CheekyBillContextInput): Promise<CheekyBillContext> {
  const empty: CheekyBillContext = { lastRaceFacts: '', standingsFacts: '', previousSubmissionFacts: '', formFacts: '', newsFacts: '' };
  try {
    // The per-submission builders are independent of the cached aggregate — run everything
    // concurrently. Each sub-builder degrades to '' on its own failure.
    const [previousSubmissionFacts, formFacts, newsFacts] = await Promise.all([
      buildPreviousSubmissionFacts(db, input).catch((err: any) => {
        console.error('[cheeky-bill-context] previous-submission facts failed (non-fatal):', err?.message || err);
        return '';
      }),
      buildFormFacts(input.predictions).catch((err: any) => {
        console.error('[cheeky-bill-context] form facts failed (non-fatal):', err?.message || err);
        return '';
      }),
      (input.includeTracksideNews ? buildTracksideNewsFacts(input.predictions) : Promise.resolve('')).catch((err: any) => {
        console.error('[cheeky-bill-context] trackside news facts failed (non-fatal):', err?.message || err);
        return '';
      }),
      (async () => {
        if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
          const [lastRaceFacts, { scores }, adjustments, names] = await Promise.all([
            buildLastRaceFacts(db),
            computeRaceScores(db),
            readStandingsAdjustments(db),
            buildTeamNamesMap(db),
          ]);
          const standings = aggregateStandings([...scores, ...adjustments], names);
          cache = { at: Date.now(), lastRaceFacts, standings };
        }
      })(),
    ]);

    let standingsFacts = '';
    const mine = cache!.standings.find((s) => s.userId === input.teamId);
    if (mine) {
      const leader = cache!.standings[0];
      const leaderNote = leader && leader.userId !== input.teamId ? ` (leader: ${leader.teamName} on ${leader.totalPoints})` : ' — they are leading the championship';
      standingsFacts = `This team is currently P${mine.rank} of ${cache!.standings.length} in the fantasy championship with ${mine.totalPoints} points${leaderNote}.`;
    }

    return { lastRaceFacts: cache!.lastRaceFacts, standingsFacts, previousSubmissionFacts, formFacts, newsFacts };
  } catch (err: any) {
    // Decorative path — degrade to statless roast, never block or bubble up.
    console.error('[cheeky-bill-context] Failed to build banter context (non-fatal):', err?.message || err);
    return empty;
  }
}

// GUID: LIB_CHEEKY_BILL_CONTEXT-010-v01
// [Intent] Deterministic, VERIFIED fact lines for the weekly-standings "Bill's take" snark
//          (v3.5.2): last completed round + its round winner, leader gap, point ties inside the
//          top 10, biggest riser/faller vs the standings BEFORE the latest round (computed by
//          re-aggregating with that round's scores excluded — same SSOT, no stored history),
//          and who is propping up the table. Same contract as the submission roast: the LLM may
//          only quote these lines, never invent stats.
// [Inbound Trigger] Called by the weekly block in /api/cron/whatsapp-scheduled before
//                   generateWeeklyStandingsSnark.
// [Downstream Impact] Returns null when there is nothing worth saying (no completed rounds /
//                     fewer than 2 teams) — caller then posts the plain standings unchanged.
export async function buildWeeklyStandingsFacts(db: AdminFirestore): Promise<{ factLines: string } | null> {
  try {
    const [{ scores }, adjustments, names] = await Promise.all([
      computeRaceScores(db),
      readStandingsAdjustments(db),
      buildTeamNamesMap(db),
    ]);
    const allRows = [...scores, ...adjustments];
    const current = aggregateStandings(allRows, names);
    if (!current || current.length < 2) return null;

    // Identify the most recent completed round among raceIds that actually have scores.
    const runMillis = buildRaceRunMillisMap();
    let latestKey: string | null = null;
    let latestMillis = -1;
    for (const row of scores) {
      const t = runMillis.get(row.raceId);
      if (t !== undefined && t > latestMillis) { latestMillis = t; latestKey = row.raceId; }
    }

    const lines: string[] = [];
    // Team names are player-controlled text headed into an LLM prompt — sanitise (GR#11).
    const safe = (n: string | undefined) => sanitizeForPrompt(n || '', 60) || 'unnamed team';

    if (latestKey) {
      // Human label for the round (mirror buildLastRaceFacts' schedule matching).
      let label = latestKey;
      for (const race of RaceSchedule) {
        if (normalizeRaceIdForComparison(generateRaceId(race.name, 'gp')) === latestKey) { label = race.name; break; }
        if (race.hasSprint && normalizeRaceIdForComparison(generateRaceId(race.name, 'sprint')) === latestKey) { label = `${race.name} Sprint`; break; }
      }

      // Round winner: best single-round score in the latest round.
      let best: { userId: string; totalPoints: number } | null = null;
      for (const row of scores) {
        if (row.raceId === latestKey && (!best || row.totalPoints > best.totalPoints)) best = row;
      }
      if (best) {
        lines.push(`Last completed round: ${label}. Round winner: "${safe(names.get(best.userId))}" with ${best.totalPoints} points.`);
      }

      // Movement vs the table BEFORE the latest round (same aggregation, that round excluded).
      const prev = aggregateStandings(allRows.filter((r) => r.raceId !== latestKey), names);
      const prevRank = new Map(prev.map((s) => [s.userId, s.rank]));
      let riser: { teamName: string; delta: number; rank: number } | null = null;
      let faller: { teamName: string; delta: number; rank: number } | null = null;
      for (const s of current) {
        const was = prevRank.get(s.userId);
        if (was === undefined) continue;
        const delta = was - s.rank; // positive = climbed
        if (delta > 0 && (!riser || delta > riser.delta)) riser = { teamName: s.teamName, delta, rank: s.rank };
        if (delta < 0 && (!faller || delta < faller.delta)) faller = { teamName: s.teamName, delta, rank: s.rank };
      }
      if (riser && riser.delta >= 2) lines.push(`Biggest riser this round: "${safe(riser.teamName)}" climbed ${riser.delta} places to P${riser.rank}.`);
      if (faller && faller.delta <= -2) lines.push(`Biggest faller this round: "${safe(faller.teamName)}" dropped ${Math.abs(faller.delta)} places to P${faller.rank}.`);
    }

    // Leader gap.
    const [p1, p2] = current;
    lines.push(p1.totalPoints === p2.totalPoints
      ? `Top of the table: "${safe(p1.teamName)}" and "${safe(p2.teamName)}" are DEAD LEVEL on ${p1.totalPoints} points.`
      : `Leader: "${safe(p1.teamName)}" on ${p1.totalPoints}, ${p1.totalPoints - p2.totalPoints} points clear of "${safe(p2.teamName)}".`);

    // Point ties inside the top 10 (most interesting cluster first).
    const topTen = current.slice(0, 10);
    const byPoints = new Map<number, typeof topTen>();
    topTen.forEach((s) => { const g = byPoints.get(s.totalPoints) || []; g.push(s); byPoints.set(s.totalPoints, g); });
    const ties = [...byPoints.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
    if (ties.length > 0) {
      const g = ties[0];
      // Tied teams share a rank value — describe them by their listed table positions instead.
      const first = topTen.indexOf(g[0]) + 1;
      const last = topTen.indexOf(g[g.length - 1]) + 1;
      lines.push(`TIE ALERT: ${g.map((s) => `"${safe(s.teamName)}"`).join(', ')} are all level on ${g[0].totalPoints} points (positions ${first}–${last} in the table).`);
    }

    // Backmarker.
    const last = current[current.length - 1];
    lines.push(`Propping up the table: "${safe(last.teamName)}" in P${last.rank} with ${last.totalPoints} points.`);

    return { factLines: lines.join('\n') };
  } catch (err: any) {
    console.error('[cheeky-bill-context] Failed to build weekly standings facts (non-fatal):', err?.message || err);
    return null;
  }
}
