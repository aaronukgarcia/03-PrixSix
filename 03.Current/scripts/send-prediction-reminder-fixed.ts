#!/usr/bin/env tsx
/**
 * Send prediction reminder email using direct Microsoft Graph API.
 * Bypasses app imports to avoid path resolution issues.
 *
 * GUID: SCRIPT_SEND_PREDICTION_REMINDER-001-v01
 */

import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
const envPath = join(__dirname, '..', 'app', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
});

function getGraphClient() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Graph API credentials in environment variables');
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  return Client.initWithMiddleware({ authProvider });
}

async function sendEmail(to: string, subject: string, htmlContent: string) {
  const client = getGraphClient();
  const senderEmail = process.env.GRAPH_SENDER_EMAIL || 'aaron@garcia.ltd';

  const message = {
    subject,
    body: {
      contentType: "HTML",
      content: htmlContent,
    },
    toRecipients: [
      {
        emailAddress: {
          address: to,
        },
      },
    ],
  };

  await client.api(`/users/${senderEmail}/sendMail`).post({
    message,
    saveToSentItems: true,
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Send Prediction Reminder Email');
  console.log('═══════════════════════════════════════════════════════════\n');

  const recipientEmail = 'aaron@garcia.ltd';
  const recipientName = 'Aaron';
  const subject = '🏎️ Your Prix Six team is ready – Season starts soon!';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a2e;
      background: #f9f9f9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #e10600 0%, #c00500 100%);
      color: #ffffff;
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 0;
      font-size: 18px;
      opacity: 0.95;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #e10600;
      font-size: 24px;
      margin: 0 0 20px 0;
      font-weight: 600;
    }
    .content p {
      margin: 0 0 20px 0;
      font-size: 16px;
      line-height: 1.7;
    }
    .highlight-box {
      background: #fff5f5;
      border-left: 4px solid #e10600;
      padding: 20px;
      margin: 30px 0;
      border-radius: 6px;
    }
    .highlight-box p {
      margin: 0 0 10px 0;
      font-size: 15px;
    }
    .highlight-box p:last-child {
      margin: 0;
    }
    .cta-button {
      display: inline-block;
      background: #e10600;
      color: #ffffff;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 18px;
      margin: 20px 0;
      transition: background 0.2s;
    }
    .cta-button:hover {
      background: #c00500;
    }
    .features {
      margin: 30px 0;
    }
    .feature {
      margin: 15px 0;
      padding-left: 30px;
      position: relative;
    }
    .feature:before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #00d200;
      font-weight: bold;
      font-size: 20px;
    }
    .footer {
      background: #f5f5f5;
      padding: 30px;
      text-align: center;
      font-size: 13px;
      color: #666;
      border-top: 1px solid #e0e0e0;
    }
    .footer a {
      color: #e10600;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
    .footer .preferences {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #d0d0d0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏎️ Prix Six</h1>
      <p>The 2026 F1 Prediction Championship</p>
    </div>

    <div class="content">
      <h2>Hi ${recipientName}! 👋</h2>

      <p>Your team is registered with <strong>Prix6.Win</strong>, but we notice you haven't submitted your prediction yet.</p>

      <p>The 2026 season is about to start – <strong>don't miss out!</strong> Get your prediction in now and compete for the championship.</p>

      <div class="highlight-box">
        <p><strong>🎯 Here's the best part:</strong></p>
        <p>You can <strong>freely adjust your prediction at any time</strong> before qualifying starts. Try different strategies, analyze the practice sessions, and fine-tune your picks right up until the last minute.</p>
      </div>

      <div style="text-align: center;">
        <a href="https://prixsix.web.app/predictions" class="cta-button">
          Submit Your Prediction Now
        </a>
      </div>

      <div class="features">
        <p><strong>What makes Prix Six special:</strong></p>
        <div class="feature">Live scoring and instant results after each race</div>
        <div class="feature">AI-powered prediction insights and analysis</div>
        <div class="feature">Compete against friends in private leagues</div>
        <div class="feature">Real-time standings updated throughout the season</div>
        <div class="feature">Adjust predictions anytime before qualifying</div>
      </div>

      <p style="margin-top: 30px;">The grid is forming, the engines are warming up, and the season is almost here. <strong>Will you be on the starting line?</strong></p>

      <p style="font-size: 14px; color: #666; margin-top: 40px;">
        Need help? Visit our <a href="https://prixsix.web.app/help" style="color: #e10600;">help center</a> or check the <a href="https://prixsix.web.app/how-it-works" style="color: #e10600;">how it works</a> guide.
      </p>
    </div>

    <div class="footer">
      <p><strong>Prix Six</strong> – Where F1 Prediction Meets Championship Glory</p>
      <p style="margin-top: 10px;">
        <a href="https://prixsix.web.app">prixsix.web.app</a>
      </p>

      <div class="preferences">
        <p><strong>Email Preferences</strong></p>
        <p style="margin-top: 10px;">
          You can <a href="https://prixsix.web.app/profile">adjust your profile</a> to manage email notifications or <a href="https://prixsix.web.app/profile">close your account</a> at any time.
        </p>
        <p style="margin-top: 15px; font-size: 12px; color: #999;">
          You're receiving this because you registered a team with Prix Six.<br>
          If you no longer wish to participate, you can delete your account from your profile settings.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  console.log(`📧 Sending prediction reminder to ${recipientEmail}...\n`);

  try {
    await sendEmail(recipientEmail, subject, htmlBody);

    console.log('✅ Email sent successfully!');
    console.log(`   Recipient: ${recipientEmail}`);
    console.log(`   Subject: ${subject}\n`);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Failed to send email:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

main();
