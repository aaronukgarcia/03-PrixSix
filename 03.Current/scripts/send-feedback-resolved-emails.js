/**
 * Sends notification emails to feedback submitters whose bugs/features
 * have been resolved. Groups by user email so each person gets ONE email
 * listing all their resolved items with reference IDs and build numbers.
 *
 * Logs every email to Firestore email_logs collection.
 * Sender: aaron@garcia.ltd (via Microsoft Graph API)
 *
 * Run with: node scripts/send-feedback-resolved-emails.js
 * Dry run:  node scripts/send-feedback-resolved-emails.js --dry-run
 */

const path = require('path');
const fs = require('fs');

// Load env vars from app/.env.local for Graph API credentials
const envPath = path.join(__dirname, '..', 'app', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const appModules = path.join(__dirname, '..', 'app', 'node_modules');
const admin = require('firebase-admin');
const { ClientSecretCredential } = require(path.join(appModules, '@azure', 'identity'));
const { Client } = require(path.join(appModules, '@microsoft', 'microsoft-graph-client'));
const { TokenCredentialAuthenticationProvider } = require(path.join(appModules, '@microsoft', 'microsoft-graph-client', 'authProviders', 'azureTokenCredentials'));

// Firebase Admin init
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run');
const SENDER_EMAIL = process.env.GRAPH_SENDER_EMAIL || 'aaron@garcia.ltd';

function getGraphClient() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph credentials not configured. Check .env.local');
  }
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.initWithMiddleware({ authProvider });
}

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildEmailHtml(teamName, items) {
  const rows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;">${item.id}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${item.type === 'feature' ? 'Feature' : 'Bug'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${item.text}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold;">v${item.resolvedVersion}</td>
        </tr>`
    )
    .join('\n');

  const uniqueBuilds = [...new Set(items.map((i) => `v${i.resolvedVersion}`))].join(', ');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 650px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #1e1e1e; color: white; padding: 10px 12px; text-align: left; font-size: 13px; }
    .cta-button { display: inline-block; background: #e10600; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Feedback Has Been Addressed</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hi <strong>${teamName}</strong>,</p>

      <p>Thank you for taking the time to submit feedback — it genuinely helps us make Prix Six better for everyone.</p>

      <p>We're pleased to let you know that the following item${items.length > 1 ? 's have' : ' has'} been addressed in build${[...new Set(items.map((i) => i.resolvedVersion))].length > 1 ? 's' : ''} <strong>${uniqueBuilds}</strong>:</p>

      <table>
        <thead>
          <tr>
            <th>Ref</th>
            <th>Type</th>
            <th>Description</th>
            <th>Fixed In</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <p>The fixes are live now. If you notice anything else or have further suggestions, we'd love to hear from you.</p>

      <p style="text-align: center;">
        <a href="https://prix6.win/dashboard" class="cta-button">Open Prix Six</a>
      </p>

      <p>Thanks again for your support,<br><strong>Aaron</strong><br>Prix Six</p>
    </div>
  </div>
</body>
</html>`.trim();
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== SENDING EMAILS ===');
  console.log(`Sender: ${SENDER_EMAIL}\n`);

  // Fetch all resolved feedback that hasn't been email-notified
  const snap = await db.collection('feedback').where('status', '==', 'resolved').get();

  if (snap.empty) {
    console.log('No resolved feedback entries found.');
    return;
  }

  // Group by userEmail
  const grouped = {};
  snap.forEach((doc) => {
    const d = doc.data();
    const email = d.userEmail;
    if (!grouped[email]) {
      grouped[email] = { teamName: d.teamName, items: [] };
    }
    // Use latest teamName
    if (d.teamName) grouped[email].teamName = d.teamName;
    grouped[email].items.push({
      id: doc.id,
      type: d.type || 'bug',
      text: d.text ? (d.text.length > 80 ? d.text.substring(0, 77) + '...' : d.text) : '(no description)',
      resolvedVersion: d.resolvedVersion || 'unknown',
    });
  });

  const graphClient = DRY_RUN ? null : getGraphClient();
  let sent = 0;
  let failed = 0;

  for (const [userEmail, { teamName, items }] of Object.entries(grouped)) {
    const emailGuid = generateGuid();
    const refIds = items.map((i) => i.id).join(', ');
    const builds = [...new Set(items.map((i) => `v${i.resolvedVersion}`))].join(', ');
    const subject = `Prix Six: Your feedback has been addressed (${builds})`;
    const htmlContent = buildEmailHtml(teamName, items);

    console.log(`[${userEmail}] ${teamName} — ${items.length} item(s), builds: ${builds}`);
    items.forEach((i) => console.log(`  - ${i.id} (${i.type}, ${i.resolvedVersion}): ${i.text}`));

    if (DRY_RUN) {
      console.log(`  -> Would send email (GUID: ${emailGuid})\n`);
      continue;
    }

    try {
      const message = {
        subject,
        body: { contentType: 'HTML', content: htmlContent },
        toRecipients: [{ emailAddress: { address: userEmail } }],
      };
      await graphClient.api(`/users/${SENDER_EMAIL}/sendMail`).post({ message });

      // Log to email_logs
      await db.collection('email_logs').add({
        to: userEmail,
        subject,
        html: htmlContent,
        pin: 'N/A',
        status: 'sent',
        timestamp: admin.firestore.Timestamp.now(),
        emailGuid,
        teamName,
      });

      console.log(`  -> Sent (GUID: ${emailGuid})\n`);
      sent++;
    } catch (err) {
      console.error(`  -> FAILED: ${err.message}\n`);

      // Log failure
      await db.collection('email_logs').add({
        to: userEmail,
        subject,
        html: htmlContent,
        pin: 'N/A',
        status: 'failed',
        timestamp: admin.firestore.Timestamp.now(),
        emailGuid,
        teamName,
        error: err.message,
      });

      failed++;
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}, Total users: ${Object.keys(grouped).length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
