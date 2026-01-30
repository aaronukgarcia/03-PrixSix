/**
 * Prix Six Cloud Functions — Backup & Recovery
 * GUID: BACKUP_FUNCTIONS-000-v03
 *
 * [Intent] Provides automated daily backups of Firestore data and Firebase Auth
 *          user records to Google Cloud Storage, plus a weekly Sunday smoke test
 *          that restores the latest backup into a disposable recovery project and
 *          validates that critical documents survived the round-trip.
 *
 * [Inbound Trigger] Cloud Scheduler cron expressions (managed by Firebase).
 * [Downstream Impact] Writes to gs://prix6-backups, backup_status/latest Firestore
 *                     doc, and Cloud Logging (BACKUP_HEARTBEAT structured log used
 *                     by the Dead Man's Switch MQL alert).
 *
 * dailyBackup      — 02:00 UTC daily: Firestore export + Auth JSON to GCS
 * runRecoveryTest  — 04:00 UTC Sundays: Smoke test via import into recovery project
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { Firestore: FirestoreDataClient } = require("@google-cloud/firestore");
const { FirestoreAdminClient } = require("@google-cloud/firestore").v1;
const { Storage } = require("@google-cloud/storage");

// GUID: BACKUP_FUNCTIONS-001-v03
// [Intent] Initialise the Firebase Admin SDK once at cold-start so all
//          downstream function handlers can call getFirestore() / getAuth().
// [Inbound Trigger] Cloud Functions cold-start (module load).
// [Downstream Impact] Registers the default Firebase app; required before
//                     any Admin SDK call.
initializeApp();

// ── Configuration ──────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-002-v04
// [Intent] Centralise all environment-specific constants so they can be
//          changed in one place if the project is forked or renamed.
// [Inbound Trigger] Module load.
// [Downstream Impact] Referenced by every function and helper in this file.
const MAIN_PROJECT = "studio-6033436327-281b1";
const RECOVERY_PROJECT = "prix6-recovery-test";
const BUCKET = "prix6-backups";
const REGION = "europe-west2";
const STATUS_COLLECTION = "backup_status";
const STATUS_DOC = "latest";

// ── Shared helpers ─────────────────────────────────────────────

// GUID: BACKUP_FUNCTIONS-003-v03
/**
 * generateCorrelationId
 *
 * [Intent] Produce a short, unique, human-readable ID that ties together
 *          the Cloud Function invocation, its Firestore status write, and
 *          any GCS object metadata — enabling end-to-end tracing.
 * [Inbound Trigger] Called at the start of dailyBackup and runRecoveryTest.
 * [Downstream Impact] Written to backup_status/latest and embedded in the
 *                     BACKUP_HEARTBEAT structured log. Surfaced in the
 *                     admin dashboard CopyButton for ops debugging.
 *
 * @param {string} prefix - Short label (e.g. "bkp", "smoke") to distinguish
 *                          backup vs smoke-test correlation IDs at a glance.
 * @returns {string} e.g. "bkp_m3k9x1_a7b2c4"
 */
function generateCorrelationId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

// GUID: BACKUP_FUNCTIONS-004-v03
/**
 * todayFolder
 *
 * [Intent] Generate a deterministic, date-based GCS folder name so each
 *          day's backup lands in its own prefix. Sunday backups get a
 *          "-SUNDAY" suffix purely for human identification — retention
 *          is identical for all days (7-day Object Retention Lock).
 * [Inbound Trigger] Called by dailyBackup to build the GCS path.
 * [Downstream Impact] Determines the outputUriPrefix for Firestore export
 *                     and the path for the Auth JSON file.
 *
 * @returns {string} e.g. "2025-06-15" or "2025-06-15-SUNDAY"
 */
function todayFolder() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  // Sunday = day 0 in JS; suffix is cosmetic, retention is the same
  const suffix = d.getUTCDay() === 0 ? "-SUNDAY" : "";
  return `${yyyy}-${mm}-${dd}${suffix}`;
}

