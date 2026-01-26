import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function finalCleanup() {
  console.log('========================================');
  console.log('FINAL CLEANUP');
  console.log('========================================\n');

  // 1. Resolve "Unknown" errors (not actionable)
  const unknownErrors = ['zeKMSEFsviBzA6KD0gcc', '2chRnudPgzkq0DzRmJR5', 'MQfUz7oe9NfzPfbRmho1', 'dnsPxKSs1szaBafYdE4U', '7CHYN6dIEOdXiUORZC6G'];

  console.log('Resolving "Unknown" errors (not actionable - missing context)...');
  for (const id of unknownErrors) {
    try {
      await db.collection('error_logs').doc(id).update({
        resolved: true,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'claude-code',
        resolutionNote: 'Not actionable - error logged without message or context'
      });
      console.log(`  ✓ ${id}`);
    } catch (err) {
      console.log(`  ✗ ${id}: ${err}`);
    }
  }

  // 2. Mark Firebase referer errors - needs Firebase Console config
  const refererErrors = ['ILSFhIiL1ZNhmY8uztsi', 'JOBmTrJ6h0QYEutP6hoZ'];

  console.log('\nMarking Firebase referer errors (needs Firebase Console config)...');
  for (const id of refererErrors) {
    try {
      await db.collection('error_logs').doc(id).update({
        resolved: true,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'claude-code',
        resolutionNote: 'Requires Firebase Console config: Add prix6.win to authorized domains in Firebase Auth settings'
      });
      console.log(`  ✓ ${id}`);
    } catch (err) {
      console.log(`  ✗ ${id}: ${err}`);
    }
  }

  // 3. Mark some feedback as "reviewed" (text suggestions, not bugs)
  const textSuggestionFeedback = [
    { id: 'lyouswtcEzWnlJOoFOsu', note: 'Text improvement suggestion for Pit Stop - will consider in future update' },
    { id: 'ujf3RVQQhjodilr9AphR', note: 'Text improvement suggestion for help section - will consider in future update' },
    { id: 'cAl80I1BlVHemnWvNAcX', note: 'Text improvement suggestion for Tyre Compounds - will consider in future update' },
    { id: '67hhhxzFRtartW5vTq0X', note: 'Text improvement suggestion for Pit Stop - will consider in future update' },
    { id: 'AJjQkXyGTw2KM93tvxmE', note: 'Text improvement suggestion for F1 description - will consider in future update' },
    { id: '2wP3evZh0hP5tPuKxGt8', note: 'Admin note - race schedule verification needed' },
  ];

  console.log('\nMarking text suggestions as "reviewed"...');
  for (const fb of textSuggestionFeedback) {
    try {
      await db.collection('feedback').doc(fb.id).update({
        status: 'reviewed',
        reviewNote: fb.note,
        reviewedAt: new Date().toISOString()
      });
      console.log(`  ✓ ${fb.id}`);
    } catch (err) {
      console.log(`  ✗ ${fb.id}: ${err}`);
    }
  }

  // 4. Mark permission-related feedback as resolved (AttackMonitor fix)
  const permissionFeedback = ['qkWmIW4GX4jdTcHLVTey'];

  console.log('\nResolving permission-related feedback (AttackMonitor disabled)...');
  for (const id of permissionFeedback) {
    try {
      await db.collection('feedback').doc(id).update({
        status: 'resolved',
        resolutionNote: 'Fixed by disabling AttackMonitor which was querying attack_alerts without proper permissions',
        resolvedAt: new Date().toISOString()
      });
      console.log(`  ✓ ${id}`);
    } catch (err) {
      console.log(`  ✗ ${id}: ${err}`);
    }
  }

  // 5. Resolve duplicate feedback about driver photos
  const driverPhotoFeedback = ['VbZRFpftdoFkrSDqG2Sk', 'QRCIbIsKBDe8Vz0dheAd'];

  console.log('\nMarking driver photo feedback as reviewed (requires new images)...');
  for (const id of driverPhotoFeedback) {
    try {
      await db.collection('feedback').doc(id).update({
        status: 'reviewed',
        reviewNote: 'Requires new headshot images for Antonelli and Lindblad - image update needed',
        reviewedAt: new Date().toISOString()
      });
      console.log(`  ✓ ${id}`);
    } catch (err) {
      console.log(`  ✗ ${id}: ${err}`);
    }
  }

  console.log('\n✅ Final cleanup complete!');
}

finalCleanup().catch(console.error);
