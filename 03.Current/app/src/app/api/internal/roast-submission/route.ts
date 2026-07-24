// GUID: API_ROAST_SUBMISSION-000-v03
// @CHANGE (v3.8.1): device tracking — history fetch now also returns the last ~3 comedy-device
//   keys (excluded from the roulette in the flow) and the chosen device is persisted with the
//   roast line, so the same delivery structure can't land on consecutive roasts.
// @CHANGE (v3.8.0): anti-sameness — fetches Bill's last ~10 roast lines
//   (LIB_CHEEKY_BILL_HISTORY) and passes them to generateCheekyComment as anti-repetition
//   context; records each freshly generated line back to the rolling history doc BEFORE
//   responding (Cloud Run post-response CPU throttle, BUG-ROAST-001 rule). Both steps are
//   best-effort — history failure never blocks the WhatsApp message.
// Auth:   CRON_SECRET bearer token (timing-safe) — caller is the roastTaskTrigger Cloud
//         Function, same trust boundary as the cron routes.
// [Intent] BUG-ROAST-001 fix (v3.7.2): the Cheeky Bill roast/WhatsApp pipeline, moved out of
//          submit-prediction's post-response orphan into a REAL request with full CPU. Cloud
//          Run throttles CPU once a response is sent, so the old fire-and-forget could freeze
//          mid-await and silently vanish (LREG's lost notification, 2026-07-20). This route is
//          invoked per roast_tasks doc by the roastTaskTrigger function; the entire pipeline —
//          mode roll, splitbrain bot detection, banter context, Gemini roast, whatsapp_queue
//          write, worker wake — now runs request-scoped and deterministic.
// [Inbound Trigger] POST {taskId} from roastTaskTrigger (functions/index.js) on every
//          roast_tasks document create.
// [Downstream Impact] whatsapp_queue PENDING doc (hardcoded Prix6.Win group — the deliberate
//          gating divergence carried over from API_SUBMIT_PREDICTION-009) + worker wake.
//          Marks the task doc DONE/ERROR so stuck tasks are visible and idempotency holds
//          (a re-trigger on a non-PENDING task is a no-op).

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { generateCheekyComment } from '@/ai/flows/cheeky-bill';
import { buildCheekyBillContext } from '@/lib/cheeky-bill-context';
import { getRecentRoastHistory, recordRoastLine } from '@/lib/cheeky-bill-history';
import { getBotConfig } from '@/lib/billceleration';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';
import { F1Drivers } from '@/lib/data';

export const dynamic = 'force-dynamic';

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

