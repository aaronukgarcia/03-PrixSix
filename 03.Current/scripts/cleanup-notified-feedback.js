/**
 * Deletes resolved feedback entries after the user has been notified.
 *
 * A feedback doc is safe to delete when:
 *   - status === 'resolved'
 *   - resolvedNotifiedAt !== null  (user dismissed the in-app notification)
 *
 * Run with: node scripts/cleanup-notified-feedback.js
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

async function main() {
  const snapshot = await db
    .collection('feedback')
    .where('status', '==', 'resolved')
    .get();

  if (snapshot.empty) {
    console.log('No resolved feedback entries found.');
    return;
  }

  let deleted = 0;
  let waiting = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.resolvedNotifiedAt) {
      console.log(
        `Deleting ${doc.id} — user ${data.userEmail} was notified at ${data.resolvedNotifiedAt.toDate().toISOString()}`
      );
      await db.collection('feedback').doc(doc.id).delete();
      deleted++;
    } else {
      console.log(
        `Keeping  ${doc.id} — user ${data.userEmail} has NOT been notified yet`
      );
      waiting++;
    }
  }

  console.log(`\nDone. Deleted: ${deleted}, Still waiting: ${waiting}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));
