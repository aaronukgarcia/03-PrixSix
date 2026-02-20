/**
 * bow-update.js - Book of Work Firestore updater for Claude sub-agents
 *
 * Commands:
 *   checkout <docId> <agent>                        - Mark item inprogress, check it out
 *   complete <docId> <agent> <version> <commitHash> - Mark item completed
 *   already-fixed <docId> <agent> <version>         - Mark completed (was already fixed)
 *   fail <docId> <reason>                           - Return to tbd, log reason
 *   create <json>                                   - Create a new BOW item
 *
 * Usage examples:
 *   node scripts/bow-update.js checkout 138uy8mbrH8FA1SmLkq2 "Bill/Dev1"
 *   node scripts/bow-update.js complete 138uy8mbrH8FA1SmLkq2 "Bill/Dev1" "1.59.0" "abc1234"
 *   node scripts/bow-update.js already-fixed 138uy8mbrH8FA1SmLkq2 "Bill/Dev1" "1.58.23"
 *   node scripts/bow-update.js fail 138uy8mbrH8FA1SmLkq2 "RedTeam: missing auth token validation"
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'studio-6033436327-281b1';
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(__dirname, '..', 'service-account.json');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID,
  });
}

const db = admin.firestore();

async function main() {
  const [,, command, docId, ...rest] = process.argv;

  if (!command) {
    console.error('Usage: node bow-update.js <command> [args...]');
    process.exit(1);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  switch (command) {
    case 'checkout': {
      const agent = rest[0];
      if (!docId || !agent) { console.error('checkout requires <docId> <agent>'); process.exit(1); }
      await db.collection('book_of_work').doc(docId).update({
        status: 'in_progress',
        checkedOutTo: agent,
        checkedOutAt: now,
        updatedAt: now,
      });
      console.log(`CHECKOUT OK: ${docId} -> ${agent}`);
      break;
    }

    case 'complete': {
      const [agent, version, commitHash] = rest;
      if (!docId || !agent || !version) { console.error('complete requires <docId> <agent> <version> [commitHash]'); process.exit(1); }
      await db.collection('book_of_work').doc(docId).update({
        status: 'done',
        checkedOutTo: null,
        completedBy: agent,
        completedAt: now,
        fixVersion: version,
        commitHash: commitHash || null,
        updatedAt: now,
      });
      console.log(`COMPLETE OK: ${docId} fixed by ${agent} in v${version}`);
      break;
    }

    case 'already-fixed': {
      const [agent, version] = rest;
      if (!docId || !agent) { console.error('already-fixed requires <docId> <agent> [version]'); process.exit(1); }
      await db.collection('book_of_work').doc(docId).update({
        status: 'done',
        checkedOutTo: null,
        completedBy: agent,
        completedAt: now,
        fixVersion: version || 'pre-existing',
        resolution: 'already-fixed',
        updatedAt: now,
      });
      console.log(`ALREADY-FIXED OK: ${docId} closed by ${agent}`);
      break;
    }

    case 'fail': {
      const reason = rest.join(' ');
      if (!docId) { console.error('fail requires <docId> [reason]'); process.exit(1); }
      await db.collection('book_of_work').doc(docId).update({
        status: 'tbd',
        checkedOutTo: null,
        lastFailReason: reason || 'RedTeam FAIL',
        lastFailAt: now,
        updatedAt: now,
      });
      console.log(`FAIL OK: ${docId} returned to queue. Reason: ${reason}`);
      break;
    }

    case 'create': {
      const jsonStr = rest.join(' ');
      let item;
      try { item = JSON.parse(jsonStr); } catch (e) { console.error('create: invalid JSON'); process.exit(1); }
      item.status = item.status || 'tbd';
      item.createdAt = now;
      item.updatedAt = now;
      const ref = await db.collection('book_of_work').add(item);
      console.log(`CREATE OK: new item ${ref.id} -> ${item.title || item.guid || 'untitled'}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  process.exit(0);
}

main().catch(err => { console.error('bow-update error:', err.message); process.exit(1); });
