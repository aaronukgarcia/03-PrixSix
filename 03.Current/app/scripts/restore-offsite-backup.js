// GUID: SCRIPT_RESTORE_OFFSITE-000-v02
// @UPDATE(v3.25.0): drill outcome is now recorded to backup_status/latest
//          (lastOffsiteDrill* fields) so the admin Offsite Mirror card can show when the
//          restore path was last PROVEN, not just when a blob was last written (Aaron ask
//          2026-08-02). Best-effort — a Firestore write failure never masks the drill result.
// [Intent] GR#12 restore drill for FEAT-BACKUP-OFFSITE-001. Proves the offsite chain end-to-end
//          the way the disaster scenario would run it — WITHOUT touching anything Google:
//            1. key   <- Azure Key Vault  prixsix-secrets-vault/prix6-backup-encryption-key
//            2. blob  <- Azure container  garcialtdstorage/prix6-offsite-backups (ad-hoc read
//                        SAS minted here via az; the function's stored SAS is write-only by design)
//            3. decrypt AES-256-GCM (blob layout: 12-byte IV || ciphertext || 16-byte GCM tag —
//                        GCM auth-tag verification IS the integrity check; a tampered or truncated
//                        blob throws on final())
//            4. unzip via PowerShell Expand-Archive and report the file count + total bytes.
// [Inbound Trigger] Manual: node scripts/restore-offsite-backup.js [blobName] [outDir]
//          (run from app/ so firebase-admin bare specifiers resolve if extended later; blobName
//          defaults to the newest blob in the container). Quarterly drill + after any change to
//          offsiteBackupMirror, the SAS, or the key.
// [Downstream Impact] Read-only against Azure; writes only to outDir (default
//          E:\tmp\offsite-restore-drill-<date>). Requires az CLI login with rights on
//          garcialtdstorage + prixsix-secrets-vault. Never prints the key or SAS.
'use strict';

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AZ = 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd';
const ACCOUNT = 'garcialtdstorage';
const CONTAINER = 'prix6-offsite-backups';
const VAULT = 'prixsix-secrets-vault';
const KEY_SECRET = 'prix6-backup-encryption-key';

function az(args) {
  // Node >=20 refuses to spawn .cmd files without a shell (CVE-2024-27980 hardening) —
  // build a fully double-quoted command line instead. Args here are CLI flags and blob
  // names (no embedded quotes); reject anything that would break the quoting.
  for (const a of args) if (a.includes('"')) throw new Error(`unsafe az arg: ${a}`);
  const cmd = `"${AZ}" ${args.map((a) => `"${a}"`).join(' ')}`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

(async () => {
  const dateTag = new Date().toISOString().slice(0, 10);
  const outDir = process.argv[3] || `E:\\tmp\\offsite-restore-drill-${dateTag}`;
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Which blob? Default: newest in the container (listing needs account-key auth — the
  //    drill runs as the Azure account owner, unlike the write-only function SAS).
  let blobName = process.argv[2];
  if (!blobName) {
    const listing = JSON.parse(az(['storage', 'blob', 'list', '--account-name', ACCOUNT,
      '--container-name', CONTAINER, '--auth-mode', 'key', '--query', '[].{n:name,t:properties.lastModified}', '-o', 'json']));
    if (!listing.length) throw new Error(`No blobs in ${CONTAINER} — has offsiteBackupMirror run yet?`);
    listing.sort((a, b) => new Date(b.t) - new Date(a.t));
    blobName = listing[0].n;
  }
  console.log(`[drill] blob: ${blobName}`);

  // 2. Key from the Azure ESCROW copy (deliberately not GCP — this is the Google-is-gone path).
  const keyB64 = az(['keyvault', 'secret', 'show', '--vault-name', VAULT, '--name', KEY_SECRET,
    '--query', 'value', '-o', 'tsv']);
  const key = Buffer.from(keyB64.replace(/^\uFEFF/, '').trim(), 'base64');
  if (key.length !== 32) throw new Error(`Key Vault secret decodes to ${key.length} bytes, expected 32`);
  console.log('[drill] key: fetched from Key Vault (32 bytes) — not printed');

  // 3. Download via short-lived read-only SAS (1 hour).
  const expiry = new Date(Date.now() + 3600_000).toISOString().slice(0, 16) + 'Z';
  const sas = az(['storage', 'blob', 'generate-sas', '--account-name', ACCOUNT,
    '--container-name', CONTAINER, '--name', blobName, '--permissions', 'r',
    '--expiry', expiry, '--https-only', '--auth-mode', 'key', '-o', 'tsv']);
  const encPath = path.join(outDir, 'download.zip.enc');
  az(['storage', 'blob', 'download', '--account-name', ACCOUNT, '--container-name', CONTAINER,
    '--name', blobName, '--file', encPath, '--sas-token', sas, '-o', 'none']);
  const encBytes = fs.statSync(encPath).size;
  console.log(`[drill] downloaded: ${encBytes} bytes`);

  // 4. Decrypt. GCM tag verification throws on any tamper/truncation — integrity proof included.
  const buf = fs.readFileSync(encPath);
  if (buf.length < 29) throw new Error('Blob too small to contain IV + tag');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const zip = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const zipPath = path.join(outDir, 'restored.zip');
  fs.writeFileSync(zipPath, zip);
  console.log(`[drill] decrypted: ${zip.length} bytes, GCM tag VERIFIED`);

  // 5. Expand and count.
  const expandDir = path.join(outDir, 'expanded');
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${expandDir}' -Force"`, { stdio: 'inherit' });
  let fileCount = 0; let totalBytes = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { fileCount++; totalBytes += fs.statSync(p).size; }
    }
  };
  walk(expandDir);
  console.log(`[drill] expanded: ${fileCount} files, ${totalBytes} bytes -> ${expandDir}`);
  if (fileCount === 0) throw new Error('DRILL FAILED: archive expanded to zero files');
  await recordDrill({ status: 'PASSED', blob: blobName, files: fileCount, bytes: totalBytes });
  console.log('[drill] RESTORE DRILL PASSED');
})().catch(async (e) => {
  console.error('[drill] RESTORE DRILL FAILED:', e.message);
  await recordDrill({ status: 'FAILED', error: e.message });
  process.exit(1);
});

// Record the drill outcome so the admin Offsite Mirror card shows the last PROVEN restore.
// Best-effort: the drill's verdict is the console output; a status-write failure only warns.
async function recordDrill(result) {
  try {
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getFirestore, Timestamp } = require('firebase-admin/firestore');
    if (!getApps().length) {
      initializeApp({ credential: cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
    }
    await getFirestore().collection('backup_status').doc('latest').set({
      lastOffsiteDrillTimestamp: Timestamp.now(),
      lastOffsiteDrillStatus: result.status,
      lastOffsiteDrillBlob: result.blob ?? null,
      lastOffsiteDrillFiles: result.files ?? null,
      lastOffsiteDrillBytes: result.bytes ?? null,
      lastOffsiteDrillError: result.error ?? null,
    }, { merge: true });
    console.log('[drill] outcome recorded to backup_status/latest');
  } catch (e) {
    console.warn(`[drill] WARNING: could not record outcome to Firestore: ${e.message}`);
  }
}
