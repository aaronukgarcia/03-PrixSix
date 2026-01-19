/**
 * Fix missing oduserId in prediction_submissions
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function fixMissingOduserId() {
  console.log('=== FIX MISSING oduserId ===\n');

  const submissions = await db.collection('prediction_submissions').get();

  let fixed = 0;
  let alreadyOk = 0;

  for (const doc of submissions.docs) {
    const data = doc.data();

    // If oduserId is missing but userId exists, copy it
    if (!data.oduserId && data.userId) {
      await doc.ref.update({
        oduserId: data.userId,
        odteamId: data.userId,
      });
      console.log(`Fixed: ${data.teamName} (${data.userId})`);
      fixed++;
    } else {
      alreadyOk++;
    }
  }

  console.log(`\n✓ Fixed ${fixed} documents`);
  console.log(`  Already OK: ${alreadyOk}`);
}

fixMissingOduserId()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
