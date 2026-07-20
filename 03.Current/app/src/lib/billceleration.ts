// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       admin_configuration/billceleration (bot config SSOT, cached 10 min),
//              collectionGroup(predictions) filtered by raceId (index exists),
//              users (team names via buildTeamNamesMap)
// Writes:      none directly — submitAsBot POSTs the real /api/submit-prediction route,
//              which owns the prediction write, audit log, and WhatsApp roast pipeline
// Errors:      getBotConfig/buildPackSummary degrade (null/''); mintBotIdToken and
//              submitAsBot THROW on failure — callers own the retry/skip decision
// Idempotent:  yes (submitAsBot re-submission merges onto the same deterministic doc ID)
// Side-effects: token mint (Identity Toolkit), HTTPS POST to the app's own submit route
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_BILLCELERATION-000-v01
// [Intent] Shared library for the Billceleration autonomous AI team (v3.7.0): runtime config,
//          bot identity-token minting, rival-pack summarisation for the picker prompt, and
//          submission via the REAL authenticated submit-prediction route so every deadline
//          gate and the roast/WhatsApp pipeline are reused with zero duplication.
// [Inbound Trigger] /api/cron/billceleration (scheduled picks) and the submit-prediction
//          fire-and-forget block (getBotConfig, to detect the bot's own submissions).
// [Downstream Impact] Predictions land exactly like a human's; standings, scoring, cloning
//          and WhatsApp all see a normal submission from team "Billceleration".

import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { F1Drivers } from '@/lib/data';
import { generateRaceId } from '@/lib/normalize-race-id';
import type { RaceScheduleDoc } from '@/lib/race-schedule-server';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

export interface BotConfig {
  uid: string;
  enabled: boolean;
}

// GUID: LIB_BILLCELERATION-001-v01
// [Intent] Runtime SSOT for the bot's identity and kill-switch: admin_configuration/billceleration
//          { uid, enabled }. 10-minute module cache so the submit-prediction fire-and-forget can
//          call this on EVERY submission at ~zero cost (same cache precedent as cheeky-bill-context).
// [Inbound Trigger] Cron route (every tick) and submit-prediction fire-and-forget (every submission).
// [Downstream Impact] null => bot not provisioned / config unreadable; callers treat as disabled.
//          Flipping `enabled` in Firestore takes effect within 10 minutes with no deploy.
const CONFIG_CACHE_TTL_MS = 10 * 60 * 1000;
let configCache: { at: number; cfg: BotConfig | null } | null = null;

export async function getBotConfig(db: AdminFirestore): Promise<BotConfig | null> {
  try {
    if (configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) return configCache.cfg;
    const snap = await db.collection('admin_configuration').doc('billceleration').get();
    const data = snap.exists ? snap.data() : null;
    const cfg = data?.uid ? { uid: String(data.uid), enabled: data.enabled === true } : null;
    configCache = { at: Date.now(), cfg };
    return cfg;
  } catch (err: any) {
    console.error('[billceleration] getBotConfig failed (non-fatal):', err?.message || err);
    return null;
  }
}

// GUID: LIB_BILLCELERATION-002-v01
// [Intent] Mint a Firebase ID token for the bot uid: Admin SDK createCustomToken (the App
//          Hosting SA already holds Service Account Token Creator — same as the login flow),
//          then exchange via the Identity Toolkit signInWithCustomToken REST endpoint using
//          the public web API key. The resulting ID token passes verifyAuthToken in
//          /api/submit-prediction exactly like a browser session's.
// [Inbound Trigger] submitAsBot, once per cron slot.
// [Downstream Impact] THROWS on any failure — the cron route treats that as a hard slot
//          failure (status 'error', flag released for retry). Never logs the token.
export async function mintBotIdToken(uid: string): Promise<string> {
  await getFirebaseAdmin(); // ensure the admin app is initialised before getAuth()
  const { getAuth } = await import('firebase-admin/auth');
  const customToken = await getAuth().createCustomToken(uid);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY not available in runtime');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!resp.ok) throw new Error(`Identity Toolkit token exchange failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data?.idToken) throw new Error('Identity Toolkit response missing idToken');
  return data.idToken as string;
}

