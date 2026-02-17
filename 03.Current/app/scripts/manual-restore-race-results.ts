/**
 * Manual restore of race_results from backup export files
 *
 * Reads the Firestore export files from GCS and recreates race_results documents
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { Storage } from '@google-cloud/storage';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'prix6'
  });
}
const db = admin.firestore();
const storage = new Storage({ projectId: 'prix6', keyFilename: path.resolve(__dirname, '../../service-account.json') });

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const BACKUP_PATH = '2026-02-13T115410';
const BUCKET_NAME = 'prix6-backups';

async function manualRestoreRaceResults() {
  try {
    console.log('\n🔄 MANUAL RESTORE: Race Results from Backup Export');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    const bucket = storage.bucket(BUCKET_NAME);

    // List files in the backup directory
    console.log(`📂 Listing backup files in ${BACKUP_PATH}/...\n`);
    const [files] = await bucket.getFiles({ prefix: `${BACKUP_PATH}/` });

    console.log(`Found ${files.length} files in backup`);

    // Look for race_results export files
    const raceResultsFiles = files.filter(f =>
      f.name.includes('race_results') &&
      (f.name.endsWith('.export_metadata') || f.name.includes('output-'))
    );

    console.log(`\nRace results export files:`);
    raceResultsFiles.forEach(f => {
      const size = f.metadata.size ? (Number(f.metadata.size) / 1024).toFixed(2) : 'unknown';
      console.log(`  - ${f.name} (${size} KB)`);
    });

    if (raceResultsFiles.length === 0) {
      console.log('\n⚠️  No race_results export files found in backup.');
      console.log('    The backup may not contain race_results data,');
      console.log('    or the export format is different than expected.');
      return;
    }

    // Download and parse export metadata
    const metadataFile = raceResultsFiles.find(f => f.name.endsWith('.export_metadata'));
    if (metadataFile) {
      console.log(`\n📄 Reading metadata: ${metadataFile.name}`);
      const [metadata] = await metadataFile.download();
      console.log(metadata.toString().substring(0, 500));
    }

    if (DRY_RUN) {
      console.log('\n⚠️  DRY RUN - File reading successful.');
      console.log('    Run with --live to restore documents.');
      return;
    }

    console.log('\n⚠️  LIVE restore not yet implemented.');
    console.log('    The export files are in Firestore\'s internal format.');
    console.log('    We need to use the official import API.\n');

    console.log('💡 RECOMMENDED APPROACH:');
    console.log('   Use Firebase CLI with service account:\n');
    console.log(`   firebase firestore:import ${BACKUP_PATH} \\`);
    console.log(`     --collection-ids race_results \\`);
    console.log(`     --project prix6`);

  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  }
}

manualRestoreRaceResults()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
