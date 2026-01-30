// GUID: LIB_EMAIL_TRACKING-000-v03
// [Intent] Client-side email tracking and rate-limiting module. Manages daily email statistics, enforces global and per-address send limits, provides email queuing for rate-limited messages, and generates daily summary HTML reports.
// [Inbound Trigger] Called by email.ts (LIB_EMAIL) before and after sending emails, and by admin summary endpoints.
// [Downstream Impact] Controls whether emails can be sent (rate gating). Writes to email_daily_stats and email_queue Firestore collections. The daily summary HTML is sent to the admin via sendEmail.

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  arrayUnion,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

// GUID: LIB_EMAIL_TRACKING-001-v03
// [Intent] Rate-limit constants defining the maximum number of emails allowed per day globally and per individual recipient address.
// [Inbound Trigger] Referenced by canSendEmail to enforce rate limits and by generateDailySummaryHtml for display in the summary footer.
// [Downstream Impact] Changing these values directly affects how many emails the system can send per day. Lowering them may cause more emails to be queued rather than sent immediately.
const DAILY_GLOBAL_LIMIT = 30;
const DAILY_PER_ADDRESS_LIMIT = 5;
const ADMIN_EMAIL = 'aaron@garcia.ltd';

// GUID: LIB_EMAIL_TRACKING-002-v03
// [Intent] Type definition for daily email statistics stored in the email_daily_stats Firestore collection, tracking total sent count, individual email log entries, and whether the daily summary has been dispatched.
// [Inbound Trigger] Used as the shape of documents read from and written to the email_daily_stats collection.
// [Downstream Impact] Changes to this interface require updates to getDailyStats, recordSentEmail, and any admin UI that reads daily stats.
interface DailyEmailStats {
  date: string;
  totalSent: number;
  emailsSent: EmailLogEntry[];
  summaryEmailSent: boolean;
}

// GUID: LIB_EMAIL_TRACKING-003-v03
// [Intent] Type definition for an individual email log entry within the daily stats, capturing recipient, subject, type, team, tracking GUID, timestamp, and delivery status.
// [Inbound Trigger] Used when recording sent emails and when reading the email list for daily summaries.
// [Downstream Impact] Changes here affect recordSentEmail, getTodayEmailList, and generateDailySummaryHtml.
interface EmailLogEntry {
  toEmail: string;
  subject: string;
  type: string;
  teamName?: string;
  emailGuid: string;
  sentAt: string;
  status: 'sent' | 'queued' | 'failed';
}

// GUID: LIB_EMAIL_TRACKING-004-v03
// [Intent] Type definition for a queued email document stored in the email_queue Firestore collection when rate limits prevent immediate sending.
// [Inbound Trigger] Used by queueEmail, getPendingQueuedEmails, and updateQueuedEmailStatus.
// [Downstream Impact] Changes here affect the email queue processing pipeline and any admin UI that displays queued emails.
interface QueuedEmail {
  id?: string;
  toEmail: string;
  subject: string;
  htmlContent: string;
  type: string;
  teamName?: string;
  queuedAt: any;
  status: 'pending' | 'sent' | 'failed';
  reason: string;
}

// GUID: LIB_EMAIL_TRACKING-005-v03
// [Intent] Return today's date as a YYYY-MM-DD string for use as the Firestore document ID in email_daily_stats.
// [Inbound Trigger] Called by getDailyStats, recordSentEmail, and markSummarySent to determine the current day's stats document.
// [Downstream Impact] All daily tracking depends on this format. Timezone is server-local (UTC in production). Changing the format would break existing stats document lookups.
/**
 * Get today's date string in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// GUID: LIB_EMAIL_TRACKING-006-v03
// [Intent] Retrieve or create the daily email statistics document for today from the email_daily_stats Firestore collection. If no document exists for today, initialises one with zero counts.
// [Inbound Trigger] Called by canSendEmail, getEmailCountForAddress, getTodayEmailList, and isSummarySent.
// [Downstream Impact] Provides the rate-limit data used to decide whether emails can be sent. Creates the stats document on first access each day.
/**
 * Get or create today's email stats document
 */
export async function getDailyStats(firestore: any): Promise<DailyEmailStats> {
  const today = getTodayDateString();
  const statsRef = doc(firestore, 'email_daily_stats', today);
  const statsDoc = await getDoc(statsRef);

  if (statsDoc.exists()) {
    return statsDoc.data() as DailyEmailStats;
  }

  // Create new stats document for today
  const newStats: DailyEmailStats = {
    date: today,
    totalSent: 0,
    emailsSent: [],
    summaryEmailSent: false
  };

  await setDoc(statsRef, newStats);
  return newStats;
}

