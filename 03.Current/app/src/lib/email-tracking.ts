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

const DAILY_GLOBAL_LIMIT = 30;
const DAILY_PER_ADDRESS_LIMIT = 5;
const ADMIN_EMAIL = 'aaron@garcia.ltd';

interface DailyEmailStats {
  date: string;
  totalSent: number;
  emailsSent: EmailLogEntry[];
  summaryEmailSent: boolean;
}

interface EmailLogEntry {
  toEmail: string;
  subject: string;
  type: string;
  teamName?: string;
  emailGuid: string;
  sentAt: string;
  status: 'sent' | 'queued' | 'failed';
}

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

/**
 * Get today's date string in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

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

/**
 * Count emails sent to a specific address today
 */
export async function getEmailCountForAddress(firestore: any, email: string): Promise<number> {
  const stats = await getDailyStats(firestore);
  return stats.emailsSent.filter(e => e.toEmail.toLowerCase() === email.toLowerCase()).length;
}

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

/**
 * Get all emails sent today for the daily summary
 */
export async function getTodayEmailList(firestore: any): Promise<EmailLogEntry[]> {
  const stats = await getDailyStats(firestore);
  return stats.emailsSent;
}

/**
 * Mark daily summary as sent
 */
export async function markSummarySent(firestore: any): Promise<void> {
  const today = getTodayDateString();
  const statsRef = doc(firestore, 'email_daily_stats', today);
  await updateDoc(statsRef, { summaryEmailSent: true });
}

/**
 * Check if daily summary has been sent
 */
export async function isSummarySent(firestore: any): Promise<boolean> {
  const stats = await getDailyStats(firestore);
  return stats.summaryEmailSent;
}

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