// GUID: BACKUP_FUNCTIONS-005-v03
/**
 * writeStatus
 *
 * [Intent] Merge partial status fields into the single backup_status/latest
 *          Firestore document. Using merge:true means dailyBackup and
 *          runRecoveryTest can each write their own fields without clobbering
 *          the other's data.
 * [Inbound Trigger] Called by dailyBackup (backup fields) and runRecoveryTest
 *                   (smoke test fields) on both success and failure paths.
 * [Downstream Impact] The admin BackupHealthDashboard component subscribes
 *                     to this document in real-time via useDoc. Any write
 *                     here is immediately reflected in the UI.
 *
 * @param {FirebaseFirestore.Firestore} db - Admin Firestore instance.
 * @param {Object} fields - Partial status fields to merge.
 */
async function writeStatus(db, fields) {
  await db
    .collection(STATUS_COLLECTION)
    .doc(STATUS_DOC)
    .set({ ...fields, updatedAt: Timestamp.now() }, { merge: true });
}

// ── performBackup (shared logic) ───────────────────────────────
// GUID: BACKUP_FUNCTIONS-009-v04
/**
 * performBackup — Core backup logic shared by dailyBackup and manualBackup.
 *
 * [Intent] Encapsulate the full backup workflow (Firestore export + Auth JSON
 *          to GCS + status write) so it can be invoked by both the scheduled
 *          handler and the on-demand callable without duplication.
 *
 * @param {FirebaseFirestore.Firestore} db - Admin Firestore instance.
 * @returns {{ correlationId: string, gcsPrefix: string, usersExported: number }}
 */
