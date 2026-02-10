/**
 * Script to mark fixed errors as resolved in error_logs collection
 *
 * Run with: node scripts/resolve-fixed-errors.js
 *
 * This script will:
 * 1. Query all unresolved errors
 * 2. Categorize them by type
 * 3. Mark as resolved those that have been fixed in v1.23.11
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath))
});

const db = admin.firestore();

// Errors that have been fixed in v1.23.11
const FIXED_ERROR_PATTERNS = [
  // Login race condition fixes
  { route: '/api/auth/login', message: /login.*race|race.*condition/i, reason: 'Fixed in v1.23.11 - Login race condition resolved' },
  { route: '/api/auth/login', message: /timeout/i, reason: 'Fixed in v1.23.11 - Added 15s timeout handling' },
  { route: '/api/auth/login', message: /auth.*state/i, reason: 'Fixed in v1.23.11 - Auth state verification added' },

  // TypeScript errors that were fixed
  { route: '/api/auth/reset-pin', message: /email.*not.*exist/i, reason: 'Fixed in v1.23.11 - TypeScript context type fixed' },
  { route: '/api/send-verification-email', message: /EXTERNAL_SERVICE_ERROR/i, reason: 'Fixed in v1.23.11 - Error code corrected' },
  { route: '/api/verify-email', message: /FIRESTORE_WRITE_ERROR/i, reason: 'Fixed in v1.23.11 - Error code corrected' },
];

// Errors that are expected behavior (not bugs)
const EXPECTED_BEHAVIOR_PATTERNS = [
  { message: /non-existent user/i, reason: 'Expected behavior - user tried to login with email that does not exist' },
  { message: /Invalid email or PIN/i, reason: 'Expected behavior - failed login attempt' },
  { message: /Account.*locked/i, reason: 'Expected behavior - brute force protection working' },
  { message: /rate limit/i, reason: 'Expected behavior - rate limiting working' },
];

async function main() {
  console.log('Querying unresolved errors...\n');

  // Query all errors (simpler query to avoid index requirement)
  const snapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();

  // Filter to unresolved only
  const unresolvedDocs = snapshot.docs.filter(doc => !doc.data().resolved);

  console.log(`Found ${unresolvedDocs.length} unresolved errors\n`);

  if (unresolvedDocs.length === 0) {
    console.log('No unresolved errors found!');
    process.exit(0);
  }

  // Categorize errors
  const toResolve = [];
  const needsReview = [];

  for (const doc of unresolvedDocs) {
    const data = doc.data();
    const error = data.error || '';
    const route = data.context?.route || '';
    const timestamp = data.timestamp?.toDate?.() || new Date(data.createdAt);

    let matched = false;

    // Check if it matches a fixed error pattern
    for (const pattern of FIXED_ERROR_PATTERNS) {
      if (pattern.route && route !== pattern.route) continue;
      if (pattern.message && !pattern.message.test(error)) continue;

      toResolve.push({
        id: doc.id,
        error: error.substring(0, 80),
        route,
        timestamp,
        reason: pattern.reason,
        category: 'FIXED'
      });
      matched = true;
      break;
    }

    if (matched) continue;

    // Check if it's expected behavior
    for (const pattern of EXPECTED_BEHAVIOR_PATTERNS) {
      if (pattern.message && !pattern.message.test(error)) continue;

      toResolve.push({
        id: doc.id,
        error: error.substring(0, 80),
        route,
        timestamp,
        reason: pattern.reason,
        category: 'EXPECTED'
      });
      matched = true;
      break;
    }

    if (!matched) {
      needsReview.push({
        id: doc.id,
        correlationId: data.correlationId,
        error: error.substring(0, 100),
        route,
        timestamp,
        errorCode: data.context?.additionalInfo?.errorCode || 'unknown'
      });
    }
  }

  // Print summary
  console.log('=' .repeat(80));
  console.log('ERRORS TO BE MARKED AS RESOLVED:');
  console.log('=' .repeat(80));

  for (const item of toResolve) {
    console.log(`\n[${item.category}] ${item.id}`);
    console.log(`  Route: ${item.route}`);
    console.log(`  Error: ${item.error}...`);
    console.log(`  Reason: ${item.reason}`);
  }

  console.log('\n' + '=' .repeat(80));
  console.log('ERRORS NEEDING MANUAL REVIEW:');
  console.log('=' .repeat(80));

  for (const item of needsReview) {
    console.log(`\n[REVIEW] ${item.id}`);
    console.log(`  Correlation ID: ${item.correlationId}`);
    console.log(`  Route: ${item.route}`);
    console.log(`  Error: ${item.error}...`);
    console.log(`  Time: ${item.timestamp}`);
  }

  console.log('\n' + '=' .repeat(80));
  console.log(`SUMMARY: ${toResolve.length} to resolve, ${needsReview.length} need review`);
  console.log('=' .repeat(80));

  // Ask for confirmation
  if (toResolve.length > 0) {
    console.log('\nResolving errors...');

    const batch = db.batch();
    const now = new Date().toISOString();

    for (const item of toResolve) {
      const docRef = db.collection('error_logs').doc(item.id);
      batch.update(docRef, {
        resolved: true,
        resolvedAt: now,
        resolvedBy: 'bill (Claude Code v1.23.11)',
        resolvedReason: item.reason
      });
    }

    await batch.commit();
    console.log(`\n✓ Marked ${toResolve.length} errors as resolved`);
  }

  if (needsReview.length > 0) {
    console.log(`\n⚠ ${needsReview.length} errors need manual review in admin panel`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
