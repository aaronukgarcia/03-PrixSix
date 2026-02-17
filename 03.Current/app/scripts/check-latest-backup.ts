/**
 * Check latest backup status from Firestore
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkLatestBackup() {
  try {
    const backupStatusDoc = await db.collection('backup_status').doc('latest').get();

    if (!backupStatusDoc.exists) {
      console.log('No backup status found in Firestore');
      return;
    }

    const data = backupStatusDoc.data();
    console.log('\n=== Latest Backup Status ===\n');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

checkLatestBackup()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