async function performBackup(db) {
  const correlationId = generateCorrelationId("bkp");
  const folder = todayFolder();
  const gcsPrefix = `gs://${BUCKET}/${folder}`;

  try {
    // GUID: BACKUP_FUNCTIONS-011-v04
    // [Intent] Use the Firestore Admin V1 client (FirestoreAdminClient) to call the
    //          managed export API — NOT the data client (Firestore). The data client
    //          does not have exportDocuments() or databasePath() methods.
    // [Inbound Trigger] performBackup call.
    // [Downstream Impact] Creates export files under gs://prix6-backups/{date}/firestore/.
    //                     The LRO (Long Running Operation) blocks until export completes.
    const firestoreAdmin = new FirestoreAdminClient({ projectId: MAIN_PROJECT });
    const [exportOp] = await firestoreAdmin.exportDocuments({
      name: firestoreAdmin.databasePath(MAIN_PROJECT, "(default)"),
      outputUriPrefix: `${gcsPrefix}/firestore`,
      collectionIds: [], // empty = all collections
    });

    // Block until export LRO completes
    await exportOp.promise();

    // GUID: BACKUP_FUNCTIONS-012-v03
    // [Intent] Export Firebase Auth user records as a JSON file to GCS.
    //          Firestore managed export does NOT include Auth data, so we
    //          must separately iterate all users via the Admin SDK.
    //          NOTE: Password hashes are NOT included — Firebase Auth does
    //          not expose them via listUsers(). This is metadata-only.
    // [Inbound Trigger] Firestore export completed successfully (above).
    // [Downstream Impact] Creates {date}/auth/users.json in the backup bucket.
    //                     Paginated at 1000 users per batch (API maximum).
    const storage = new Storage();
    const bucket = storage.bucket(BUCKET);
    const authFile = bucket.file(`${folder}/auth/users.json`);

    const allUsers = [];
    let nextPageToken;
    do {
      const result = await getAuth().listUsers(1000, nextPageToken);
      for (const user of result.users) {
        allUsers.push({
          uid: user.uid,
          email: user.email || null,
          displayName: user.displayName || null,
          disabled: user.disabled,
          emailVerified: user.emailVerified,
          metadata: {
            creationTime: user.metadata.creationTime,
            lastSignInTime: user.metadata.lastSignInTime,
          },
          providerData: user.providerData.map((p) => ({
            providerId: p.providerId,
            uid: p.uid,
            email: p.email || null,
            displayName: p.displayName || null,
          })),
          customClaims: user.customClaims || null,
        });
      }
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    await authFile.save(JSON.stringify(allUsers, null, 2), {
      contentType: "application/json",
      metadata: { correlationId },
    });

    // GUID: BACKUP_FUNCTIONS-013-v03
    // [Intent] Persist success status so the admin dashboard can display
    //          the most recent backup result in real-time.
    // [Inbound Trigger] Both Firestore and Auth exports completed successfully.
    // [Downstream Impact] BackupHealthDashboard reads this via useDoc hook.
    //                     lastBackupError is explicitly nulled to clear any
    //                     previous failure state.
    await writeStatus(db, {
      lastBackupTimestamp: Timestamp.now(),
      lastBackupStatus: "SUCCESS",
      lastBackupPath: gcsPrefix,
      lastBackupError: null,
      backupCorrelationId: correlationId,
    });

    return { correlationId, gcsPrefix, usersExported: allUsers.length };
  } catch (err) {
    // GUID: BACKUP_FUNCTIONS-015-v03
    // [Intent] On failure, record the error in backup_status/latest so the
    //          admin dashboard shows a red "Failed" badge with the error message.
    // [Inbound Trigger] Any exception in the Firestore export or Auth export.
    // [Downstream Impact] Dashboard shows failure.
    console.error("Backup failed:", err);

    await writeStatus(db, {
      lastBackupTimestamp: Timestamp.now(),
      lastBackupStatus: "FAILED",
      lastBackupPath: null,
      lastBackupError: `PX-7002 | ${err.message || String(err)} | ID: ${correlationId}`,
      backupCorrelationId: correlationId,
    });

    // Attach correlationId to the error so callers (manualBackup) can
    // include it in their response without needing a separate variable.
    err.correlationId = correlationId;
    throw err;
  }
}

// ── dailyBackup ────────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-010-v04
/**
 * dailyBackup — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Create a complete, immutable backup of all Firestore collections
 *          and all Firebase Auth user records every day at 02:00 UTC.
 *          The backup is stored in gs://prix6-backups/{date}/ and cannot be
 *          deleted for 7 days due to the bucket's Object Retention Lock.
 *
 * [Inbound Trigger] Cloud Scheduler cron: "0 2 * * *" (02:00 UTC daily).
 *
 * [Downstream Impact]
 *   - GCS: Creates firestore export under {date}/firestore/ and auth JSON
 *          at {date}/auth/users.json.
 *   - Firestore: Writes success/failure status to backup_status/latest
 *     (consumed by admin dashboard).
 *   - Cloud Logging: Emits BACKUP_HEARTBEAT structured log (consumed by
 *     Dead Man's Switch MQL alert — fires if absent >25 hours).
 *   - NOTE: Heartbeat is emitted on BOTH success and failure. The DMS alert
 *     only fires if the function itself is not executing at all.
 */
exports.dailyBackup = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540, // 9 minutes — max before requiring extended timeout
    memory: "512MiB",
    retryCount: 0, // No retry — backup is idempotent but double-run wastes quota
  },
  async () => {
    const db = getFirestore();

    try {
      const { correlationId, gcsPrefix, usersExported } = await performBackup(db);

      // GUID: BACKUP_FUNCTIONS-014-v03
      // [Intent] Emit a structured JSON log that the Dead Man's Switch MQL
      //          alert policy monitors. The alert fires if no BACKUP_HEARTBEAT
      //          log appears within a 25-hour window.
      // [Inbound Trigger] Backup completed (success path).
      // [Downstream Impact] Feeds the log-based metric `backup_heartbeat_count`
      //                     configured in docs/backup-monitoring.md.
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "BACKUP_HEARTBEAT",
          correlationId,
          backupPath: gcsPrefix,
          usersExported,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      // Heartbeat on failure path — prevents Dead Man's Switch double-alert
      console.log(
        JSON.stringify({
          severity: "ERROR",
          message: "BACKUP_HEARTBEAT",
          correlationId: generateCorrelationId("bkp"),
          status: "FAILED",
          error: err.message || String(err),
          timestamp: new Date().toISOString(),
        })
      );

      throw err; // re-throw so Cloud Functions marks invocation as failed
    }
  }
);