// GUID: LIB_EMAIL_TRACKING-007-v03
// [Intent] Count how many emails have been sent to a specific email address today, using case-insensitive matching against the daily stats log.
// [Inbound Trigger] Can be called by any component needing per-address send counts (currently not directly used; canSendEmail performs its own inline count).
// [Downstream Impact] Returns a number used for display or additional validation. Depends on getDailyStats.
/**
 * Count emails sent to a specific address today
 */
export async function getEmailCountForAddress(firestore: any, email: string): Promise<number> {
  const stats = await getDailyStats(firestore);
  return stats.emailsSent.filter(e => e.toEmail.toLowerCase() === email.toLowerCase()).length;
}

// GUID: LIB_EMAIL_TRACKING-008-v03
// [Intent] Check whether the system is allowed to send an email to the given address by validating against the daily global limit and per-address limit. The admin email is exempt from per-address limits.
// [Inbound Trigger] Called by sendWelcomeEmail (LIB_EMAIL-007) before attempting to send, to enforce rate limiting.
// [Downstream Impact] If canSend is false, the caller must queue the email instead of sending it. Controls the flow between immediate send and queued send paths.
/**
 * Check if we can send an email (rate limiting)
 */
export async function canSendEmail(firestore: any, toEmail: string): Promise<{ canSend: boolean; reason?: string }> {
  const stats = await getDailyStats(firestore);

  // Check global daily limit
  if (stats.totalSent >= DAILY_GLOBAL_LIMIT) {
    return { canSend: false, reason: `Daily global limit of ${DAILY_GLOBAL_LIMIT} emails reached` };
  }

  // Check per-address limit (skip for admin email)
  if (toEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    const addressCount = stats.emailsSent.filter(
      e => e.toEmail.toLowerCase() === toEmail.toLowerCase()
    ).length;

    if (addressCount >= DAILY_PER_ADDRESS_LIMIT) {
      return { canSend: false, reason: `Daily limit of ${DAILY_PER_ADDRESS_LIMIT} emails to ${toEmail} reached` };
    }
  }

  return { canSend: true };
}

// GUID: LIB_EMAIL_TRACKING-009-v03
// [Intent] Record a successfully sent email in today's daily stats document by incrementing the total count and appending the log entry to the emailsSent array.
// [Inbound Trigger] Called by sendWelcomeEmail (LIB_EMAIL-007) after a successful Graph API send, when a Firestore instance is available.
// [Downstream Impact] Updates the rate-limit counters that canSendEmail reads. If this fails, rate limiting may under-count, potentially allowing more emails than the limit.
/**
 * Record a sent email in today's stats
 */
export async function recordSentEmail(
  firestore: any,
  entry: EmailLogEntry
): Promise<void> {
  const today = getTodayDateString();
  const statsRef = doc(firestore, 'email_daily_stats', today);

  await updateDoc(statsRef, {
    totalSent: increment(1),
    emailsSent: arrayUnion(entry)
  });
}

// GUID: LIB_EMAIL_TRACKING-010-v03
// [Intent] Queue an email for later sending when rate limits prevent immediate dispatch. Creates a document in the email_queue Firestore collection with pending status.
// [Inbound Trigger] Called by sendWelcomeEmail (LIB_EMAIL-007) when canSendEmail returns canSend: false.
// [Downstream Impact] Queued emails remain in pending status until processed by getPendingQueuedEmails and updateQueuedEmailStatus. Admin can view queued emails in the daily summary.
/**
 * Queue an email for later sending
 */
export async function queueEmail(
  firestore: any,
  email: Omit<QueuedEmail, 'id' | 'queuedAt' | 'status'>
): Promise<string> {
  const queueRef = collection(firestore, 'email_queue');
  const docRef = await addDoc(queueRef, {
    ...email,
    queuedAt: serverTimestamp(),
    status: 'pending'
  });
  return docRef.id;
}

// GUID: LIB_EMAIL_TRACKING-011-v03
// [Intent] Retrieve the list of all email log entries recorded in today's daily stats, for use in generating the daily summary report.
// [Inbound Trigger] Called by the daily summary generation process to get the email list for the summary HTML.
// [Downstream Impact] The returned list is passed to generateDailySummaryHtml. Depends on getDailyStats.
/**
 * Get all emails sent today for the daily summary
 */
export async function getTodayEmailList(firestore: any): Promise<EmailLogEntry[]> {
  const stats = await getDailyStats(firestore);
  return stats.emailsSent;
}

// GUID: LIB_EMAIL_TRACKING-012-v03
// [Intent] Mark the daily summary email as sent in today's stats document to prevent duplicate summary emails within the same day.
// [Inbound Trigger] Called after successfully sending the daily summary email to the admin.
// [Downstream Impact] Sets summaryEmailSent flag to true, which isSummarySent checks before triggering another summary. Prevents duplicate admin summary emails.
/**
 * Mark daily summary as sent
 */
