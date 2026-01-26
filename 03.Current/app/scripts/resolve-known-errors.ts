import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

// Errors that have been fixed and should be marked resolved
const FIXED_ERROR_PATTERNS = [
  {
    pattern: 'Missing or insufficient permissions: The following request was denied by Firesto',
    reason: 'AttackMonitor disabled - attack_alerts collection no longer queried by non-admins',
    route: '/admin'
  },
  {
    pattern: 'A <Select.Item /> must have a value prop that is not an empty string',
    reason: 'Fixed in commit 1e71c82 - Filter empty group names from WhatsApp selects',
    route: '/admin'
  },
  {
    pattern: 'Login attempt for non-existent user',
    reason: 'Expected behavior - user tried to login with non-existent email',
    route: '/api/auth/login'
  }
];

// Feedback items that have been addressed
const RESOLVED_FEEDBACK = [
  {
    id: 't0olGcWJnoumEA9xiE0d',
    reason: 'Dev page link made more visible in commit 965ed31'
  },
  {
    id: 'l9VKd7azyaRer8Cn6qoB',
    reason: 'Fastest lap text already updated in About page - says "no longer awards bonus points (rule removed in 2025)"'
  }
];

async function resolveKnownErrors() {
  console.log('========================================');
  console.log('RESOLVING KNOWN FIXED ERRORS');
  console.log('========================================\n');

  // Get all unresolved errors
  const errorsSnapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .get();

  let resolvedCount = 0;
  const toResolve: { id: string; reason: string }[] = [];

  errorsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.resolved) return; // Skip already resolved

    const errorMessage = data.error || '';
    const route = data.context?.route || '';

    for (const pattern of FIXED_ERROR_PATTERNS) {
      if (errorMessage.includes(pattern.pattern) &&
          (!pattern.route || route.includes(pattern.route))) {
        toResolve.push({ id: doc.id, reason: pattern.reason });
        break;
      }
    }
  });

  console.log(`Found ${toResolve.length} errors to mark as resolved\n`);

  // Resolve in batches
  const batch = db.batch();
  for (const item of toResolve) {
    const ref = db.collection('error_logs').doc(item.id);
    batch.update(ref, {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'claude-code',
      resolutionNote: item.reason
    });
    resolvedCount++;
    console.log(`  ✓ Resolving ${item.id}: ${item.reason.substring(0, 60)}...`);
  }

  if (resolvedCount > 0) {
    await batch.commit();
    console.log(`\n✅ Resolved ${resolvedCount} error logs`);
  } else {
    console.log('No errors to resolve');
  }

  // Update feedback
  console.log('\n========================================');
  console.log('UPDATING FEEDBACK STATUS');
  console.log('========================================\n');

  for (const fb of RESOLVED_FEEDBACK) {
    try {
      await db.collection('feedback').doc(fb.id).update({
        status: 'resolved',
        resolutionNote: fb.reason,
        resolvedAt: new Date().toISOString()
      });
      console.log(`  ✓ Resolved feedback ${fb.id}: ${fb.reason.substring(0, 50)}...`);
    } catch (err) {
      console.log(`  ✗ Failed to resolve ${fb.id}: ${err}`);
    }
  }

  console.log('\n✅ Done!');
}

resolveKnownErrors().catch(console.error);
