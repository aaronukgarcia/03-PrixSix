// GUID: LIB_EMAIL-000-v03
// [Intent] Server-side email sending module using Microsoft Graph API via Azure AD credentials. Provides welcome emails and generic email dispatch with rate-limiting, queuing, and Firestore logging.
// [Inbound Trigger] Called by API routes (e.g., user registration, admin actions) that need to send transactional emails.
// [Downstream Impact] Depends on email-tracking.ts for rate limiting and queuing. Writes to email_logs Firestore collection. Failures affect user onboarding and admin notifications.

import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import {
  canSendEmail,
  recordSentEmail,
  queueEmail,
  getTodayDateString,
  generateDailySummaryHtml,
  getTodayEmailList,
  markSummarySent,
  isSummarySent
} from "./email-tracking";

// GUID: LIB_EMAIL-001-v03
// [Intent] Initialise and return a Firebase Admin Firestore instance for server-side email logging. Uses service account credentials if available, otherwise falls back to default project initialisation.
// [Inbound Trigger] Called internally by sendWelcomeEmail and sendEmail when logging email activity to Firestore.
// [Downstream Impact] Provides the Firestore reference used to write to email_logs collection. If this fails, email sending still succeeds but logging is lost.
function getAdminDb() {
  if (!getApps().length) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath) {
      initializeApp({
        credential: cert(serviceAccountPath),
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    } else {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
    }
  }
  return getFirestore();
}

// GUID: LIB_EMAIL-002-v03
// [Intent] Admin email address constant used as the default sender fallback.
// [Inbound Trigger] Referenced when GRAPH_SENDER_EMAIL environment variable is not set.
// [Downstream Impact] Changing this affects the default sender address for all outbound emails.
const ADMIN_EMAIL = 'aaron@garcia.ltd';

// GUID: LIB_EMAIL-003-v03
// [Intent] Generate a RFC 4122 v4-style GUID for uniquely identifying each email sent, enabling tracking and audit trail lookup.
// [Inbound Trigger] Called at the start of sendWelcomeEmail and sendEmail to assign a unique reference to each email.
// [Downstream Impact] The generated GUID is embedded in the email footer, stored in email_logs, and returned to the caller. Used for support reference when users report email issues.
function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// GUID: LIB_EMAIL-004-v03
// [Intent] Create and return an authenticated Microsoft Graph API client using Azure AD client credentials (tenant ID, client ID, client secret). This client is used to send emails via the Graph /sendMail endpoint.
// [Inbound Trigger] Called by sendWelcomeEmail and sendEmail before dispatching each email.
// [Downstream Impact] If credentials are missing or invalid, all email sending fails. Depends on GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET environment variables.
function getGraphClient() {
  // Trim secrets to remove any trailing whitespace/newlines from environment
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials not configured");
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"]
  });

  return Client.initWithMiddleware({ authProvider });
}

// GUID: LIB_EMAIL-005-v03
// [Intent] Type definition for the result returned by email-sending functions, indicating success/failure, the tracking GUID, optional error detail, and whether the email was queued due to rate limiting.
// [Inbound Trigger] Used as the return type of sendWelcomeEmail and sendEmail.
// [Downstream Impact] API routes depend on this shape to construct their response payloads. Changes here require updates to all callers.
interface SendEmailResult {
  success: boolean;
  emailGuid: string;
  error?: string;
  queued?: boolean;
  queueReason?: string;
}

// GUID: LIB_EMAIL-006-v03
// [Intent] Type definition for the parameters required to send a welcome email, including recipient, team name, PIN, and optional Firestore instance for rate-limit tracking.
// [Inbound Trigger] Used as the parameter type of sendWelcomeEmail.
// [Downstream Impact] Changes here require updates to all callers of sendWelcomeEmail.
interface WelcomeEmailParams {
  toEmail: string;
  teamName: string;
  pin: string;
  firestore?: any;
}

