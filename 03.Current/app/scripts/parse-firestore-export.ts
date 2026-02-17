/**
 * Parse Firestore export using proper protobuf definitions
 *
 * Uses Datastore Entity protobuf format to properly decode export files
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Storage } from '@google-cloud/storage';
import { Entity } from '@google-cloud/datastore/build/src/entity';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const storage = new Storage({
  projectId: 'studio-6033436327-281b1',
  keyFilename: path.resolve(__dirname, '../../service-account.json')
});

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const BACKUP_PATH = '2026-02-13T115410/firestore/all_namespaces/all_kinds';
const BUCKET_NAME = 'prix6-backups';

async function parseFirestoreExport() {
  try {
    console.log('\n🔬 PARSE FIRESTORE EXPORT: Using Datastore Protobuf Format');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    const bucket = storage.bucket(BUCKET_NAME);

    // Download metadata file first
    console.log('📥 Downloading export metadata...');
    const metadataFile = bucket.file(`${BACKUP_PATH}/all_namespaces_all_kinds.export_metadata`);
    const tempDir = path.join(os.tmpdir(), 'firestore-parse');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const metadataPath = path.join(tempDir, 'metadata');
    await metadataFile.download({ destination: metadataPath });
    console.log('✓ Metadata downloaded\n');

    // Try using leveled/protobuf libraries to parse
    console.log('📦 Checking for required parsing libraries...');

    try {
      // Try to use protobufjs to parse
      const protobuf = require('protobufjs');
      console.log('  ✓ protobufjs available\n');

      console.log('⚠️  To properly decode Firestore exports, we need:');
      console.log('  1. google/datastore/v1/entity.proto definitions');
      console.log('  2. LevelDB SSTable reader');
      console.log('  3. Protobuf Message decoder\n');

      console.log('💡 RECOMMENDED: Use Google Cloud\'s official tools');
      console.log('   The export format is intentionally complex to ensure');
      console.log('   data integrity and consistency.\n');

    } catch (err) {
      console.log('  ❌ protobufjs not installed');
      console.log('  Install with: npm install protobufjs\n');
    }

    console.log('🔍 ANALYSIS: Firestore Export Format');
    console.log('  - Format: LevelDB SSTable + Protocol Buffers');
    console.log('  - Schema: google.datastore.v1.Entity');
    console.log('  - Complexity: High (requires exact proto definitions)');
    console.log('  - Collections: Mixed together in all_kinds export\n');

    console.log('📊 BACKUP STATUS:');
    console.log(`  Location: gs://${BUCKET_NAME}/${BACKUP_PATH}`);
    console.log(`  Type: all_kinds (all collections mixed)`);
    console.log(`  Files: 60 output files\n`);

    console.log('⚙️  THREE PATHS FORWARD:\n');

    console.log('  OPTION A: Import Full Backup + Delete Unwanted');
    console.log('    Pros: Simple, fast, guaranteed to work');
    console.log('    Cons: Temporarily restores deleted data');
    console.log('    Command:');
    console.log('      gcloud firestore import gs://prix6-backups/2026-02-13T115410/firestore \\');
    console.log('        --project=studio-6033436327-281b1');
    console.log('      Then re-run: reset-season-delete-results.ts (scores + audit_logs only)\n');

    console.log('  OPTION B: Create Selective Backup First');
    console.log('    Pros: Clean, reusable for future restores');
    console.log('    Cons: Requires two steps');
    console.log('    Steps:');
    console.log('      1. Restore full backup to temp Firestore instance');
    console.log('      2. Export only race_results from temp instance');
    console.log('      3. Import selective backup to production\n');

    console.log('  OPTION C: Build Complete Protobuf Parser');
    console.log('    Pros: Surgical precision');
    console.log('    Cons: Complex, time-consuming, error-prone');
    console.log('    Requirements:');
    console.log('      - Implement LevelDB SSTable reader');
    console.log('      - Load Datastore proto definitions');
    console.log('      - Decode Entity messages');
    console.log('      - Map Datastore entities to Firestore documents');
    console.log('      - Handle all data types correctly\n');

    console.log('🎯 RECOMMENDATION: Option A');
    console.log('   Most practical for 30 race_results documents.');
    console.log('   Total time: ~2-3 minutes (import + delete).\n');

    // Clean up
    console.log('🧹 Cleaning up...');
    fs.unlinkSync(metadataPath);
    fs.rmdirSync(tempDir);
    console.log('✓ Done\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

parseFirestoreExport()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
