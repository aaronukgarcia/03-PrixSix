/**
 * Fix driver casing in protected user submissions
 * Converts capitalized driver names to lowercase
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

async function fixDriverCasing() {
  console.log('=== FIX DRIVER CASING ===\n');

  // Get all prediction_submissions not from seeded users
  const submissions = await db.collection('prediction_submissions').get();

  let fixed = 0;
  let skipped = 0;

  for (const doc of submissions.docs) {
    const data = doc.data();

    // Skip seeded team data (already correct)
    if (data.userId?.startsWith('team_')) {
      skipped++;
      continue;
    }

    // Check if predictions need fixing
    if (!data.predictions) continue;

    const updatedPredictions: Record<string, string> = {};
    let needsUpdate = false;

    ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].forEach(pos => {
      const driver = data.predictions[pos];
      if (driver) {
        const lowerDriver = driver.toLowerCase();
        updatedPredictions[pos] = lowerDriver;
        if (driver !== lowerDriver) {
          needsUpdate = true;
        }
      }
    });

    if (needsUpdate) {
      await doc.ref.update({ predictions: updatedPredictions });
      console.log(`Fixed: ${doc.id} (${data.teamName})`);
      fixed++;
    }
  }

  console.log(`\n✓ Fixed ${fixed} documents`);
  console.log(`  Skipped ${skipped} seeded documents (already correct)`);
}

fixDriverCasing()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
