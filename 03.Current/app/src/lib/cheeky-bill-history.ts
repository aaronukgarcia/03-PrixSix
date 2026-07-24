// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       admin_configuration/cheekyBillHistory (single doc, rolling window)
// Writes:      admin_configuration/cheekyBillHistory (transactional rolling append)
// Errors:      none surfaced — decorative feature, every failure degrades to empty history
// Idempotent:  read yes; append no (each call prepends one line, window capped at 20)
// Side-effects: none beyond the history doc
// Key gotcha:  the roast line ALSO lives inside the whatsapp_queue message text, but queue
//              docs are deleted/purged from the admin panel, so the queue is NOT a reliable
//              history source (GR#3: this doc is the durable record of "what Bill said
//              lately", not a duplicate — the queue is transport, this is memory).
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_CHEEKY_BILL_HISTORY-000-v02
// @CHANGE (v3.8.1): device tracking — each stored line now records which comedy device the
//   roulette assigned (or null for free choice); getRecentRoastHistory returns the last few
//   devices so the flow can exclude recently used structures from the roulette. Sandbox
//   testing showed the same device (picks-voice) landing twice in four roasts.
// [Intent] Anti-repetition memory for Cheeky Bill (v3.8.0): a rolling window of the last 20
//          roast lines Bill posted to the WhatsApp group. The most recent 10 are injected
//          into the roast prompt as "do NOT reuse these openings/images/punchlines" so
//          consecutive roasts stop converging on the same gags (dartboard, Mystic Meg…).
// [Inbound Trigger] getRecentRoastHistory / recordRoastLine called by
//          api/internal/roast-submission/route.ts around generateCheekyComment.
// [Downstream Impact] Lines feed the recentRoasts input and devices the recentDevices input
//          of AI_CHEEKY_BILL-000. Empty history = Bill roasts without the anti-repetition
//          block (graceful degrade).

import type { getFirebaseAdmin } from '@/lib/firebase-admin';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

const HISTORY_DOC_PATH = { collection: 'admin_configuration', doc: 'cheekyBillHistory' } as const;
/** Rolling window kept in the doc — larger than the prompt window so we can tune later. */
const MAX_STORED_LINES = 20;
/** How many recent lines the prompt actually sees. */
const PROMPT_WINDOW = 10;

/** How many recently used comedy devices the roulette should avoid. */
const DEVICE_WINDOW = 3;

interface StoredRoastLine {
  text: string;
  team: string;
  /** ISO timestamp — written client-side (server time not needed; ordering is array order). */
  at: string;
  /** Comedy-device key the roulette assigned for this roast, or null for free choice. */
  device?: string | null;
}

export interface RecentRoastHistory {
  /** Most recent roast lines, newest first (max PROMPT_WINDOW). */
  lines: string[];
  /** Device keys of the most recent device-assigned roasts, newest first (max DEVICE_WINDOW). */
  devices: string[];
}

// GUID: LIB_CHEEKY_BILL_HISTORY-001-v02
// @CHANGE (v3.8.1): renamed getRecentRoastLines → getRecentRoastHistory; now also returns the
//   last DEVICE_WINDOW device keys so the roulette can avoid recently used structures.
// [Intent] Return the most recent roast lines + device keys (newest first) for prompt
//          injection and roulette exclusion. GR#16: never trust the stored shape — filter to
//          non-empty strings before returning.
// [Inbound Trigger] roast-submission route, before generateCheekyComment.
// [Downstream Impact] lines join into the recentRoasts prompt block; devices feed the
//          recentDevices roulette exclusion. Any failure returns empty history.
export async function getRecentRoastHistory(db: AdminFirestore): Promise<RecentRoastHistory> {
  try {
    const snap = await db.collection(HISTORY_DOC_PATH.collection).doc(HISTORY_DOC_PATH.doc).get();
    const raw = snap.data()?.lines;
    if (!Array.isArray(raw)) return { lines: [], devices: [] };
    const entries = raw.filter((l: unknown): l is StoredRoastLine =>
      !!l && typeof (l as StoredRoastLine).text === 'string' && (l as StoredRoastLine).text.trim().length > 0);
    return {
      lines: entries.map((l) => l.text.trim()).slice(0, PROMPT_WINDOW),
      devices: entries
        .map((l) => (typeof l.device === 'string' ? l.device : ''))
        .filter((d) => d.length > 0)
        .slice(0, DEVICE_WINDOW),
    };
  } catch {
    return { lines: [], devices: [] }; // decorative — a history-less roast still goes out
  }
}

// GUID: LIB_CHEEKY_BILL_HISTORY-002-v02
// @CHANGE (v3.8.1): records the comedy-device key alongside the line (null = free choice).
// [Intent] Prepend a freshly generated roast line to the rolling window (transactional so
//          two near-simultaneous submissions can't clobber each other's append), capped at
//          MAX_STORED_LINES. Best-effort: a failed write never blocks the WhatsApp message.
// [Inbound Trigger] roast-submission route, after a non-empty cheekyLine is generated —
//          awaited BEFORE the response returns (Cloud Run CPU-throttle rule, BUG-ROAST-001).
// [Downstream Impact] Grows the history read by GUID-001 on subsequent roasts.
export async function recordRoastLine(db: AdminFirestore, text: string, team: string, device: string | null = null): Promise<void> {
  const line = (text || '').trim();
  if (!line) return;
  try {
    const ref = db.collection(HISTORY_DOC_PATH.collection).doc(HISTORY_DOC_PATH.doc);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = Array.isArray(snap.data()?.lines) ? snap.data()!.lines : [];
      const entry: StoredRoastLine = {
        text: line.slice(0, 500),
        team: (team || '').slice(0, 60),
        at: new Date().toISOString(),
        device: device ? device.slice(0, 40) : null,
      };
      tx.set(ref, { lines: [entry, ...existing].slice(0, MAX_STORED_LINES) }, { merge: true });
    });
  } catch (err: any) {
    // Decorative memory — log for visibility, never throw into the roast pipeline.
    console.error('[cheeky-bill-history] failed to record roast line (non-fatal):', err?.message);
  }
}
