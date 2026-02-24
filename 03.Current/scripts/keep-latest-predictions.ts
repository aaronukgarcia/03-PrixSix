#!/usr/bin/env tsx
/**
 * Delete all predictions except each user's most recent one.
 *
 * GUID: SCRIPT_KEEP_LATEST_PREDICTIONS-000-v02
 * [Intent] For each team/user, keep only their youngest (most recent) prediction and delete all older ones.
 *          Predictions are stored as subcollections: users/{userId}/predictions/{predictionId}
 * [Inbound Trigger] Manual execution to clean up old predictions.
 * [Downstream Impact] Removes historical predictions, keeping only the latest entry per user.
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize Firebase Admin
const serviceAccountPath = join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

interface Prediction {
  id: string;
  userId: string;
  raceId: string;
  submittedAt: admin.firestore.Timestamp;
  [key: string]: any;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Keep Only Latest Predictions Per User');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Fetch all users
    console.log('📥 Fetching all users...');
    const usersSnapshot = await db.collection('users').get();

    if (usersSnapshot.empty) {
      console.log('   ℹ️  No users found.\n');
      process.exit(0);
    }

    console.log(`   Found ${usersSnapshot.size} users\n`);

    let totalUsers = 0;
    let totalDeleted = 0;
    let totalKept = 0;
    let usersWithPredictions = 0;

    // Process each user
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      totalUsers++;

      // Fetch all predictions for this user (subcollection)
      const predictionsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('predictions')
        .get();

      if (predictionsSnapshot.empty) {
        continue; // User has no predictions
      }

      usersWithPredictions++;

      // Collect predictions with metadata
      const predictions: Prediction[] = [];
      predictionsSnapshot.forEach((predDoc) => {
        const data = predDoc.data();
        predictions.push({
          id: predDoc.id,
          userId,
          raceId: data.raceId || 'unknown',
          submittedAt: data.submittedAt,
          ...data
        });
      });

      // Sort by submittedAt descending (newest first)
      predictions.sort((a, b) => {
        const timeA = a.submittedAt?.toMillis() || 0;
        const timeB = b.submittedAt?.toMillis() || 0;
        return timeB - timeA;
      });

      // Keep the first one (most recent), delete the rest
      const mostRecent = predictions[0];
      const toDelete = predictions.slice(1);

      if (toDelete.length > 0) {
        console.log(`   User ${userId.substring(0, 8)}... (${predictions.length} predictions):`);
        console.log(`      ✓ KEEPING: ${mostRecent.raceId} (${mostRecent.submittedAt.toDate().toISOString()})`);

        // Delete older predictions
        const batch = db.batch();
        toDelete.forEach((pred) => {
          console.log(`      ✗ DELETING: ${pred.raceId} (${pred.submittedAt.toDate().toISOString()})`);
          const predRef = db
            .collection('users')
            .doc(userId)
            .collection('predictions')
            .doc(pred.id);
          batch.delete(predRef);
          totalDeleted++;
        });

        await batch.commit();
        totalKept++;
      } else {
        // User only has one prediction
        console.log(`   User ${userId.substring(0, 8)}...: 1 prediction (keeping ${mostRecent.raceId})`);
        totalKept++;
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ COMPLETE');
    console.log(`   - Total users: ${totalUsers}`);
    console.log(`   - Users with predictions: ${usersWithPredictions}`);
    console.log(`   - Predictions kept (1 per user): ${totalKept}`);
    console.log(`   - Predictions deleted: ${totalDeleted}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