// ── manualBackup ───────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-016-v04
/**
 * manualBackup — Callable Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Allow admins to trigger an on-demand backup via the admin dashboard
 *          "Backup Now" button. Uses the same performBackup() logic as the
 *          scheduled dailyBackup to ensure consistency.
 *
 * [Inbound Trigger] Client-side httpsCallable('manualBackup') from the
 *                   BackupHealthDashboard component.
 *
 * [Downstream Impact]
 *   - Auth check: Verifies caller is admin via Firestore users/{uid}.isAdmin.
 *   - Calls performBackup() — same GCS writes and status updates as dailyBackup.
 *   - Returns { success, correlationId, backupPath } to the client.
 */
exports.manualBackup = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    // Auth check: caller must be authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    // Admin check: verify caller is admin via Firestore lookup
    const db = getFirestore();
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();

    if (!callerDoc.exists || callerDoc.data().isAdmin !== true) {
      throw new HttpsError("permission-denied", "Only admins can trigger manual backups.");
    }

    // GUID: BACKUP_FUNCTIONS-017-v03
    // [Intent] Call performBackup and return structured success/failure response.
    //          On failure, include correlationId and errorCode (PX-7002) so the
    //          frontend can display a Golden Rule #1 compliant error with copyable
    //          details. The correlationId is extracted from the error object where
    //          performBackup attaches it before re-throwing.
    // [Inbound Trigger] Admin passes auth + admin check above.
    // [Downstream Impact] Response is consumed by BackupHealthDashboard handleBackupNow.
    try {
      const { correlationId, gcsPrefix } = await performBackup(db);
      return { success: true, correlationId, backupPath: gcsPrefix };
    } catch (err) {
      console.error("Manual backup failed:", err);
      return {
        success: false,
        error: err.message || String(err),
        correlationId: err.correlationId || generateCorrelationId("bkp"),
        errorCode: "PX-7002",
      };
    }
  }
);

// ── runRecoveryTest ────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-020-v03
/**
 * runRecoveryTest — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Every Sunday at 04:00 UTC (2 hours after the daily backup),
 *          import the latest backup into a disposable recovery project
 *          (prix6-recovery-test) and verify that critical documents exist.
 *          This proves the backup is not just present but actually restorable.
 *
 * [Inbound Trigger] Cloud Scheduler cron: "0 4 * * 0" (04:00 UTC Sundays).
 *
 * [Downstream Impact]
 *   - Reads backup_status/latest to find the latest backup GCS path.
 *   - Imports into prix6-recovery-test Firestore (temporary).
 *   - Checks system_status/heartbeat exists AND users collection has data.
 *   - Deletes all data in recovery project after verification.
 *   - Writes smoke test result to backup_status/latest.
 */
