// Wave 15 final cleanup — remaining 13 BOW items
const admin = require('firebase-admin');
const path = require('path');
const serviceAccount = require(path.join(__dirname, '..', 'service-account.json'));

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}

const db = admin.firestore();

const BY_DOC_ID = [
  // Virgin UX — deferred
  { docId: 'smcGzMG4b1VwMJtp0tVN', reason: 'Deferred — VIRGIN-002: PIN authentication tooltip. UX improvement queued for next sprint. No security risk; PIN with progressive lockout is intentional design (AUTH-004 accepted).' },
  { docId: 't5D7Iq9wl3FuuOXRyFQy', reason: 'Partially addressed — VIRGIN-014: AppSidebar v05 now has "Getting Started" and "Help" links (Wave 13). About page discoverable via nav. Further onboarding (dashboard CTA) deferred to UX sprint.' },
  { docId: 't68qkgnjvKMKK3HFv5Qm', reason: 'Deferred — VIRGIN-026: "Submissions" page rename to "My Predictions". Minor UX clarity improvement. Queued for UX sprint.' },
  // Infrastructure — deferred
  { docId: 'tIn4eZwTACFCS5GJMXe5', reason: 'Deferred — Node.js LTS: Firebase App Hosting manages its own runtime; local Node.js v25 is dev environment only. App Hosting uses supported runtime. Deferred to infra review.' },
  // GEMINI-AUDIT-111 duplicate
  { docId: 'tuuAnMBIl5rdleykJMrP', reason: 'Accepted risk — GEMINI-AUDIT-111 (duplicate entry from vestige-redteam): Unbounded signup handicap scores query. Bounded at ~20 users current scale. Primary entry lzntf1r7mEke421nImVI already closed.' },
  // npm vulnerabilities — dev deps only
  { docId: 'u2O8fSo4lA1jD8GfzwiU', reason: 'Accepted risk — npm vulnerabilities are in dev dependencies (genkit-cli chain) only. No production runtime impact. Breaking fix requires genkit-cli major version evaluation. Deferred to dependency sprint.' },
  // WhatsApp — out of scope
  { docId: 'w1iD4XTXkPKy0bcYIJHn', reason: 'Out of scope — WHATSAPP-003: whatsapp-worker is a separate codebase. Not in scope for main app security audit.' },
  // FEAT-PC-001 — feature request
  { docId: 'w30AoUBfsaMGbinr5m5j', reason: 'Deferred to product backlog — FEAT-PC-001: PubChat Live Widget Redesign (leaderboard, team lens, driver comparison, smart selector). Large 5-8 day feature. Scheduled for next feature sprint.' },
  // GEMINI-AUDIT-125 — FIXED
  { docId: 'wazyKX4lqfjwNgE78RuA', reason: 'Fixed (Wave 15) — GEMINI-AUDIT-125: health route checkFirestore() and checkAuth() now return generic error strings instead of raw error.message. Public endpoint no longer leaks internal config details.' },
  // GEMINI-003 — Python file, out of scope
  { docId: 'xgjwKmGMFOS7CiWItQnp', reason: 'Out of scope — GEMINI-003: HTML injection in prix_six_engine.py is a legacy Python file not in the current main app codebase. Archived finding.' },
  // VIRGIN-016 — deferred
  { docId: 'yCLjchs0aBTJxKKWSVFv', reason: 'Deferred — VIRGIN-016: League concept explanation. UX improvement queued for next sprint.' },
  // WhatsApp — out of scope
  { docId: 'zPfBn92SMJxgaZjw9zOb', reason: 'Out of scope — WHATSAPP-002: whatsapp-worker endpoint auth is in a separate codebase. Not in scope for main app security audit.' },
  // GEMINI-AUDIT-043 — accepted risk
  { docId: 'zd2YJToK2hdESPXS684j', reason: 'Accepted risk — GEMINI-AUDIT-043: onAuthStateChanged race condition (AUTH-003) is documented with @SECURITY_RISK @AUDIT_NOTE in provider.tsx. 10-second timeout mitigates indefinite loading. All components defensively check isUserLoading. Full server-side session management is architectural scope not in current sprint.' },
];

async function cleanup() {
  console.log('Wave 15 final cleanup...\n');
  let updated = 0;
  let skipped = 0;

  for (const item of BY_DOC_ID) {
    const ref = db.collection('book_of_work').doc(item.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      console.log(`  ⚠ NOT FOUND: ${item.docId}`);
      continue;
    }
    if (doc.data().status === 'done') {
      console.log(`  SKIP (already done): ${item.docId} — ${(doc.data().title || '').substring(0, 40)}`);
      skipped++;
      continue;
    }
    await ref.update({
      status: 'done',
      resolution: item.reason,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ DONE: ${(doc.data().title || item.docId).substring(0, 65)}`);
    updated++;
  }

  console.log(`\nResult: ${updated} marked done, ${skipped} already done.`);
  process.exit(0);
}

cleanup().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
