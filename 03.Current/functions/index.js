/**
 * Prix Six Cloud Functions — Backup & Recovery
 *
 * dailyBackup   — 02:00 UTC daily: Firestore export + Auth JSON to GCS
 * runRecoveryTest — 04:00 UTC Sundays: Smoke test via import into recovery project
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { Firestore: FirestoreClient } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");

initializeApp();

// ── Configuration ──────────────────────────────────────────────
const MAIN_PROJECT = "prix6-prod";
const RECOVERY_PROJECT = "prix6-recovery-test";
const BUCKET = "prix6-backups";
const REGION = "europe-west2";
const STATUS_COLLECTION = "backup_status";
const STATUS_DOC = "latest";

// ── Shared helpers ─────────────────────────────────────────────

function generateCorrelationId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

function todayFolder() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const suffix = d.getUTCDay() === 0 ? "-SUNDAY" : "";
  return `${yyyy}-${mm}-${dd}${suffix}`;
}

async function writeStatus(db, fields) {
  await db
    .collection(STATUS_COLLECTION)
    .doc(STATUS_DOC)
    .set({ ...fields, updatedAt: Timestamp.now() }, { merge: true });
}

// ── dailyBackup ────────────────────────────────────────────────
exports.dailyBackup = onSchedule(
  {
    schedule: "0 2 * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540, // 9 minutes
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    const correlationId = generateCorrelationId("bkp");
    const folder = todayFolder();
    const gcsPrefix = `gs://${BUCKET}/${folder}`;

    try {
      // ── 1. Firestore managed export ──────────────────────────
      const firestoreClient = new FirestoreClient({ projectId: MAIN_PROJECT });
      const [exportOp] = await firestoreClient.exportDocuments({
        name: firestoreClient.databasePath(MAIN_PROJECT, "(default)"),
        outputUriPrefix: `${gcsPrefix}/firestore`,
        collectionIds: [], // all collections
      });

      // Wait for the export operation to complete
      await exportOp.promise();

      // ── 2. Auth export (JSON) ────────────────────────────────
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

      // ── 3. Write success status ──────────────────────────────
      await writeStatus(db, {
        lastBackupTimestamp: Timestamp.now(),
        lastBackupStatus: "SUCCESS",
        lastBackupPath: gcsPrefix,
        lastBackupError: null,
        backupCorrelationId: correlationId,
      });

      // ── 4. Emit structured heartbeat log ─────────────────────
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "BACKUP_HEARTBEAT",
          correlationId,
          backupPath: gcsPrefix,
          usersExported: allUsers.length,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error("Backup failed:", err);

      await writeStatus(db, {
        lastBackupTimestamp: Timestamp.now(),
        lastBackupStatus: "FAILED",
        lastBackupPath: null,
        lastBackupError: err.message || String(err),
        backupCorrelationId: correlationId,
      });

      // Still emit heartbeat with failure so Dead Man's Switch doesn't also fire
      console.log(
        JSON.stringify({
          severity: "ERROR",
          message: "BACKUP_HEARTBEAT",
          correlationId,
          status: "FAILED",
          error: err.message || String(err),
          timestamp: new Date().toISOString(),
        })
      );

      throw err; // re-throw so Cloud Functions marks invocation as failed
    }
  }
);

// ── runRecoveryTest ────────────────────────────────────────────
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
      // ── 1. Find latest backup path from status doc ───────────
      const statusSnap = await db
        .collection(STATUS_COLLECTION)
        .doc(STATUS_DOC)
        .get();

      if (!statusSnap.exists || !statusSnap.data().lastBackupPath) {
        throw new Error("No backup path found in backup_status/latest");
      }

      const backupPath = statusSnap.data().lastBackupPath;
      const firestoreExportPath = `${backupPath}/firestore`;

      // ── 2. Import into recovery project ──────────────────────
      const recoveryClient = new FirestoreClient({
        projectId: RECOVERY_PROJECT,
      });

      const [importOp] = await recoveryClient.importDocuments({
        name: recoveryClient.databasePath(RECOVERY_PROJECT, "(default)"),
        inputUriPrefix: firestoreExportPath,
        collectionIds: [], // all collections
      });

      await importOp.promise();

      // ── 3. Smoke test: verify key documents exist ────────────
      const recoveryDb = new FirestoreClient({ projectId: RECOVERY_PROJECT });

      // Check system_status/heartbeat exists
      const heartbeatDoc = await recoveryDb
        .collection("system_status")
        .doc("heartbeat")
        .get();

      // Check users collection has documents
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

      // ── 4. Clean up: delete all data in recovery project ─────
      await deleteAllCollections(recoveryDb);

      // ── 5. Write success status ──────────────────────────────
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

// ── Cleanup helper ─────────────────────────────────────────────
async function deleteAllCollections(firestoreClient) {
  try {
    const collections = await firestoreClient.listCollections();
    for (const collRef of collections) {
      await deleteCollection(firestoreClient, collRef);
    }
  } catch (err) {
    // Log but don't fail the smoke test over cleanup
    console.warn("Cleanup warning:", err.message);
  }
}

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
