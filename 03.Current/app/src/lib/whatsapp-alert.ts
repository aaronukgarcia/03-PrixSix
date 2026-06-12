// GUID: LIB_WHATSAPP_ALERT-000-v01
// [Intent] Single gateway for sending a categorised WhatsApp alert. Centralises the gating that the
//          per-event call sites used to lack: reads admin_configuration/whatsapp_alerts and only
//          enqueues when masterEnabled AND the specific alert toggle is on AND a target group is set.
//          Respects testMode (prefixes the message). Enqueues to whatsapp_queue and wakes the
//          scale-to-zero worker so it delivers promptly.
// [Inbound Trigger] Called fire-and-forget from event handlers (results published, new player, etc.)
//          and from scheduled jobs.
// [Downstream Impact] Adds a PENDING whatsapp_queue doc + pings /process-queue. Never throws — returns
//          a small status object so callers can log without try/catch noise.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';

export type WhatsAppAlertType =
  | 'qualifyingReminder' | 'raceReminder' | 'resultsPublished' | 'newPlayerJoined'
  | 'predictionSubmitted' | 'latePredictionWarning' | 'weeklyStandingsUpdate'
  | 'endOfSeasonSummary' | 'adminAnnouncements' | 'customMessages';

export async function sendWhatsAppAlert(
  alertType: WhatsAppAlertType,
  message: string
): Promise<{ queued: boolean; reason?: string }> {
  try {
    const { db, FieldValue } = await getFirebaseAdmin();
    const settings = (await db.collection('admin_configuration').doc('whatsapp_alerts').get()).data();
    if (!settings?.masterEnabled) return { queued: false, reason: 'master switch off' };
    if (!settings?.alerts?.[alertType]) return { queued: false, reason: `${alertType} toggle off` };
    const targetGroup: string | undefined = settings.targetGroup;
    if (!targetGroup) return { queued: false, reason: 'no target group' };

    const prefix = settings.testMode ? '🧪 [TEST] ' : '';
    await db.collection('whatsapp_queue').add({
      groupName: targetGroup,
      message: prefix + message,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: `alert:${alertType}`,
    });
    await wakeWhatsAppWorker();
    return { queued: true };
  } catch (e: any) {
    return { queued: false, reason: e?.message || 'send failed' };
  }
}
