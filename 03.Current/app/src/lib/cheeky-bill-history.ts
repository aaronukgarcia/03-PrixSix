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
// GUID: LIB_CHEEKY_BILL_HISTORY-000-v01
// [Intent] Anti-repetition memory for Cheeky Bill (v3.8.0): a rolling window of the last 20
//          roast lines Bill posted to the WhatsApp group. The most recent 10 are injected
//          into the roast prompt as "do NOT reuse these openings/images/punchlines" so
//          consecutive roasts stop converging on the same gags (dartboard, Mystic Meg…).
// [Inbound Trigger] getRecentRoastLines / recordRoastLine called by
//          api/internal/roast-submission/route.ts around generateCheekyComment.
// [Downstream Impact] Lines feed the recentRoasts input of AI_CHEEKY_BILL-000. Empty
//          history = Bill roasts without the anti-repetition block (graceful degrade).

import type { getFirebaseAdmin } from '@/lib/firebase-admin';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

const HISTORY_DOC_PATH = { collection: 'admin_configuration', doc: 'cheekyBillHistory' } as const;
/** Rolling window kept in the doc — larger than the prompt window so we can tune later. */
const MAX_STORED_LINES = 20;
/** How many recent lines the prompt actually sees. */
const PROMPT_WINDOW = 10;

interface StoredRoastLine {
  text: string;
  team: string;
  /** ISO timestamp — written client-side (server time not needed; ordering is array order). */
  at: string;
}

// GUID: LIB_CHEEKY_BILL_HISTORY-001-v01
// [Intent] Return the most recent roast lines (newest first) for prompt injection. GR#16:
//          never trust the stored shape — filter to non-empty strings before returning.
// [Inbound Trigger] roast-submission route, before generateCheekyComment.
// [Downstream Impact] Joined into the recentRoasts prompt block. Any failure returns [].
export async function getRecentRoastLines(db: AdminFirestore): Promise<string[]> {
  try {
    const snap = await db.collection(HISTORY_DOC_PATH.collection).doc(HISTORY_DOC_PATH.doc).get();
    const lines = snap.data()?.lines;
    if (!Array.isArray(lines)) return [];
    return lines
      .map((l: unknown) => (l && typeof (l as StoredRoastLine).text === 'string' ? (l as StoredRoastLine).text.trim() : ''))
      .filter((t: string) => t.length > 0)
      .slice(0, PROMPT_WINDOW);
  } catch {
    return []; // decorative — a history-less roast still goes out
  }
}

// GUID: LIB_CHEEKY_BILL_HISTORY-002-v01
// [Intent] Prepend a freshly generated roast line to the rolling window (transactional so
//          two near-simultaneous submissions can't clobber each other's append), capped at
//          MAX_STORED_LINES. Best-effort: a failed write never blocks the WhatsApp message.
// [Inbound Trigger] roast-submission route, after a non-empty cheekyLine is generated —
//          awaited BEFORE the response returns (Cloud Run CPU-throttle rule, BUG-ROAST-001).
// [Downstream Impact] Grows the history read by GUID-001 on subsequent roasts.
export async function recordRoastLine(db: AdminFirestore, text: string, team: string): Promise<void> {
  const line = (text || '').trim();
  if (!line) return;
  try {
    const ref = db.collection(HISTORY_DOC_PATH.collection).doc(HISTORY_DOC_PATH.doc);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = Array.isArray(snap.data()?.lines) ? snap.data()!.lines : [];
      const entry: StoredRoastLine = { text: line.slice(0, 500), team: (team || '').slice(0, 60), at: new Date().toISOString() };
      tx.set(ref, { lines: [entry, ...existing].slice(0, MAX_STORED_LINES) }, { merge: true });
    });
  } catch (err: any) {
    // Decorative memory — log for visibility, never throw into the roast pipeline.
    console.error('[cheeky-bill-history] failed to record roast line (non-fatal):', err?.message);
  }
}