export async function markSummarySent(firestore: any): Promise<void> {
  const today = getTodayDateString();
  const statsRef = doc(firestore, 'email_daily_stats', today);
  await updateDoc(statsRef, { summaryEmailSent: true });
}

// GUID: LIB_EMAIL_TRACKING-013-v03
// [Intent] Check whether the daily summary email has already been sent today, to prevent duplicate summaries.
// [Inbound Trigger] Called before generating and sending the daily summary email.
// [Downstream Impact] Returns a boolean controlling whether the summary generation proceeds. Depends on getDailyStats.
/**
 * Check if daily summary has been sent
 */
export async function isSummarySent(firestore: any): Promise<boolean> {
  const stats = await getDailyStats(firestore);
  return stats.summaryEmailSent;
}

// GUID: LIB_EMAIL_TRACKING-014-v03
// [Intent] Retrieve all pending queued emails from the email_queue Firestore collection for batch processing.
// [Inbound Trigger] Called by the queue processing logic (e.g., scheduled function or admin action) to find emails awaiting delivery.
// [Downstream Impact] Returns queued emails that should be sent. After processing, updateQueuedEmailStatus must be called to update their status.
/**
 * Get pending queued emails
 */
export async function getPendingQueuedEmails(firestore: any): Promise<QueuedEmail[]> {
  const queueRef = collection(firestore, 'email_queue');
  const q = query(queueRef, where('status', '==', 'pending'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as QueuedEmail));
}

// GUID: LIB_EMAIL_TRACKING-015-v03
// [Intent] Update the status of a queued email document after processing (sent or failed), recording the processing timestamp and optional error message.
// [Inbound Trigger] Called after attempting to send a previously queued email, to mark it as sent or failed.
// [Downstream Impact] Prevents re-processing of already-handled queue items. Failed items retain their error message for admin review.
/**
 * Update queued email status
 */
export async function updateQueuedEmailStatus(
  firestore: any,
  emailId: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  const emailRef = doc(firestore, 'email_queue', emailId);
  await updateDoc(emailRef, {
    status,
    processedAt: serverTimestamp(),
    ...(error && { error })
  });
}

// GUID: LIB_EMAIL_TRACKING-016-v03
// [Intent] Generate a styled HTML email body for the daily email summary report, showing counts of sent, queued, and failed emails in a table format with statistics boxes.
// [Inbound Trigger] Called by the daily summary dispatch process, passing in the day's email log entries and date string.
// [Downstream Impact] The returned HTML is sent to the admin via sendEmail (LIB_EMAIL-009). References DAILY_GLOBAL_LIMIT and DAILY_PER_ADDRESS_LIMIT constants for the footer display.
/**
 * Generate HTML for daily summary email
 */
export function generateDailySummaryHtml(emails: EmailLogEntry[], date: string): string {
  const sentEmails = emails.filter(e => e.status === 'sent');
  const queuedEmails = emails.filter(e => e.status === 'queued');
  const failedEmails = emails.filter(e => e.status === 'failed');

  const emailListHtml = sentEmails.length > 0
    ? sentEmails.map(e => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${e.teamName || 'N/A'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${e.type}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${e.toEmail}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${e.sentAt}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #666;">No emails sent today</td></tr>';

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 700px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
    .stats-box { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: white; padding: 15px; border-radius: 8px; text-align: center; flex: 1; }
    .stat-number { font-size: 24px; font-weight: bold; color: #e10600; }
    .stat-label { font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #1e1e1e; color: white; padding: 10px; text-align: left; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Prix Six - Daily Email Summary</h1>
      <p>${date}</p>
    </div>
    <div class="content">
      <div class="stats-box">
        <div class="stat">
          <div class="stat-number">${sentEmails.length}</div>
          <div class="stat-label">Emails Sent</div>
        </div>
        <div class="stat">
          <div class="stat-number">${queuedEmails.length}</div>
          <div class="stat-label">Queued</div>
        </div>
        <div class="stat">
          <div class="stat-number">${failedEmails.length}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>

      <h3>Emails Sent Today</h3>
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Type</th>
            <th>Recipient</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${emailListHtml}
        </tbody>
      </table>

      ${queuedEmails.length > 0 ? `
      <h3 style="margin-top: 30px;">Queued Emails (Rate Limited)</h3>
      <p style="color: #666;">These emails will be sent when daily limits reset.</p>
      <ul>
        ${queuedEmails.map(e => `<li>${e.type} to ${e.toEmail} (${e.teamName || 'N/A'})</li>`).join('')}
      </ul>
      ` : ''}
    </div>
    <div class="footer">
      <p>Prix Six Email System - Daily Summary</p>
      <p>Global limit: ${DAILY_GLOBAL_LIMIT}/day | Per-address limit: ${DAILY_PER_ADDRESS_LIMIT}/day</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
