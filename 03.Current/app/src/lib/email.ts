import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
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

const ADMIN_EMAIL = 'aaron@garcia.ltd';

// Generate a unique GUID for email tracking
function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Get Graph client
function getGraphClient() {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials not configured");
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"]
  });

  return Client.initWithMiddleware({ authProvider });
}

interface SendEmailResult {
  success: boolean;
  emailGuid: string;
  error?: string;
  queued?: boolean;
  queueReason?: string;
}

interface WelcomeEmailParams {
  toEmail: string;
  teamName: string;
  pin: string;
  firestore?: any;
}

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
        <a href="https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/login" class="cta-button">Log In Now</a>
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

    // Record sent email if firestore is provided
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

    return { success: true, emailGuid };
  } catch (error: any) {
    console.error("Error sending welcome email:", error.message);
    return { success: false, emailGuid, error: error.message };
  }
}

interface GenericEmailParams {
  toEmail: string;
  subject: string;
  htmlContent: string;
}

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

    return { success: true, emailGuid };
  } catch (error: any) {
    console.error("Error sending email:", error.message);
    return { success: false, emailGuid, error: error.message };
  }
}
