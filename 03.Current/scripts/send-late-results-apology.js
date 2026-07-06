/**
 * One-off: apology email to players whose British Grand Prix results email was delayed
 * by the email rate-limiter bug (fixed in v3.4.8; results backfilled the same day).
 *
 * Recipients: all users opted in to results notifications (emailPreferences.resultsNotifications
 * !== false) — i.e. everyone who was affected, since the GP batch sent to nobody on time.
 * Sends via Microsoft Graph (aaron@garcia.ltd), logs each send to email_logs.
 *
 * SAFE BY DEFAULT: dry-run. Add --execute to actually send.
 *
 * Dry run:  node scripts/send-late-results-apology.js
 * Send:     node scripts/send-late-results-apology.js --execute
 */

const path = require('path');
const fs = require('fs');

// Load Graph creds from app/.env.local
const envPath = path.join(__dirname, '..', 'app', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i === -1) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const appModules = path.join(__dirname, '..', 'app', 'node_modules');
const admin = require('firebase-admin');
const { ClientSecretCredential } = require(path.join(appModules, '@azure', 'identity'));
const { Client } = require(path.join(appModules, '@microsoft', 'microsoft-graph-client'));
const { TokenCredentialAuthenticationProvider } = require(path.join(appModules, '@microsoft', 'microsoft-graph-client', 'authProviders', 'azureTokenCredentials'));

admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname, '..', 'service-account.json'))) });
const db = admin.firestore();

const EXECUTE = process.argv.includes('--execute');
const SENDER_EMAIL = process.env.GRAPH_SENDER_EMAIL || 'aaron@garcia.ltd';

function getGraphClient() {
  const tenantId = process.env.GRAPH_TENANT_ID?.trim();
  const clientId = process.env.GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) throw new Error('Graph creds missing in .env.local');
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: ['https://graph.microsoft.com/.default'] });
  return Client.initWithMiddleware({ authProvider });
}

function guid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildHtml(teamName) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a1a2e;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:24px;">Prix Six</h1>
    <p style="margin:5px 0 0;opacity:0.9;">A quick apology</p>
  </div>
  <div style="background:#f8f9fa;padding:24px;border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;">
    <p style="margin-top:0;">Hi <strong>${esc(teamName)}</strong>,</p>
    <p>Apologies — your <strong>British Grand Prix</strong> results email arrived later than it should have.</p>
    <p>We found a bug in our email <strong>rate limiter</strong> — a safeguard designed to protect everyone from email storms. On a sprint weekend it was too strict and blocked the race results email from going out on time. <strong>This has now been corrected</strong>, and your results have been sent.</p>
    <p>Thanks for bearing with us — and thanks for playing Prix Six. 🏁</p>
    <p style="margin-bottom:0;">— The Prix Six team</p>
  </div>
  <div style="text-align:center;padding:14px;font-size:12px;color:#888;">
    <p style="margin:0;">See the latest standings at <a href="https://prix6.win/standings" style="color:#e63946;">prix6.win/standings</a></p>
  </div>
</body></html>`;
}

async function main() {
  console.log(`\n=== Late-results apology email (${EXECUTE ? 'EXECUTE — WILL SEND' : 'DRY RUN'}) ===\n`);

  const usersSnap = await db.collection('users').get();
  // Recipients: opted-in (default true), with a usable primary email. Include verified secondary too.
  const recipients = [];
  usersSnap.forEach(doc => {
    const u = doc.data();
    if (u.emailPreferences?.resultsNotifications === false) return;
    if (!u.email) return;
    const addrs = [u.email];
    if (u.secondaryEmail && u.secondaryEmailVerified) addrs.push(u.secondaryEmail);
    recipients.push({ teamName: u.teamName || 'there', addrs });
  });

  console.log(`Recipients: ${recipients.length} users`);
  recipients.forEach(r => console.log(`  ${r.teamName} — ${r.addrs.join(', ')}`));

  if (!EXECUTE) { console.log('\n[DRY RUN] No emails sent. Re-run with --execute to send.'); return; }

  const graph = getGraphClient();
  let sent = 0, failed = 0;
  for (const r of recipients) {
    const subject = 'Prix Six: sorry your British Grand Prix results email was late';
    const html = buildHtml(r.teamName);
    for (const addr of r.addrs) {
      const emailGuid = guid();
      try {
        await graph.api(`/users/${SENDER_EMAIL}/sendMail`).post({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: addr } }] } });
        await db.collection('email_logs').add({ to: addr, subject, html, pin: 'N/A', status: 'sent', timestamp: admin.firestore.Timestamp.now(), emailGuid, teamName: r.teamName, type: 'late_results_apology' });
        console.log(`  sent → ${addr} (${r.teamName})`);
        sent++;
      } catch (e) {
        await db.collection('email_logs').add({ to: addr, subject, html, pin: 'N/A', status: 'failed', timestamp: admin.firestore.Timestamp.now(), emailGuid, teamName: r.teamName, type: 'late_results_apology', error: e.message });
        console.error(`  FAILED → ${addr}: ${e.message}`);
        failed++;
      }
    }
  }
  console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
