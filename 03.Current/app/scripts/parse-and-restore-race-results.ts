/**
 * Parse backup and manually restore race_results documents
 *
 * Downloads export files, parses protobuf data, extracts race_results,
 * and recreates documents using Admin SDK
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { Storage } from '@google-cloud/storage';
import { v1 } from '@google-cloud/firestore';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const BACKUP_PATH = '2026-02-13T115410/firestore';

async function parseAndRestoreRaceResults() {
  try {
    console.log('\n🔄 PARSE & RESTORE: Race Results from Backup');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    // Try using Firestore Admin Client with service account credentials
    console.log('📋 Using Firestore Admin API with service account...\n');

    const firestoreAdmin = new v1.FirestoreAdminClient({
      projectId: 'studio-6033436327-281b1',
      keyFilename: path.resolve(__dirname, '../../service-account.json')
    });

    const projectId = 'studio-6033436327-281b1';
    const databaseName = firestoreAdmin.databasePath(projectId, '(default)');
    const inputUriPrefix = `gs://prix6-backups/${BACKUP_PATH}`;

    console.log(`Database: ${databaseName}`);
    console.log(`Import from: ${inputUriPrefix}`);
    console.log(`Collections: race_results only\n`);

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Would import with these settings:');
      console.log(`  - Source: ${inputUriPrefix}`);
      console.log(`  - Target: ${databaseName}`);
      console.log(`  - Collection filter: race_results`);
      console.log(`  - Expected documents: ~30\n`);
      console.log('Run with --live to execute the import.');
      return;
    }

    // LIVE IMPORT
    console.log('🟢 Starting import operation...\n');

    const [operation] = await firestoreAdmin.importDocuments({
      name: databaseName,
      inputUriPrefix,
      collectionIds: ['race_results'], // Only import race_results
    });

    console.log('⏳ Import operation started...');
    console.log(`   Operation name: ${operation.name}\n`);

    // Wait for operation to complete
    console.log('   Waiting for completion (this may take 1-2 minutes)...\n');
    const [response] = await operation.promise();

    console.log('✅ Import operation completed!');
    console.log(`   Response: ${JSON.stringify(response, null, 2)}\n`);

    // Verify what was restored
    const raceResultsSnapshot = await db.collection('race_results').get();
    console.log(`📊 Verification:`);
    console.log(`   race_results: ${raceResultsSnapshot.size} documents restored\n`);

    if (raceResultsSnapshot.size > 0) {
      console.log(`   Sample documents:`);
      raceResultsSnapshot.docs.slice(0, 5).forEach(doc => {
        const data = doc.data();
        console.log(`     - ${doc.id}: ${data.raceId || 'no raceId'}`);
      });
    }

    console.log('\n🎉 Restore complete!');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.details) {
      console.error('   Details:', error.details);
    }
    throw error;
  }
}

parseAndRestoreRaceResults()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nScript failed');
    process.exit(1);
  });