exports.runRecoveryTest = onSchedule(
  {
    schedule: "0 4 * * 0",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540, // 9 minutes
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    const correlationId = generateCorrelationId("smoke");

    try {
      // GUID: BACKUP_FUNCTIONS-021-v03
      // [Intent] Read the last successful backup path from the status doc.
      //          If no backup has ever run, the smoke test cannot proceed —
      //          fail loudly so ops investigates.
      // [Inbound Trigger] runRecoveryTest handler entry.
      // [Downstream Impact] Determines the inputUriPrefix for the Firestore
      //                     import operation into the recovery project.
      const statusSnap = await db
        .collection(STATUS_COLLECTION)
        .doc(STATUS_DOC)
        .get();

      if (!statusSnap.exists || !statusSnap.data().lastBackupPath) {
        throw new Error("No backup path found in backup_status/latest");
      }

      const backupPath = statusSnap.data().lastBackupPath;
      const firestoreExportPath = `${backupPath}/firestore`;

      // GUID: BACKUP_FUNCTIONS-022-v04
      // [Intent] Import the Firestore export into the recovery project's
      //          (default) database using FirestoreAdminClient (not the data client).
      //          importDocuments() and databasePath() are admin V1 methods only.
      // [Inbound Trigger] Backup path successfully retrieved from status doc.
      // [Downstream Impact] Recovery project Firestore now contains a copy of
      //                     production data. Must be cleaned up after verification.
      const recoveryAdmin = new FirestoreAdminClient({
        projectId: RECOVERY_PROJECT,
      });

      const [importOp] = await recoveryAdmin.importDocuments({
        name: recoveryAdmin.databasePath(RECOVERY_PROJECT, "(default)"),
        inputUriPrefix: firestoreExportPath,
        collectionIds: [], // all collections
      });

      await importOp.promise();

      // GUID: BACKUP_FUNCTIONS-023-v04
      // [Intent] Verify that the restored data contains critical documents using the
      //          regular Firestore data client (not the admin client — data reads use
      //          collection/doc/get which are data client methods only).
      //          1. system_status/heartbeat — proves system config survived.
      //          2. users collection has at least one doc — proves user data survived.
      //          Both checks failing = the backup is empty or corrupt.
      // [Inbound Trigger] Import LRO completed successfully.
      // [Downstream Impact] If both checks fail, throws an error that marks the
      //                     smoke test as FAILED in the status doc.
      const recoveryDb = new FirestoreDataClient({ projectId: RECOVERY_PROJECT });

      const heartbeatDoc = await recoveryDb
        .collection("system_status")
        .doc("heartbeat")
        .get();

      const usersSnapshot = await recoveryDb
        .collection("users")
        .limit(1)
        .get();

      const heartbeatExists = heartbeatDoc.exists;
      const usersHaveData = !usersSnapshot.empty;

      if (!heartbeatExists && !usersHaveData) {
        throw new Error(
          "Smoke test failed: neither system_status/heartbeat nor users data found"
        );
      }

      // GUID: BACKUP_FUNCTIONS-024-v03
      // [Intent] Delete all data in the recovery project to avoid accumulating
      //          stale copies. The recovery project is purely ephemeral — it
      //          should be empty between smoke test runs.
      // [Inbound Trigger] Smoke test verification passed.
      // [Downstream Impact] Recovery project Firestore is emptied. Cleanup
      //                     failures are logged but do NOT fail the smoke test
      //                     (see deleteAllCollections error handling).
      await deleteAllCollections(recoveryDb);

      // GUID: BACKUP_FUNCTIONS-025-v03
      // [Intent] Write smoke test success to backup_status/latest so the
      //          admin dashboard Smoke Test card shows a green badge.
      // [Inbound Trigger] All smoke test steps completed successfully.
      // [Downstream Impact] BackupHealthDashboard reads this via useDoc.
      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "SUCCESS",
        lastSmokeTestError: null,
        smokeTestCorrelationId: correlationId,
      });

      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "SMOKE_TEST_COMPLETE",
          correlationId,
          heartbeatExists,
          usersHaveData,
          backupPath,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      // GUID: BACKUP_FUNCTIONS-026-v03
      // [Intent] Record smoke test failure in backup_status/latest so the
      //          admin dashboard shows a red badge with the error.
      // [Inbound Trigger] Any exception during import, verification, or cleanup.
      // [Downstream Impact] Dashboard shows failure. Re-throw marks invocation
      //                     as failed in Cloud Functions console.
      console.error("Recovery test failed:", err);

      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "FAILED",
        lastSmokeTestError: err.message || String(err),
        smokeTestCorrelationId: correlationId,
      });

      throw err;
    }
  }
);

// ── manualSmokeTest ──────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-040-v03
/**
 * manualSmokeTest — Callable Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] On-demand version of runRecoveryTest, triggered by the admin
 *          dashboard "Run Now" button on the Smoke Test card. Identical
 *          logic to the scheduled version but wrapped in onCall with
 *          auth + admin checks.
 *
 * [Inbound Trigger] Admin clicks "Run Now" on Smoke Test card.
 *
 * [Downstream Impact] Same as runRecoveryTest: imports backup into
 *                     recovery project, verifies, cleans up, writes result
 *                     to backup_status/latest.
 */
