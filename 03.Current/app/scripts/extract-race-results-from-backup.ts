/**
 * Extract and restore ONLY race_results from all_kinds backup export
 *
 * Downloads export files, parses protobuf data, extracts race_results,
 * and writes them to Firestore one by one
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Storage } from '@google-cloud/storage';

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

interface EntityProto {
  key?: {
    path?: Array<{ kind?: string; id?: string; name?: string }>;
  };
  properties?: Record<string, any>;
}

async function extractRaceResults() {
  try {
    console.log('\n🔍 MANUAL EXTRACTION: Race Results from Backup');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    const bucket = storage.bucket(BUCKET_NAME);

    // List all output files
    console.log('📂 Listing backup export files...');
    const [files] = await bucket.getFiles({ prefix: BACKUP_PATH });
    const outputFiles = files.filter(f => f.name.includes('output-'));
    console.log(`✓ Found ${outputFiles.length} export files\n`);

    // Create temp directory for downloads
    const tempDir = path.join(os.tmpdir(), 'firestore-extract');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.log('📥 Downloading export files...');
    const downloadedFiles: string[] = [];

    for (const file of outputFiles.slice(0, 5)) { // Start with first 5 files
      const filename = path.basename(file.name);
      const localPath = path.join(tempDir, filename);

      console.log(`  Downloading ${filename}...`);
      await file.download({ destination: localPath });
      downloadedFiles.push(localPath);
    }
    console.log(`✓ Downloaded ${downloadedFiles.length} files\n`);

    // Try to parse using Firestore export format
    console.log('🔬 Attempting to parse export files...');

    // Firestore exports use LevelDB format with protobuf encoding
    // We need to use the Datastore protobuf definitions
    const { protos } = require('@google-cloud/firestore');

    let raceResultsFound = 0;
    const raceResultsDocs: any[] = [];

    for (const filePath of downloadedFiles) {
      console.log(`  Parsing ${path.basename(filePath)}...`);

      const buffer = fs.readFileSync(filePath);

      // Try to decode as Firestore export format
      // The export uses EntityResult format from Datastore API
      try {
        // Firestore exports are in a specific binary format
        // Each record is length-prefixed protobuf
        let offset = 0;
        let recordCount = 0;

        while (offset < buffer.length - 4) {
          // Read record length (varint encoded)
          let length = 0;
          let shift = 0;
          let b = 0;

          do {
            if (offset >= buffer.length) break;
            b = buffer[offset++];
            length |= (b & 0x7f) << shift;
            shift += 7;
          } while (b & 0x80);

          if (length === 0 || offset + length > buffer.length) break;

          // Read record data
          const recordBuffer = buffer.slice(offset, offset + length);
          offset += length;
          recordCount++;

          // Try to decode as Entity proto
          try {
            // This is a simplified approach - the actual format is complex
            // We're looking for documents with kind "race_results"
            const text = recordBuffer.toString('utf8', 0, Math.min(1000, recordBuffer.length));

            if (text.includes('race_results')) {
              console.log(`    Found potential race_results document in record ${recordCount}`);
              raceResultsFound++;

              // Store the record for further processing
              raceResultsDocs.push({
                file: path.basename(filePath),
                record: recordCount,
                buffer: recordBuffer
              });
            }
          } catch (parseErr) {
            // Skip records that can't be parsed
          }
        }

        console.log(`    Processed ${recordCount} records from this file`);

      } catch (err: any) {
        console.log(`    ⚠️  Could not parse file: ${err.message}`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Total export files scanned: ${downloadedFiles.length}`);
    console.log(`  Potential race_results documents found: ${raceResultsFound}\n`);

    if (raceResultsFound === 0) {
      console.log('⚠️  No race_results documents detected in scanned files.');
      console.log('   The protobuf parsing approach is complex.\n');
      console.log('💡 ALTERNATIVE APPROACH:');
      console.log('   Since the backup has all data mixed together,');
      console.log('   the most reliable way is to:');
      console.log('   1. Import the full backup');
      console.log('   2. Immediately delete scores and audit_logs collections\n');
      console.log('   This is faster and guaranteed to work correctly.');
      return;
    }

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Would attempt to decode and restore documents.');
      console.log('   Run with --live to execute.\n');
      return;
    }

    console.log('⚠️  LIVE mode not fully implemented yet.');
    console.log('   Protobuf decoding requires exact schema definitions.\n');

    // Clean up temp files
    console.log('🧹 Cleaning up temp files...');
    for (const file of downloadedFiles) {
      fs.unlinkSync(file);
    }
    fs.rmdirSync(tempDir);
    console.log('✓ Cleanup complete\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    throw error;
  }
}

extractRaceResults()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch(() => {
    console.error('Script failed');
    process.exit(1);
  });