// GUID: API_ROAST_SUBMISSION-001-v01
// [Intent] POST handler: claim the task (PENDING → PROCESSING, transactional so duplicate
//          triggers no-op), run the roast pipeline moved verbatim from
//          API_SUBMIT_PREDICTION-009-v05, mark DONE with the queue doc id. On error the task
//          is marked ERROR (visible for audit/replay) and a 500 returned so the failure shows
//          in the function's log line.
// [Inbound Trigger] roastTaskTrigger per task doc.
// [Downstream Impact] See file header. driverList derives from F1Drivers (SSOT — replaces the
//          old hardcoded name map, GR#3/GR#15).
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { db, FieldValue } = await getFirebaseAdmin();
  let taskId = '';
  try {
    const body = await request.json();
    taskId = String(body?.taskId || '');
    if (!taskId) return NextResponse.json({ success: false, error: 'taskId required' }, { status: 400 });

    const taskRef = db.collection('roast_tasks').doc(taskId);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(taskRef);
      if (!snap.exists || snap.data()!.status !== 'PENDING') return null;
      tx.update(taskRef, { status: 'PROCESSING', processingAt: FieldValue.serverTimestamp() });
      return snap.data();
    });
    if (!claimed) {
      return NextResponse.json({ success: true, state: 'already-handled' });
    }

    const { userId, teamId, teamName, raceId, raceName, predictions } = claimed as any;
    const driverList = (predictions as string[])
      .map((id, i) => `${i + 1}. ${F1Drivers.find((d) => d.id === id)?.name || id}`)
      .join('\n');

    let cheekyLine = '';
    try {
      // Roast mode roll — before the context fetch so news-mode external calls (OpenF1 + RSS)
      // only happen on ~1/3 of submissions.
      const roll = Math.random();
      let roastMode: 'standard' | 'jackdee' | 'news' | 'splitbrain' =
        roll < 1 / 3 ? 'jackdee' : roll < 2 / 3 ? 'news' : 'standard';
      // Billceleration self-submission → forced splitbrain self-roast, quoting the picker's
      // own rationale when the state doc's lastPick matches this race and is fresh (<10 min).
      let rationaleFacts = '';
      const botCfg = await getBotConfig(db);
      if (botCfg?.uid && userId === botCfg.uid) {
        roastMode = 'splitbrain';
        try {
          const lastPick = (await db.collection('admin_configuration').doc('billcelerationState').get()).data()?.lastPick;
          const pickAtMs = lastPick?.at && typeof lastPick.at.toMillis === 'function' ? lastPick.at.toMillis() : 0;
          if (lastPick?.raceId === raceId && Date.now() - pickAtMs < 10 * 60 * 1000) {
            const rationale = sanitizeForPrompt(String(lastPick.rationale || ''), 300);
            const selfDoubt = sanitizeForPrompt(String(lastPick.selfDoubt || ''), 200);
            rationaleFacts = [rationale && `My public reasoning was - ${rationale}`, selfDoubt && `My private worry was - ${selfDoubt}`]
              .filter(Boolean).join('\n');
          }
        } catch { /* rationale-less splitbrain is fine */ }
      }
      const banterContext = await buildCheekyBillContext(db, {
        userId,
        teamId,
        raceId,
        predictions,
        includeTracksideNews: roastMode === 'news',
      });
      // Nothing newsworthy found (no live session, no headline naming a pick) → standard.
      if (roastMode === 'news' && !banterContext.newsFacts) roastMode = 'standard';
      // Anti-sameness (v3.8.0/v3.8.1): feed Bill his own recent material + recent devices so
      // he repeats neither his gags nor his delivery structures.
      const roastHistory = await getRecentRoastHistory(db);
      const roast = await generateCheekyComment({
        teamName,
        driverList,
        raceName,
        lastRaceFacts: banterContext.lastRaceFacts,
        standingsFacts: banterContext.standingsFacts,
        previousSubmissionFacts: banterContext.previousSubmissionFacts,
        formFacts: banterContext.formFacts,
        mode: roastMode,
        newsFacts: banterContext.newsFacts,
        rationaleFacts,
        recentRoasts: roastHistory.lines.join('\n'),
        recentDevices: roastHistory.devices,
      });
      cheekyLine = roast.comment;
      // Awaited (not fire-and-forget) — post-response work dies under Cloud Run CPU throttle.
      if (cheekyLine) await recordRoastLine(db, cheekyLine, teamName, roast.device);
    } catch (cheekyErr: any) {
      // Decorative — a roast-less notification still goes out.
      console.error('[roast-submission] Error generating cheeky Bill comment (non-fatal):', cheekyErr?.message);
    }

    const msg = `🏎️ *${teamName}* submitted picks for ${raceName}:\n\n${driverList}${cheekyLine ? `\n\n_${cheekyLine}_` : ''}`;
    const queueRef = await db.collection('whatsapp_queue').add({
      groupName: 'Prix6.Win',
      message: msg,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
    });
    // Wake the scale-to-zero worker so the message delivers immediately instead of sitting
    // PENDING until the worker happens to wake (the Kwik Fitties stranding bug). Best-effort.
    await wakeWhatsAppWorker();

    await taskRef.update({ status: 'DONE', queueDocId: queueRef.id, doneAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ success: true, queueDocId: queueRef.id });
  } catch (err: any) {
    console.error('[roast-submission] task failed:', err?.message || err);
    if (taskId) {
      await db.collection('roast_tasks').doc(taskId)
        .update({ status: 'ERROR', error: String(err?.message || err).slice(0, 300), erroredAt: FieldValue.serverTimestamp() })
        .catch(() => { /* best-effort */ });
    }
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