// GUID: LIB_BILLCELERATION-003-v01
// [Intent] Summarise the rival pack's CURRENT submissions for one race as picker-prompt
//          ammunition: per-driver pick counts by predicted position band, plus notable
//          deviations. Excludes cloned docs and the bot's own submission; keeps only the
//          latest doc per teamId (same reader rules as computeRaceScores). Every team name
//          passes through sanitizeForPrompt (GR#11 — player-controlled text into an LLM).
// [Inbound Trigger] Cron route input gathering, once per slot.
// [Downstream Impact] '' when nobody has submitted yet — the picker roams on form alone.
//          Uses the existing predictions collectionGroup raceId index (no new index).
export async function buildPackSummary(db: AdminFirestore, titleCaseRaceId: string, botUid: string): Promise<string> {
  try {
    const snap = await db.collectionGroup('predictions').where('raceId', '==', titleCaseRaceId).get();
    if (snap.empty) return '';

    // Latest non-cloned doc per teamId, excluding the bot's own teams.
    const latest = new Map<string, { teamName: string; predictions: string[]; ts: number }>();
    snap.forEach((doc) => {
      const d: any = doc.data();
      if (d.isCloned) return;
      if (!Array.isArray(d.predictions) || d.predictions.length !== 6) return;
      const teamId = d.teamId || doc.ref.path.split('/')[1];
      if (!teamId || teamId === botUid || teamId === `${botUid}-secondary`) return;
      const ts = d.submittedAt && typeof d.submittedAt.toMillis === 'function' ? d.submittedAt.toMillis() : 0;
      const prev = latest.get(teamId);
      if (!prev || ts > prev.ts) {
        latest.set(teamId, { teamName: d.teamName || 'unnamed team', predictions: d.predictions, ts });
      }
    });
    if (latest.size === 0) return '';

    const nameOf = (id: string) => F1Drivers.find((d) => d.id === id)?.name || id;
    // Per-driver aggregate: how many rivals picked them, and where.
    const agg = new Map<string, { count: number; positions: number[] }>();
    for (const { predictions } of latest.values()) {
      predictions.forEach((id, i) => {
        const a = agg.get(id) || { count: 0, positions: [] };
        a.count++;
        a.positions.push(i + 1);
        agg.set(id, a);
      });
    }
    const total = latest.size;
    const popular = [...agg.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, a]) => {
        const avgPos = (a.positions.reduce((s, p) => s + p, 0) / a.positions.length).toFixed(1);
        return `${nameOf(id)} picked by ${a.count}/${total} (avg predicted P${avgPos})`;
      });

    // Notable deviations: drivers picked by exactly one team (the differentials).
    const differentials: string[] = [];
    for (const [id, a] of agg.entries()) {
      if (a.count === 1) {
        for (const { teamName, predictions } of latest.values()) {
          const pos = predictions.indexOf(id);
          if (pos >= 0) {
            differentials.push(`only "${sanitizeForPrompt(teamName, 60) || 'unnamed team'}" has ${nameOf(id)} (their P${pos + 1})`);
            break;
          }
        }
      }
    }

    const lines = [
      `RIVAL PACK (${total} team${total === 1 ? '' : 's'} submitted so far for this race):`,
      ...popular,
    ];
    if (differentials.length) lines.push(`Differentials: ${differentials.join('; ')}.`);
    return lines.join('\n');
  } catch (err: any) {
    console.error('[billceleration] buildPackSummary failed (non-fatal):', err?.message || err);
    return '';
  }
}

// GUID: LIB_BILLCELERATION-004-v01
// [Intent] Submit the bot's six through the REAL /api/submit-prediction route with a freshly
//          minted ID token. Reuses every server gate (pit-lane override, results-exist,
//          qualifyingTime clock) and the full roast/WhatsApp fire-and-forget pipeline.
//          session 'gp' | 'sprint' selects the raceId suffix; deadline is shared per weekend.
// [Inbound Trigger] Cron route, once per session per slot.
// [Downstream Impact] THROWS on non-2xx (e.g. 403 after deadline) — the caller decides
//          whether that is expected (deadline race) or a hard failure. A 2xx means the
//          prediction doc exists and the WhatsApp splitbrain roast is already in flight.
export async function submitAsBot(
  idToken: string,
  uid: string,
  teamName: string,
  race: RaceScheduleDoc,
  session: 'gp' | 'sprint',
  picks: string[],
): Promise<void> {
  const appUrl = process.env.APP_URL || 'https://prix6.win';
  const body = {
    userId: uid,
    teamId: uid,
    teamName,
    raceId: generateRaceId(race.name, session),
    raceName: race.name,
    predictions: picks,
  };
  const resp = await fetch(`${appUrl}/api/submit-prediction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`submit-prediction ${session} returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
}
