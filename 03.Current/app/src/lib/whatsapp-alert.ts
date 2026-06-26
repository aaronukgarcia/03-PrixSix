// GUID: LIB_WHATSAPP_ALERT-000-v02
// [Intent] Single gateway for sending a categorised WhatsApp alert. Centralises the gating that the
//          per-event call sites used to lack: reads admin_configuration/whatsapp_alerts and only
//          enqueues when masterEnabled AND the specific alert toggle is on AND a destination group
//          resolves. Routes by testMode: test traffic goes to the SANDBOX group (prix6-test), so real
//          players never receive test messages; production goes to the league group. Enqueues to
//          whatsapp_queue and wakes the scale-to-zero worker so it delivers promptly.
// [Inbound Trigger] Called fire-and-forget from event handlers (results published, new player, etc.)
//          and from scheduled jobs.
// [Downstream Impact] Adds a PENDING whatsapp_queue doc + pings /process-queue. Never throws — returns
//          a small status object so callers can log without try/catch noise.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';

// GUID: LIB_WHATSAPP_ALERT-002-v01
// WhatsApp delivery groups (SSOT — mirrored in functions/index.js WHATSAPP_PROD_GROUP/TEST_GROUP).
// Production = the league group (real players); TEST = the sandbox group for test traffic. Config
// fields admin_configuration/whatsapp_alerts.targetGroup / .testGroup override these coded defaults.
export const WHATSAPP_PRODUCTION_GROUP = 'Prix6.Win';
export const WHATSAPP_TEST_GROUP = 'prix6-test';

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

    // Route by testMode: test traffic to the sandbox group, production to the league group.
    const isTest = settings.testMode === true;
    const targetGroup: string | undefined = isTest
      ? (settings.testGroup || WHATSAPP_TEST_GROUP)
      : (settings.targetGroup || WHATSAPP_PRODUCTION_GROUP);
    if (!targetGroup) return { queued: false, reason: 'no target group' };

    const prefix = isTest ? '🧪 [TEST] ' : '';
    await db.collection('whatsapp_queue').add({
      groupName: targetGroup,
      message: prefix + message,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: `alert:${alertType}`,
      testMode: isTest,
    });
    await wakeWhatsAppWorker();
    return { queued: true };
  } catch (e: any) {
    return { queued: false, reason: e?.message || 'send failed' };
  }
}