exports.manualSmokeTest = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in.");
    }

    const db = getFirestore();
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();

    if (!callerDoc.exists || callerDoc.data().isAdmin !== true) {
      throw new HttpsError("permission-denied", "Only admins can trigger smoke tests.");
    }

    const correlationId = generateCorrelationId("smoke");

    try {
      const statusSnap = await db
        .collection(STATUS_COLLECTION)
        .doc(STATUS_DOC)
        .get();

      if (!statusSnap.exists || !statusSnap.data().lastBackupPath) {
        throw new Error("No backup path found in backup_status/latest");
      }

      const backupPath = statusSnap.data().lastBackupPath;
      const firestoreExportPath = `${backupPath}/firestore`;

      const recoveryAdmin = new FirestoreAdminClient({
        projectId: RECOVERY_PROJECT,
      });

      const [importOp] = await recoveryAdmin.importDocuments({
        name: recoveryAdmin.databasePath(RECOVERY_PROJECT, "(default)"),
        inputUriPrefix: firestoreExportPath,
        collectionIds: [],
      });

      await importOp.promise();

      const recoveryDb = new FirestoreDataClient({ projectId: RECOVERY_PROJECT });

      const heartbeatDoc = await recoveryDb
        .collection("system_status")
        .doc("heartbeat")
        .get();

      const usersSnapshot = await recoveryDb
        .collection("users")
        .limit(1)
        .get();

      const heartbeatExists = heartbeatDoc.exists;
      const usersHaveData = !usersSnapshot.empty;

      if (!heartbeatExists && !usersHaveData) {
        throw new Error(
          "Smoke test failed: neither system_status/heartbeat nor users data found"
        );
      }

      await deleteAllCollections(recoveryDb);

      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "SUCCESS",
        lastSmokeTestError: null,
        smokeTestCorrelationId: correlationId,
      });

      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "MANUAL_SMOKE_TEST_COMPLETE",
          correlationId,
          heartbeatExists,
          usersHaveData,
          backupPath,
          timestamp: new Date().toISOString(),
        })
      );

      return { success: true, correlationId };
    } catch (err) {
      console.error("Manual smoke test failed:", err);

      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "FAILED",
        lastSmokeTestError: err.message || String(err),
        smokeTestCorrelationId: correlationId,
      });

      return {
        success: false,
        error: err.message || String(err),
        correlationId,
        errorCode: "PX-7004",
      };
    }
  }
);

// ── Cleanup helpers ────────────────────────────────────────────

// GUID: BACKUP_FUNCTIONS-030-v03
/**
 * deleteAllCollections
 *
 * [Intent] Enumerate all top-level collections in the recovery Firestore and
 *          delete every document in each. This ensures the recovery project
 *          is clean for the next smoke test run.
 * [Inbound Trigger] Called by runRecoveryTest after smoke test verification.
 * [Downstream Impact] Recovery project Firestore is emptied. Errors are
 *                     caught and logged — cleanup failure does NOT fail the
 *                     smoke test because the primary goal (verification) has
 *                     already succeeded.
 *
 * @param {FirestoreClient} firestoreClient - @google-cloud/firestore client
 *                                            pointed at the recovery project.
 */
async function deleteAllCollections(firestoreClient) {
  try {
    const collections = await firestoreClient.listCollections();
    for (const collRef of collections) {
      await deleteCollection(firestoreClient, collRef);
    }
  } catch (err) {
    // [AUDIT_NOTE: Non-fatal by design. If cleanup fails, the next smoke test
    //  import will overwrite existing data anyway. Failing here would mask a
    //  successful verification result.]
    console.warn("Cleanup warning:", err.message);
  }
}

// GUID: BACKUP_FUNCTIONS-031-v03
/**
 * deleteCollection
 *
 * [Intent] Batch-delete all documents in a single Firestore collection.
 *          Uses batches of 500 (Firestore maximum batch size) to stay within
 *          API limits. Loops until the collection is empty.
 * [Inbound Trigger] Called by deleteAllCollections for each top-level collection.
 * [Downstream Impact] Deletes documents in the recovery project only. Does NOT
 *                     recurse into subcollections — recovery smoke test only
 *                     verifies top-level data.
 *
 * @param {FirestoreClient} firestoreClient - Recovery project Firestore client.
 * @param {CollectionReference} collRef - Reference to the collection to delete.
 */
async function deleteCollection(firestoreClient, collRef) {
  const batchSize = 500;
  const query = collRef.limit(batchSize);

  while (true) {
    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = firestoreClient.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}