// GUID: LIB_EMAIL-007-v03
// [Intent] Send a branded welcome email to a newly registered user containing their team name and 6-digit PIN. Enforces rate limiting via email-tracking, queues if rate-limited, logs success/failure to email_logs collection, and returns a tracking GUID.
// [Inbound Trigger] Called from the user registration API route when a new account is created and a welcome email is required.
// [Downstream Impact] On success, the user receives their PIN and login link. On rate-limit, the email is queued in email_queue collection. Always writes to email_logs for admin audit. Depends on getGraphClient (LIB_EMAIL-004), canSendEmail/recordSentEmail/queueEmail from email-tracking, and getAdminDb (LIB_EMAIL-001).
export async function sendWelcomeEmail({ toEmail, teamName, pin, firestore }: WelcomeEmailParams): Promise<SendEmailResult> {
  const emailGuid = generateGuid();
  const senderEmail = process.env.GRAPH_SENDER_EMAIL || 'aaron@garcia.ltd';
  const subject = "Welcome to Prix Six - Your Account is Ready!";
  const emailType = "welcome";

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .pin-box { background: #1e1e1e; color: #e10600; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; margin: 20px 0; border-radius: 8px; letter-spacing: 8px; }
    .cta-button { display: inline-block; background: #e10600; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .preferences { background: #fff; padding: 20px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #e10600; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Prix Six!</h1>
      <p>The F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello <strong>${teamName}</strong>,</p>

      <p>Welcome to the Prix Six league! Your account has been created and you're ready to start making predictions.</p>

      <p>Your secure 6-digit PIN is:</p>
      <div class="pin-box">${pin}</div>

      <p style="text-align: center;">
        <a href="https://prix6.win/login" class="cta-button">Log In Now</a>
      </p>

      <div class="preferences">
        <h3>Set Your Preferences</h3>
        <p>After logging in, visit your profile to set up:</p>
        <ul>
          <li><strong>Prediction Reminders</strong> - Get notified before each race deadline</li>
          <li><strong>Results Notifications</strong> - Catch up on race results and standings</li>
        </ul>
      </div>

      <div class="security-note">
        <strong>Security Notice:</strong> If you did not request this account, please reply to this email immediately to notify <a href="mailto:aaron@garcia.ltd">aaron@garcia.ltd</a>.
      </div>

      <p>Good luck with your predictions!</p>
      <p>- The Prix Six Team</p>
    </div>
    <div class="footer">
      <p>Email Reference: ${emailGuid}</p>
      <p>Prix Six - F1 Prediction League</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  try {
    // Check rate limits if firestore is provided
    if (firestore) {
      const rateCheck = await canSendEmail(firestore, toEmail);
      if (!rateCheck.canSend) {
        // Queue the email instead
        await queueEmail(firestore, {
          toEmail,
          subject,
          htmlContent,
          type: emailType,
          teamName,
          reason: rateCheck.reason || 'Rate limit exceeded'
        });
        return {
          success: false,
          emailGuid,
          queued: true,
          queueReason: rateCheck.reason
        };
      }
    }

    const client = getGraphClient();

    const message = {
      subject,
      body: {
        contentType: "HTML",
        content: htmlContent
      },
      toRecipients: [
        {
          emailAddress: {
            address: toEmail
          }
        }
      ]
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });

    // Record sent email if firestore is provided (for rate limiting)
    if (firestore) {
      await recordSentEmail(firestore, {
        toEmail,
        subject,
        type: emailType,
        teamName,
        emailGuid,
        sentAt: new Date().toISOString(),
        status: 'sent'
      });
    }

    // Log to email_logs collection for the admin UI
    try {
      const adminDb = getAdminDb();
      await adminDb.collection('email_logs').add({
        to: toEmail,
        subject,
        html: htmlContent,
        pin,
        status: 'sent',
        timestamp: Timestamp.now(),
        emailGuid,
        teamName,
      });
    } catch (logError: any) {
      console.error("Error logging welcome email to email_logs:", logError.message);
    }

    return { success: true, emailGuid };
  } catch (error: any) {
    console.error("Error sending welcome email:", error.message);

    // Log failed email to email_logs
    try {
      const adminDb = getAdminDb();
      await adminDb.collection('email_logs').add({
        to: toEmail,
        subject,
        html: htmlContent,
        pin,
        status: 'failed',
        timestamp: Timestamp.now(),
        emailGuid,
        teamName,
        error: error.message,
      });
    } catch (logError: any) {
      console.error("Error logging failed welcome email:", logError.message);
    }

    return { success: false, emailGuid, error: error.message };
  }
}

// GUID: LIB_EMAIL-008-v03
// [Intent] Type definition for generic email parameters (recipient, subject, HTML content) used by the general-purpose sendEmail function.
// [Inbound Trigger] Used as the parameter type of sendEmail.
// [Downstream Impact] Changes here require updates to all callers of sendEmail.
interface GenericEmailParams {
  toEmail: string;
  subject: string;
  htmlContent: string;
}

// GUID: LIB_EMAIL-009-v03
// [Intent] Send a generic email with arbitrary HTML content via Microsoft Graph API. Appends a standard footer with tracking GUID and Prix Six branding. Logs success/failure to email_logs collection for admin audit.
// [Inbound Trigger] Called by API routes or server actions that need to send non-welcome transactional emails (e.g., daily summaries, notifications).
// [Downstream Impact] On success, the recipient receives the email. Always writes to email_logs for admin audit. Depends on getGraphClient (LIB_EMAIL-004) and getAdminDb (LIB_EMAIL-001). Does not use rate limiting (unlike sendWelcomeEmail).
export async function sendEmail({ toEmail, subject, htmlContent }: GenericEmailParams): Promise<SendEmailResult> {
  const emailGuid = generateGuid();
  const senderEmail = process.env.GRAPH_SENDER_EMAIL || 'aaron@garcia.ltd';

  // Add email footer with GUID
  const contentWithFooter = `
${htmlContent}
<div style="text-align: center; color: #666; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
  <p>Email Reference: ${emailGuid}</p>
  <p>Prix Six - F1 Prediction League</p>
  <p>If you did not expect this email, please reply to <a href="mailto:aaron@garcia.ltd">aaron@garcia.ltd</a></p>
</div>
  `.trim();

  try {
    const client = getGraphClient();

    const message = {
      subject,
      body: {
        contentType: "HTML",
        content: contentWithFooter
      },
      toRecipients: [
        {
          emailAddress: {
            address: toEmail
          }
        }
      ]
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });

    // Log to email_logs collection for the admin UI
    try {
      const adminDb = getAdminDb();
      await adminDb.collection('email_logs').add({
        to: toEmail,
        subject,
        html: contentWithFooter,
        pin: 'N/A',
        status: 'sent',
        timestamp: Timestamp.now(),
        emailGuid,
      });
    } catch (logError: any) {
      console.error("Error logging email to email_logs:", logError.message);
      // Don't fail the email send if logging fails
    }

    return { success: true, emailGuid };
  } catch (error: any) {
    console.error("Error sending email:", error.message);

    // Log failed email to email_logs
    try {
      const adminDb = getAdminDb();
      await adminDb.collection('email_logs').add({
        to: toEmail,
        subject,
        html: htmlContent,
        pin: 'N/A',
        status: 'failed',
        timestamp: Timestamp.now(),
        emailGuid,
        error: error.message,
      });
    } catch (logError: any) {
      console.error("Error logging failed email:", logError.message);
    }

    return { success: false, emailGuid, error: error.message };
  }
}
