// GUID: LIB_WHATSAPP_WAKE-000-v01
// [Intent] Wake the scale-to-zero WhatsApp worker (Azure Container App, minReplicas:0) after a
//          message is enqueued to whatsapp_queue, by POSTing to its HMAC-protected /process-queue
//          endpoint. The HTTP request itself triggers Azure's scale-from-zero; the worker then drains
//          all PENDING messages. Without this, an enqueued message sits PENDING until the worker
//          happens to wake for some other reason (intermittent delivery — the Kwik Fitties bug).
// [Inbound Trigger] Called fire-and-forget right after db.collection('whatsapp_queue').add(...).
// [Downstream Impact] Best-effort: never throws, short timeout. If it fails, the worker's own queue
//                     listener still drains PENDING the next time it wakes — delivery is just delayed.
import crypto from 'crypto';

const WORKER_URL_FALLBACK = 'https://prixsix-whatsapp.delightfulmushroom-6fa10cd0.uksouth.azurecontainerapps.io';

export async function wakeWhatsAppWorker(): Promise<void> {
  try {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return; // can't sign — skip silently
    const workerUrl = process.env.WHATSAPP_WORKER_URL || WORKER_URL_FALLBACK;
    const signature = `sha256=${crypto.createHmac('sha256', secret).update('process-queue').digest('hex')}`;
    await fetch(`${workerUrl}/process-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      // The request reaching Azure ingress is what triggers scale-up; we don't need to await the
      // worker's cold start (~15-30s), so a short timeout is fine.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Best-effort. The worker's queue listener drains PENDING when it next wakes.
  }
}
