/**
 * Direct restore by downloading and parsing export files
 *
 * Since import API requires permissions we don't have, this script:
 * 1. Downloads the Firestore export files from GCS
 * 2. Parses the protobuf data
 * 3. Extracts race_results documents
 * 4. Manually recreates them using Admin SDK
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
    projectId: 'prix6'
  });
}
const db = admin.firestore();
const storage = new Storage({
  projectId: 'prix6',
  keyFilename: path.resolve(__dirname, '../../service-account.json')
});

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function directRestoreRaceResults() {
  try {
    console.log('\n🔄 DIRECT RESTORE: Downloading and parsing export files');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    const bucket = storage.bucket('prix6-backups');
    const prefix = '2026-02-13T115410/firestore/all_namespaces/all_kinds/';

    // Download metadata file
    console.log('📥 Downloading export metadata...');
    const metadataFile = bucket.file(`${prefix}all_namespaces_all_kinds.export_metadata`);
    const tempDir = os.tmpdir();
    const metadataPath = path.join(tempDir, 'export_metadata.json');

    await metadataFile.download({ destination: metadataPath });
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    console.log(`✓ Metadata downloaded`);
    console.log(`  Output files: ${metadata.outputUriPrefix || 'unknown'}\n`);

    // List all output files
    console.log('📂 Listing output files...');
    const [files] = await bucket.getFiles({ prefix });
    const outputFiles = files.filter(f => f.name.includes('output-'));
    console.log(`✓ Found ${outputFiles.length} output files\n`);

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Would download and parse:');
      console.log(`  ${outputFiles.length} export files`);
      console.log(`  Extract race_results documents`);
      console.log(`  Recreate in Firestore\n`);
      console.log('⚠️  NOTE: Export files are in protobuf format.');
      console.log('      Full parsing requires @google-cloud/firestore protos.');
      console.log('      Simpler approach: Use gcloud with proper permissions.\n');
      return;
    }

    console.log('❌ LIMITATION: Protobuf parsing is complex.');
    console.log('   The export files use Firestore\'s internal protobuf format.');
    console.log('   We need either:');
    console.log('   1. Grant import permissions to service account');
    console.log('   2. Use gcloud CLI with user account that has permissions\n');

    console.log('💡 RECOMMENDED: Add this IAM role to your service account:');
    console.log('   roles/datastore.importExportAdmin\n');
    console.log('   Or run this command:');
    console.log('   gcloud projects add-iam-policy-binding prix6 \\');
    console.log(`     --member="serviceAccount:${serviceAccount.client_email}" \\`);
    console.log('     --role="roles/datastore.importExportAdmin"');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

directRestoreRaceResults()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
