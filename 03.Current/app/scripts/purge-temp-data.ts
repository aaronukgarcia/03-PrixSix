// GUID: SCRIPTS_PURGE_TEMP-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Purge temp data (users, predictions, submissions, scores, race_results).
//          PRESERVES protected emails only. For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer to clean test data.
// [Downstream Impact] Bulk deletion of non-protected users and related data. Now blocked on production.
//
// Run:
//   $env:GOOGLE_APPLICATION_CREDENTIALS = ".\service-account.json"
//   npx ts-node --project tsconfig.scripts.json scripts/purge-temp-data.ts

import * as admin from 'firebase-admin';
import * as path from 'path';
import { runSafetyChecks } from './_safety-checks';

const PROTECTED_EMAILS = [
  'aaron@garcia.ltd',
  'aaron.garcia@hotmail.co.uk',
];

const BATCH_SIZE = 500; // Firestore max batch size

// Initialize Firebase Admin
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  console.error('Run: $env:GOOGLE_APPLICATION_CREDENTIALS = ".\\service-account.json"');
  process.exit(1);
}

const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function deleteCollection(collectionRef: admin.firestore.CollectionReference, batchSize: number = BATCH_SIZE) {
  const query = collectionRef.limit(batchSize);
  let deleted = 0;

  while (true) {
    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < batchSize) break;
  }
  return deleted;
}

async function purge() {
  // GUID: SCRIPTS_PURGE_TEMP-001-v02
  // [Intent] Safety checks - prevent production execution and require user confirmation.
  // [Inbound Trigger] First action before any database operations.
  // [Downstream Impact] Exits with error if production detected or user cancels.
  await runSafetyChecks(
    `PURGE TEMP DATA: Delete all users except ${PROTECTED_EMAILS.join(', ')} ` +
    `and their predictions, submissions, scores, and race results`
  );

  console.log('=== PURGE TEMP DATA (FAST) ===');
  console.log('Protected emails:', PROTECTED_EMAILS.join(', '));
  console.log('');

  // Step 1: Get all users and identify protected ones
  const usersSnapshot = await db.collection('users').get();
  const protectedUserIds: string[] = [];
  const usersToDelete: admin.firestore.DocumentReference[] = [];

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (PROTECTED_EMAILS.includes(data.email)) {
      protectedUserIds.push(doc.id);
      console.log(`PROTECTED: ${data.email} (${data.teamName || 'no team name'})`);
    } else {
      usersToDelete.push(doc.ref);
    }
  });

  console.log('');
  console.log(`Users to delete: ${usersToDelete.length}`);
  console.log(`Users protected: ${protectedUserIds.length}`);
  console.log('');

  // Step 2: Delete predictions subcollections in parallel batches
  console.log('Deleting predictions subcollections...');
  let predictionsDeleted = 0;

  // Process users in chunks
  const userChunks: admin.firestore.DocumentReference[][] = [];
  for (let i = 0; i < usersToDelete.length; i += 10) {
    userChunks.push(usersToDelete.slice(i, i + 10));
  }

  for (const chunk of userChunks) {
    const results = await Promise.all(
      chunk.map(userRef => deleteCollection(userRef.collection('predictions')))
    );
    predictionsDeleted += results.reduce((a, b) => a + b, 0);
    process.stdout.write(`\r  Deleted ${predictionsDeleted} predictions...`);
  }
  console.log(`\nDeleted ${predictionsDeleted} predictions from user subcollections`);

  // Step 3: Delete users in batches
  console.log('Deleting users...');
  let usersDeleted = 0;
  for (let i = 0; i < usersToDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = usersToDelete.slice(i, i + BATCH_SIZE);
    slice.forEach(ref => batch.delete(ref));
    await batch.commit();
    usersDeleted += slice.length;
    process.stdout.write(`\r  Deleted ${usersDeleted}/${usersToDelete.length} users...`);
  }
  console.log(`\nDeleted ${usersDeleted} users`);

  // Step 4: Delete prediction_submissions not belonging to protected users
  console.log('Deleting prediction_submissions...');
  const submissionsSnapshot = await db.collection('prediction_submissions').get();
  const submissionsToDelete: admin.firestore.DocumentReference[] = [];
  let submissionsKept = 0;

  submissionsSnapshot.forEach(doc => {
    const data = doc.data();
    if (protectedUserIds.includes(data.userId)) {
      submissionsKept++;
    } else {
      submissionsToDelete.push(doc.ref);
    }
  });

  let submissionsDeleted = 0;
  for (let i = 0; i < submissionsToDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = submissionsToDelete.slice(i, i + BATCH_SIZE);
    slice.forEach(ref => batch.delete(ref));
    await batch.commit();
    submissionsDeleted += slice.length;
    process.stdout.write(`\r  Deleted ${submissionsDeleted}/${submissionsToDelete.length} submissions...`);
  }

  console.log(`\nDeleted ${submissionsDeleted} prediction_submissions`);
  console.log(`Kept ${submissionsKept} prediction_submissions (protected users)`);

  // Step 5: Delete ALL race_results (will be re-created by seed)
  console.log('Deleting race_results...');
  const resultsSnapshot = await db.collection('race_results').get();
  let resultsDeleted = 0;
  for (let i = 0; i < resultsSnapshot.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = resultsSnapshot.docs.slice(i, i + BATCH_SIZE);
    slice.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    resultsDeleted += slice.length;
  }
  console.log(`Deleted ${resultsDeleted} race_results`);

  // Step 6: Delete scores not belonging to protected users
  console.log('Deleting scores...');
  const scoresSnapshot = await db.collection('scores').get();
  const scoresToDelete: admin.firestore.DocumentReference[] = [];
  let scoresKept = 0;

  scoresSnapshot.forEach(doc => {
    const data = doc.data();
    const userId = data.oduserId || data.userId;
    if (protectedUserIds.includes(userId)) {
      scoresKept++;
    } else {
      scoresToDelete.push(doc.ref);
    }
  });

  let scoresDeleted = 0;
  for (let i = 0; i < scoresToDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = scoresToDelete.slice(i, i + BATCH_SIZE);
    slice.forEach(ref => batch.delete(ref));
    await batch.commit();
    scoresDeleted += slice.length;
  }
  console.log(`Deleted ${scoresDeleted} scores, kept ${scoresKept}`);

  console.log('');
  console.log('=== PURGE COMPLETE ===');
}

purge()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
