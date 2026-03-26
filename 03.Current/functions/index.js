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
const crypto = require("crypto");
const ERROR_CODES = require("./error-codes.json");

// GUID: BACKUP_FUNCTIONS-001-v03
// [Intent] Initialise the Firebase Admin SDK once at cold-start so all
//          downstream function handlers can call getFirestore() / getAuth().
// [Inbound Trigger] Cloud Functions cold-start (module load).
// [Downstream Impact] Registers the default Firebase app; required before
//                     any Admin SDK call.
initializeApp();

// ── Configuration ──────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-002-v05
// [Intent] Centralise all environment-specific constants so they can be
//          changed in one place if the project is forked or renamed.
// [Inbound Trigger] Module load.
// [Downstream Impact] Referenced by every function and helper in this file.
// @SECURITY_FIX (Wave 10): Added project isolation guard — throws at cold-start if
//   RECOVERY_PROJECT equals MAIN_PROJECT, preventing accidental import into production.
const MAIN_PROJECT = "studio-6033436327-281b1";
const RECOVERY_PROJECT = "prix6-recovery-test";

// Project isolation guard — must remain at module level so it fires at cold-start
if (RECOVERY_PROJECT === MAIN_PROJECT) {
  throw new Error(
    `SECURITY: RECOVERY_PROJECT must not equal MAIN_PROJECT (${MAIN_PROJECT}). ` +
    "Refusing to start — import operations would target the production database."
  );
}
const BUCKET = "prix6-backups";
const REGION = "europe-west2";
const STATUS_COLLECTION = "backup_status";
const STATUS_DOC = "latest";
const HISTORY_COLLECTION = "backup_history";

// ── Shared helpers ─────────────────────────────────────────────

// GUID: BACKUP_FUNCTIONS-003-v04
// @SECURITY_FIX: Replaced Math.random() with crypto.randomBytes() to prevent predictable token generation (LIB-002).
/**
 * generateCorrelationId
 *
 * [Intent] Produce a short, unique, cryptographically secure human-readable ID that ties together
 *          the Cloud Function invocation, its Firestore status write, and
 *          any GCS object metadata — enabling end-to-end tracing.
 * [Inbound Trigger] Called at the start of dailyBackup and runRecoveryTest.
 * [Downstream Impact] Written to backup_status/latest and embedded in the
 *                     BACKUP_HEARTBEAT structured log. Surfaced in the
 *                     admin dashboard CopyButton for ops debugging.
 *
 * @param {string} prefix - Short label (e.g. "bkp", "smoke") to distinguish
 *                          backup vs smoke-test correlation IDs at a glance.
 * @returns {string} e.g. "bkp_m3k9x1_a7b2c4de"
 */
function generateCorrelationId(prefix) {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
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
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  // Sunday = day 0 in JS; suffix is cosmetic, retention is the same
  const suffix = d.getUTCDay() === 0 ? "-SUNDAY" : "";
  return `${yyyy}-${mm}-${dd}T${HH}${MM}${ss}${suffix}`;
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
 * @param {{ trigger?: string }} [options] - Optional parameters.
 * @param {string} [options.trigger='scheduled'] - What triggered the backup ('scheduled' or 'manual').
 * @returns {{ correlationId: string, gcsPrefix: string, usersExported: number }}
 */
async function performBackup(db, { trigger = "scheduled" } = {}) {
  const correlationId = generateCorrelationId("bkp");
  const startedAt = Timestamp.now();
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

    // GUID: BACKUP_FUNCTIONS-019-v01
    // [Intent] Back up Firebase Storage files (profile photos and other user-uploaded content).
    //          This backs up user-generated content that cannot be regenerated, unlike
    //          application code which is already versioned in Git.
    // [Inbound Trigger] Auth JSON written successfully (above).
    // [Downstream Impact] Copies all files from Storage bucket to backup bucket under
    //                     {date}/storage/ prefix. If Storage bucket doesn't exist or is
    //                     empty, this is a no-op (graceful skip).
    let storageFilesBackedUp = 0;
    let storageBackupSizeBytes = 0;
    try {
      const sourceBucket = storage.bucket(`${MAIN_PROJECT}.appspot.com`);

      // Check if bucket exists before attempting to list files
      const [bucketExists] = await sourceBucket.exists();

      if (bucketExists) {
        // Get all files from Storage (currently just profile-photos/)
        const [storageFiles] = await sourceBucket.getFiles();

        if (storageFiles.length > 0) {
          // Copy each file to backup bucket
          for (const file of storageFiles) {
            const destFile = bucket.file(`${folder}/storage/${file.name}`);
            await file.copy(destFile);
            storageFilesBackedUp++;
            storageBackupSizeBytes += Number(file.metadata.size) || 0;
          }

          console.log(`Backed up ${storageFilesBackedUp} Storage files (${(storageBackupSizeBytes / 1024 / 1024).toFixed(2)} MB)`);
        } else {
          console.log('Firebase Storage is empty - no files to backup');
        }
      } else {
        console.log('Firebase Storage bucket does not exist yet - skipping Storage backup');
      }
    } catch (storageError) {
      // Log but don't fail the entire backup if Storage backup fails
      console.warn('Firebase Storage backup failed (non-critical):', storageError.message);
      // Write error to Firestore for admin visibility
      await db.collection(HISTORY_COLLECTION).doc(`${correlationId}_storage_warning`).set({
        timestamp: Timestamp.now(),
        type: "storage_backup_warning",
        status: "WARNING",
        error: storageError.message,
        correlationId,
        trigger,
      });
    }

    // GUID: BACKUP_FUNCTIONS-018-v03
    // [Intent] Calculate total backup size by listing all GCS objects under the
    //          backup folder prefix and summing their sizes. This lets the admin
    //          dashboard display a human-readable backup size for verification.
    // [Inbound Trigger] Auth JSON and Storage files written successfully (above).
    // [Downstream Impact] lastBackupSizeBytes is included in the status write below.
    const [files] = await bucket.getFiles({ prefix: folder });
    let totalBytes = 0;
    for (const file of files) {
      totalBytes += Number(file.metadata.size) || 0;
    }

    // GUID: BACKUP_FUNCTIONS-013-v04
    // [Intent] Persist success status so the admin dashboard can display
    //          the most recent backup result in real-time.
    // [Inbound Trigger] Firestore, Auth, and Storage exports completed successfully.
    // [Downstream Impact] BackupHealthDashboard reads this via useDoc hook.
    //                     lastBackupError is explicitly nulled to clear any
    //                     previous failure state. Storage stats included for visibility.
    await writeStatus(db, {
      lastBackupTimestamp: Timestamp.now(),
      lastBackupStatus: "SUCCESS",
      lastBackupPath: gcsPrefix,
      lastBackupError: null,
      lastBackupSizeBytes: totalBytes,
      lastBackupStorageFiles: storageFilesBackedUp,
      lastBackupStorageSizeBytes: storageBackupSizeBytes,
      backupCorrelationId: correlationId,
    });

    // GUID: BACKUP_FUNCTIONS-050-v04
    // [Intent] Write a history entry to the backup_history collection so admins
    //          can view all past backups in the admin dashboard, not just the latest.
    // [Inbound Trigger] Backup completed successfully (status written above).
    // [Downstream Impact] BackupHealthDashboard subscribes to backup_history collection
    //                     to display a full backup history table with Storage stats.
    await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
      timestamp: Timestamp.now(),
      type: "backup",
      status: "SUCCESS",
      path: gcsPrefix,
      sizeBytes: totalBytes,
      storageFiles: storageFilesBackedUp,
      storageSizeBytes: storageBackupSizeBytes,
      usersExported: allUsers.length,
      correlationId,
      trigger,
      startedAt,
      completedAt: Timestamp.now(),
    });

    return {
      correlationId,
      gcsPrefix,
      usersExported: allUsers.length,
      storageFilesBackedUp,
      storageBackupSizeBytes,
    };
  } catch (err) {
    // GUID: BACKUP_FUNCTIONS-015-v04
    // [Intent] On failure, record the error in backup_status/latest so the
    //          admin dashboard shows a red "Failed" badge with the error message.
    // [Inbound Trigger] Any exception in the Firestore export or Auth export.
    // [Downstream Impact] Dashboard shows failure.
    // @SECURITY_FIX (Wave 10): Log err.message only (not the full error object) to
    //   prevent leaking stack traces and internal GCS/Firestore paths to Cloud Logging.
    //   The correlationId is included so logs can be correlated with the Firestore status doc.
    console.error(JSON.stringify({
      severity: "ERROR",
      message: "BACKUP_FAILED",
      correlationId,
      error: err.message || String(err),
      timestamp: new Date().toISOString(),
    }));

    await writeStatus(db, {
      lastBackupTimestamp: Timestamp.now(),
      lastBackupStatus: "FAILED",
      lastBackupPath: null,
      lastBackupError: `${ERROR_CODES.BACKUP_EXPORT_FAILED.code} | ${err.message || String(err)} | ID: ${correlationId}`,
      backupCorrelationId: correlationId,
    });

    // GUID: BACKUP_FUNCTIONS-051-v03
    // [Intent] Write a failure history entry so the backup history table shows
    //          failed attempts alongside successful ones for complete audit trail.
    // [Inbound Trigger] Backup failed (error caught above).
    // [Downstream Impact] Visible in admin dashboard backup history table as red badge.
    await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
      timestamp: Timestamp.now(),
      type: "backup",
      status: "FAILED",
      path: null,
      sizeBytes: 0,
      correlationId,
      trigger,
      startedAt,
      completedAt: Timestamp.now(),
      error: err.message || String(err),
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

    // GUID: BACKUP_FUNCTIONS-017-v04
    // [Intent] Call performBackup and return structured success/failure response.
    //          On failure, include correlationId and errorCode (ERROR_CODES.BACKUP_EXPORT_FAILED)
    //          so the frontend can display a Golden Rule #1 compliant error with copyable
    //          details. The correlationId is extracted from the error object where
    //          performBackup attaches it before re-throwing.
    // [Inbound Trigger] Admin passes auth + admin check above.
    // [Downstream Impact] Response is consumed by BackupHealthDashboard handleBackupNow.
    try {
      const { correlationId, gcsPrefix } = await performBackup(db, { trigger: "manual" });
      return { success: true, correlationId, backupPath: gcsPrefix };
    } catch (err) {
      // @SECURITY_FIX (Wave 10): Log err.message only (not full error object).
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "MANUAL_BACKUP_FAILED",
        correlationId: err.correlationId || "unknown",
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: err.message || String(err),
        correlationId: err.correlationId || generateCorrelationId("bkp"),
        errorCode: ERROR_CODES.BACKUP_EXPORT_FAILED.code,
      };
    }
  }
);

// ── listBackupHistory (backfill from GCS) ──────────────────────
// GUID: BACKUP_FUNCTIONS-055-v06
/**
 * listBackupHistory — Callable Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Backfill the backup_history Firestore collection from existing
 *          GCS backup folders. Lists all top-level prefixes in the backup
 *          bucket, sums file sizes per prefix, and writes each to
 *          backup_history if not already present. Returns the full list.
 *          On failure, returns ERROR_CODES.BACKUP_BACKFILL_FAILED error code
 *          with correlation ID and writes a failure record to backup_history.
 *
 * [Inbound Trigger] Admin clicks "Backfill History" button in the admin
 *                   dashboard, or called via script after initial deployment.
 *
 * [Downstream Impact]
 *   - Auth check: Verifies caller is admin via Firestore users/{uid}.isAdmin.
 *   - Reads all objects in gs://prix6-backups/ to discover prefixes.
 *   - Writes to backup_history collection (skip if doc already exists).
 *   - Returns { success, count, entries } or { success: false, error, errorCode, correlationId }.
 */
exports.listBackupHistory = onCall(
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
      throw new HttpsError("permission-denied", "Only admins can list backup history.");
    }

    const correlationId = generateCorrelationId("bfill");

    try {
      const storage = new Storage();
      const bucket = storage.bucket(BUCKET);

      // GUID: BACKUP_FUNCTIONS-056-v03
      // [Intent] List all top-level "folder" prefixes in the backup bucket.
      //          Each prefix represents one backup run (e.g. "2025-06-15T020000/").
      //          Using delimiter '/' and prefix '' to get only top-level folders.
      // [Inbound Trigger] Admin auth check passed above.
      // [Downstream Impact] Each prefix is checked against backup_history and
      //                     written if missing.
      const [, , apiResponse] = await bucket.getFiles({
        prefix: "",
        delimiter: "/",
        autoPaginate: false,
      });

      const prefixes = (apiResponse.prefixes || []).map((p) =>
        p.endsWith("/") ? p.slice(0, -1) : p
      );

      const entries = [];

      // Filter to date-like prefixes only
      const datePrefixes = prefixes.filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p));

      // GUID: BACKUP_FUNCTIONS-057-v01
      // [Intent] Process a single GCS prefix: check if already backfilled,
      //          sum file sizes with paginated listing, parse timestamp, and
      //          write the history entry. Returns the entry object.
      // [Inbound Trigger] Called per-prefix from the batched loop below.
      // [Downstream Impact] Reads from GCS and writes to backup_history.
      async function processPrefix(prefix) {
        // Check if history entry already exists
        const existingDoc = await db
          .collection(HISTORY_COLLECTION)
          .where("path", "==", `gs://${BUCKET}/${prefix}`)
          .limit(1)
          .get();

        if (!existingDoc.empty) {
          return existingDoc.docs[0].data();
        }

        // Sum file sizes with paginated listing to avoid loading
        // all File objects into memory at once (OOM on large exports)
        let totalBytes = 0;
        let nextQuery = { prefix: `${prefix}/`, autoPaginate: false, maxResults: 500 };
        do {
          const [files, query] = await bucket.getFiles(nextQuery);
          for (const file of files) {
            totalBytes += Number(file.metadata.size) || 0;
          }
          nextQuery = query;
        } while (nextQuery);

        // Parse timestamp from folder name (e.g. "2025-06-15T020000")
        const dateStr = prefix.replace("-SUNDAY", "");
        const parsed = dateStr.match(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})$/
        );
        let folderDate;
        if (parsed) {
          folderDate = new Date(
            Date.UTC(
              parseInt(parsed[1]),
              parseInt(parsed[2]) - 1,
              parseInt(parsed[3]),
              parseInt(parsed[4]),
              parseInt(parsed[5]),
              parseInt(parsed[6])
            )
          );
        } else {
          folderDate = new Date(dateStr);
        }

        const docId = `backfill_${prefix.replace(/[^a-zA-Z0-9-]/g, "_")}`;
        const entryTimestamp = Timestamp.fromDate(
          isNaN(folderDate.getTime()) ? new Date() : folderDate
        );
        const entry = {
          timestamp: entryTimestamp,
          type: "backup",
          status: "SUCCESS",
          path: `gs://${BUCKET}/${prefix}`,
          sizeBytes: totalBytes,
          correlationId: docId,
          trigger: "backfill",
          startedAt: entryTimestamp,
          completedAt: entryTimestamp,
        };

        await db.collection(HISTORY_COLLECTION).doc(docId).set(entry);
        return entry;
      }

      // GUID: BACKUP_FUNCTIONS-058-v01
      // [Intent] Process prefixes in parallel batches of 10 to stay well
      //          within the 540s Cloud Functions timeout. A deadline guard
      //          ensures we return a partial result instead of being killed
      //          by Cloud Run mid-flight.
      // [Inbound Trigger] Prefix list from GCS listing above.
      // [Downstream Impact] Writes backfill entries; may return partial
      //                     results if deadline approached. Caller can
      //                     re-invoke to pick up remaining prefixes.
      const BATCH_SIZE = 10;
      const DEADLINE_MS = 480_000; // 480s — stop 60s before the 540s timeout
      const startTime = Date.now();

      for (let i = 0; i < datePrefixes.length; i += BATCH_SIZE) {
        if (Date.now() - startTime > DEADLINE_MS) {
          console.warn(
            `listBackupHistory: deadline approaching, returning partial result ` +
            `(${entries.length}/${datePrefixes.length} prefixes processed)`
          );
          return {
            success: true,
            partial: true,
            count: entries.length,
            total: datePrefixes.length,
            entries,
          };
        }

        const batch = datePrefixes.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(processPrefix));
        entries.push(...results);
      }

      return { success: true, count: entries.length, entries };
    } catch (err) {
      // @SECURITY_FIX (Wave 10): Log err.message only (not full error object).
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "LIST_BACKUP_HISTORY_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));

      // Write failure record to backup_history for audit trail
      await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
        timestamp: Timestamp.now(),
        type: "backfill",
        status: "FAILED",
        path: null,
        sizeBytes: 0,
        correlationId,
        trigger: "backfill",
        startedAt: Timestamp.now(),
        completedAt: Timestamp.now(),
        error: err.message || String(err),
      });

      return {
        success: false,
        error: err.message || String(err),
        errorCode: ERROR_CODES.BACKUP_BACKFILL_FAILED.code,
        correlationId,
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
    const startedAt = Timestamp.now();

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

      // @SECURITY_FIX (Wave 10): Validate backup path before use as GCS import URI.
      // backupPath originates from Firestore (backup_status/latest.lastBackupPath).
      // If tampered, an attacker with write access to that document could redirect
      // the import to an arbitrary GCS path. Validate it starts with the expected
      // bucket prefix to prevent SSRF-style GCS path injection.
      const EXPECTED_PATH_PREFIX = `gs://${BUCKET}/`;
      if (typeof backupPath !== "string" || !backupPath.startsWith(EXPECTED_PATH_PREFIX)) {
        throw new Error(
          `Invalid backup path: expected prefix '${EXPECTED_PATH_PREFIX}', got '${String(backupPath).substring(0, 60)}'`
        );
      }

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

      // GUID: BACKUP_FUNCTIONS-023A-v01
      // [Intent] Verify Auth backup file exists and contains user records.
      //          Auth data is critical for account recovery — if backup exists
      //          but Auth JSON is missing, the backup is incomplete.
      // [Inbound Trigger] Firestore verification passed.
      // [Downstream Impact] Warns if Auth backup missing but doesn't fail smoke test
      //                     (maintains backward compatibility with old backups).
      let authFileExists = false;
      let authUserCount = 0;
      try {
        const storage = new Storage();
        const bucket = storage.bucket(BUCKET);
        const authFilePath = `${backupPath.replace('gs://' + BUCKET + '/', '')}/auth/users.json`;
        const authFile = bucket.file(authFilePath);
        const [exists] = await authFile.exists();

        if (exists) {
          authFileExists = true;
          const [contents] = await authFile.download();
          const authData = JSON.parse(contents.toString());
          authUserCount = Array.isArray(authData) ? authData.length : 0;
          console.log(`Auth backup verified: ${authUserCount} users`);
        } else {
          console.warn('Auth backup file not found (may be old backup format)');
        }
      } catch (authError) {
        console.warn('Auth verification failed (non-critical):', authError.message);
      }

      // GUID: BACKUP_FUNCTIONS-023B-v01
      // [Intent] Verify Storage backup exists and contains files.
      //          Storage files are user-generated content (profile photos) that
      //          cannot be regenerated — critical for complete recovery.
      // [Inbound Trigger] Firestore and Auth verification completed.
      // [Downstream Impact] Warns if Storage backup missing but doesn't fail smoke test
      //                     (Storage backup is new feature, old backups won't have it).
      let storageFileCount = 0;
      let storageTotalBytes = 0;
      try {
        const storage = new Storage();
        const bucket = storage.bucket(BUCKET);
        const storagePrefix = `${backupPath.replace('gs://' + BUCKET + '/', '')}/storage/`;
        const [storageFiles] = await bucket.getFiles({ prefix: storagePrefix });

        storageFileCount = storageFiles.length;
        for (const file of storageFiles) {
          storageTotalBytes += Number(file.metadata.size) || 0;
        }

        if (storageFileCount > 0) {
          console.log(`Storage backup verified: ${storageFileCount} files, ${(storageTotalBytes / 1024 / 1024).toFixed(2)} MB`);
        } else {
          console.log('Storage backup is empty (no files uploaded yet)');
        }
      } catch (storageError) {
        console.warn('Storage verification failed (non-critical):', storageError.message);
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

      // GUID: BACKUP_FUNCTIONS-025-v04
      // [Intent] Write smoke test success to backup_status/latest so the
      //          admin dashboard Smoke Test card shows a green badge.
      //          Includes verification results for Firestore, Auth, and Storage.
      // [Inbound Trigger] All smoke test steps completed successfully.
      // [Downstream Impact] BackupHealthDashboard reads this via useDoc.
      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "SUCCESS",
        lastSmokeTestError: null,
        smokeTestCorrelationId: correlationId,
        lastSmokeTestVerification: {
          heartbeatExists,
          usersHaveData,
          authFileExists,
          authUserCount,
          storageFileCount,
          storageTotalBytes,
        },
      });

      // GUID: BACKUP_FUNCTIONS-060-v03
      // [Intent] Write smoke test history entry so admins can see all past
      //          smoke test runs alongside backups in the history table.
      // [Inbound Trigger] Smoke test completed successfully.
      // [Downstream Impact] Visible in admin dashboard backup history table.
      await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
        timestamp: Timestamp.now(),
        type: "smoke_test",
        status: "SUCCESS",
        path: backupPath,
        sizeBytes: 0,
        correlationId,
        trigger: "scheduled",
        startedAt,
        completedAt: Timestamp.now(),
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
      // @SECURITY_FIX (Wave 10): Log err.message only (not full error object).
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "RECOVERY_TEST_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));

      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "FAILED",
        lastSmokeTestError: err.message || String(err),
        smokeTestCorrelationId: correlationId,
      });

      // GUID: BACKUP_FUNCTIONS-061-v03
      // [Intent] Write smoke test failure history entry for audit trail.
      // [Inbound Trigger] Smoke test failed (error caught above).
      // [Downstream Impact] Visible in admin dashboard history table as red badge.
      await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
        timestamp: Timestamp.now(),
        type: "smoke_test",
        status: "FAILED",
        path: null,
        sizeBytes: 0,
        correlationId,
        trigger: "scheduled",
        startedAt,
        completedAt: Timestamp.now(),
        error: err.message || String(err),
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
    const startedAt = Timestamp.now();

    try {
      const statusSnap = await db
        .collection(STATUS_COLLECTION)
        .doc(STATUS_DOC)
        .get();

      if (!statusSnap.exists || !statusSnap.data().lastBackupPath) {
        throw new Error("No backup path found in backup_status/latest");
      }

      const backupPath = statusSnap.data().lastBackupPath;

      // @SECURITY_FIX (Wave 10): Validate backup path before use as GCS import URI.
      // Matches the same guard in runRecoveryTest — see BACKUP_FUNCTIONS-022-v04 comment.
      const EXPECTED_PATH_PREFIX = `gs://${BUCKET}/`;
      if (typeof backupPath !== "string" || !backupPath.startsWith(EXPECTED_PATH_PREFIX)) {
        throw new Error(
          `Invalid backup path: expected prefix '${EXPECTED_PATH_PREFIX}', got '${String(backupPath).substring(0, 60)}'`
        );
      }

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

      await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
        timestamp: Timestamp.now(),
        type: "smoke_test",
        status: "SUCCESS",
        path: backupPath,
        sizeBytes: 0,
        correlationId,
        trigger: "manual",
        startedAt,
        completedAt: Timestamp.now(),
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
      // @SECURITY_FIX (Wave 10): Log err.message only (not full error object).
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "MANUAL_SMOKE_TEST_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));

      await writeStatus(db, {
        lastSmokeTestTimestamp: Timestamp.now(),
        lastSmokeTestStatus: "FAILED",
        lastSmokeTestError: err.message || String(err),
        smokeTestCorrelationId: correlationId,
      });

      await db.collection(HISTORY_COLLECTION).doc(correlationId).set({
        timestamp: Timestamp.now(),
        type: "smoke_test",
        status: "FAILED",
        path: null,
        sizeBytes: 0,
        correlationId,
        trigger: "manual",
        startedAt,
        completedAt: Timestamp.now(),
        error: err.message || String(err),
      });

      return {
        success: false,
        error: err.message || String(err),
        correlationId,
        errorCode: ERROR_CODES.BACKUP_SMOKE_TEST_FAILED.code,
      };
    }
  }
);

// ── Session expiry ────────────────────────────────────────────
// GUID: SESSION_FUNCTIONS-000-v03
/**
 * expireStaleLogons — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Mark stale Active sessions as 'Session Expired' after 24 hours.
 *          Scans all user_logons documents with sessionStatus == 'Active' and
 *          logonTimestamp older than 24 hours, then batch-updates them.
 *
 * [Inbound Trigger] Cloud Scheduler cron: every 15 minutes.
 *
 * [Downstream Impact]
 *   - Updates user_logons documents from 'Active' to 'Session Expired'.
 *   - Profile page logon history will reflect expired status.
 *   - Handles sessions where the user closed the browser without logging out.
 */
exports.expireStaleLogons = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    retryCount: 0,
  },
  async () => {
    const db = getFirestore();
    const correlationId = generateCorrelationId("exp");

    try {
      const cutoff = Timestamp.fromDate(
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );

      const staleQuery = db
        .collection("user_logons")
        .where("sessionStatus", "==", "Active")
        .where("logonTimestamp", "<", cutoff);

      const snapshot = await staleQuery.get();

      if (snapshot.empty) {
        return;
      }

      // Batch update in groups of 500 (Firestore batch limit)
      const batchSize = 500;
      let processed = 0;

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = snapshot.docs.slice(i, i + batchSize);

        for (const doc of chunk) {
          batch.update(doc.ref, {
            sessionStatus: "Session Expired",
            logoutTimestamp: Timestamp.now(),
          });
        }

        await batch.commit();
        processed += chunk.length;
      }

      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "SESSION_EXPIRY_COMPLETE",
          correlationId,
          expiredCount: processed,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "SESSION_EXPIRY_FAILED",
          correlationId,
          error: err.message || String(err),
          timestamp: new Date().toISOString(),
        })
      );
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

// ── Admin Hot Link Token Cleanup ───────────────────────────────

// GUID: ADMIN_HOTLINK_CLEANUP-001-v03
/**
 * cleanupExpiredAdminTokens
 *
 * [Intent] Hourly cron job to delete expired admin challenge tokens from the
 *          admin_challenges collection. Provides defensive redundancy alongside
 *          Firestore TTL policy (Option C approach). Prevents token accumulation
 *          and ensures tokens older than 10 minutes are purged.
 * [Inbound Trigger] Cloud Scheduler cron: "0 * * * *" (every hour at minute 0).
 * [Downstream Impact] Deletes docs in admin_challenges where expiresAt < now.
 *                     Logs cleanup stats to structured logs for monitoring.
 *                     No user-facing impact — expired tokens are already invalid.
 *
 * Security: Runs server-side via Admin SDK (bypasses Firestore rules).
 * Rate: Hourly to balance cleanup frequency vs Cloud Function invocation costs.
 */
exports.cleanupExpiredAdminTokens = onSchedule(
  {
    schedule: "0 * * * *", // Every hour at minute 0
    timeZone: "UTC",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (event) => {
    const db = getFirestore();
    const correlationId = generateCorrelationId("cleanup");
    const now = Date.now();

    try {
      console.log(`[${correlationId}] Starting admin token cleanup...`);

      // Query for expired tokens
      const expiredTokensRef = db.collection("admin_challenges")
        .where("expiresAt", "<", now);

      const snapshot = await expiredTokensRef.get();

      if (snapshot.empty) {
        console.log(`[${correlationId}] No expired tokens found.`);
        return { deleted: 0, correlationId };
      }

      // Batch delete (max 500 per batch)
      const batch = db.batch();
      let count = 0;

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        count++;
      });

      await batch.commit();

      console.log({
        message: "ADMIN_TOKEN_CLEANUP",
        correlationId,
        deletedCount: count,
        timestamp: new Date().toISOString(),
        severity: "INFO",
      });

      return { deleted: count, correlationId };

    } catch (error) {
      console.error({
        message: "ADMIN_TOKEN_CLEANUP_FAILED",
        correlationId,
        error: error.message,
        timestamp: new Date().toISOString(),
        severity: "ERROR",
      });

      throw error;
    }
  }
);

// ── refreshHotNews ────────────────────────────────────────────
// GUID: BACKUP_FUNCTIONS-071-v01
/**
 * processEmailQueue — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Every 15 minutes, POST to the Next.js cron route
 *          /api/cron/process-email-queue which drains the email_queue
 *          collection by sending pending emails via Microsoft Graph.
 *          All email logic lives in the app — this function is a thin HTTP trigger.
 *
 * [Inbound Trigger] Cloud Scheduler cron: every 15 minutes (0,15,30,45 * * * *) UTC.
 *
 * [Downstream Impact]
 *   - Calls /api/cron/process-email-queue which sends pending emails and
 *     updates email_queue docs (sent/failed) and email_daily_stats.
 *   - Failure is logged but does NOT throw (no retry — prevents email spam).
 *
 * Env vars required in Cloud Function config:
 *   CRON_SECRET — shared secret matching CRON_SECRET in App Hosting secrets
 *   APP_URL     — production URL, defaults to https://prix6.win
 */
exports.processEmailQueue = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 120,
    memory: "256MiB",
    retryCount: 0,
  },
  async () => {
    const correlationId = generateCorrelationId("eq");
    // Strip BOM (U+FEFF) — Secret Manager may prepend it on Windows-created secrets
    const secret = (process.env.CRON_SECRET || '').replace(/^\uFEFF/, '');
    const appUrl = process.env.APP_URL || "https://prix6.win";

    if (!secret) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "PROCESS_EMAIL_QUEUE_MISSING_SECRET",
        correlationId,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    try {
      const resp = await fetch(`${appUrl}/api/cron/process-email-queue`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });

      const body = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error(JSON.stringify({
          severity: "ERROR",
          message: "PROCESS_EMAIL_QUEUE_HTTP_ERROR",
          correlationId,
          status: resp.status,
          body,
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      console.log(JSON.stringify({
        severity: "INFO",
        message: "PROCESS_EMAIL_QUEUE_OK",
        correlationId,
        processed: body.processed ?? 0,
        summary: body.summary ?? {},
        hasMore: body.hasMore ?? false,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "PROCESS_EMAIL_QUEUE_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));
    }
  }
);

// GUID: BACKUP_FUNCTIONS-072-v01
/**
 * syncSessionTimes — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Every day at 05:00 UTC, POST to the Next.js cron route
 *          /api/cron/sync-session-times which queries OpenF1 for upcoming
 *          session start/end times and writes accurate qualifying/sprint/race
 *          times to the race_schedule Firestore collection.
 *          Prevents the pit lane closing at the wrong time due to stale estimates
 *          in the static data.ts schedule (root cause of Chinese GP incident 2026-03-13).
 *
 * [Inbound Trigger] Cloud Scheduler cron: "0 5 * * *" (05:00 UTC daily).
 *
 * [Downstream Impact]
 *   - Updates race_schedule docs (qualifyingTime, sprintTime, raceTime, raceEndTime).
 *   - deadline enforcement in /api/submit-prediction reads from race_schedule via cache.
 *   - scoring cutoff in /api/calculate-scores reads qualifyingTime for the race.
 *   - Failure is logged but does NOT throw (no retry — prevents OpenF1 hammering).
 *
 * Env vars required in Cloud Function config:
 *   CRON_SECRET — shared secret matching CRON_SECRET in App Hosting secrets
 *   APP_URL     — production URL, defaults to https://prix6.win
 */
exports.syncSessionTimes = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    retryCount: 0,
    secrets: ["CRON_SECRET"],
  },
  async () => {
    const correlationId = generateCorrelationId("sst");
    // Strip BOM (U+FEFF) — Secret Manager may prepend it on Windows-created secrets
    const secret = (process.env.CRON_SECRET || '').replace(/^\uFEFF/, '');
    const appUrl = process.env.APP_URL || "https://prix6.win";

    if (!secret) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "SYNC_SESSION_TIMES_MISSING_SECRET",
        correlationId,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    try {
      const resp = await fetch(`${appUrl}/api/cron/sync-session-times`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });

      const body = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error(JSON.stringify({
          severity: "ERROR",
          message: "SYNC_SESSION_TIMES_HTTP_ERROR",
          correlationId,
          status: resp.status,
          body,
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      console.log(JSON.stringify({
        severity: "INFO",
        message: "SYNC_SESSION_TIMES_OK",
        correlationId,
        updated: body.updated ?? 0,
        races: body.races ?? {},
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      // Log but don't rethrow — prevents Cloud Functions retries from hammering OpenF1
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "SYNC_SESSION_TIMES_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));
    }
  }
);

// GUID: BACKUP_FUNCTIONS-070-v02
/**
 * refreshHotNews — Scheduled Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Every hour at the top of the hour, POST to the Next.js cron route
 *          /api/cron/refresh-hot-news which triggers AI generation of the hot
 *          news bulletin using live weather data (Open-Meteo + OpenF1).
 *          All AI logic lives in the app — this function is a thin HTTP trigger.
 *
 * [Inbound Trigger] Cloud Scheduler cron: "0 * * * *" (top of every hour, UTC).
 *
 * [Downstream Impact]
 *   - Calls /api/cron/refresh-hot-news which writes to app-settings/hot-news.
 *   - Dashboard HotNewsFeed component reads that document on next page load.
 *   - Failure is logged but does NOT throw (no retry — prevents billing spikes).
 *
 * Env vars required in Cloud Function config:
 *   CRON_SECRET — shared secret matching CRON_SECRET in App Hosting secrets
 *   APP_URL     — production URL, defaults to https://prix6.win
 */
exports.refreshHotNews = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
    retryCount: 0,
    secrets: ["CRON_SECRET"],
  },
  async () => {
    const correlationId = generateCorrelationId("news");
    // Strip BOM (U+FEFF) — Secret Manager may prepend it on Windows-created secrets
    const secret = (process.env.CRON_SECRET || '').replace(/^\uFEFF/, '');
    const appUrl = process.env.APP_URL || "https://prix6.win";

    if (!secret) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "REFRESH_HOT_NEWS_MISSING_SECRET",
        correlationId,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    try {
      const resp = await fetch(`${appUrl}/api/cron/refresh-hot-news`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });

      const body = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error(JSON.stringify({
          severity: "ERROR",
          message: "REFRESH_HOT_NEWS_HTTP_ERROR",
          correlationId,
          status: resp.status,
          body,
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      console.log(JSON.stringify({
        severity: "INFO",
        message: "REFRESH_HOT_NEWS_OK",
        correlationId,
        refreshCount: body.refreshCount ?? null,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      // Log but don't rethrow — prevents Cloud Functions retries from hammering the AI endpoint
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "REFRESH_HOT_NEWS_FAILED",
        correlationId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));
    }
  }
);

// ── ingestReplaySession ────────────────────────────────────────
// GUID: CLOUD_FUNCTIONS-INGEST-001-v01
/**
 * ingestReplaySession — Callable Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Ingest a full F1 race replay from OpenF1 into Firestore chunks,
 *          replacing the local script `scripts/_ingest-replay-local.js`.
 *          Fetches all 9 OpenF1 endpoints, builds time-aligned frames, and
 *          writes them as chunked Firestore documents for client-side replay.
 *
 * [Inbound Trigger] Client-side callable invocation (any authenticated user).
 *
 * [Downstream Impact]
 *   - Firestore: replay_sessions/{sessionKey} — status tracking
 *   - Firestore: replay_chunks/{sessionKey}_{NNNN} — frame data
 *   - Firestore: replay_meta/{sessionKey} — session metadata + drivers
 */

// ── Helpers (module-level) for ingestReplaySession ─────────────

const OPENF1_BASE = 'https://api.openf1.org/v1';
const INGEST_CHUNK_MINUTES = 10;
const FRAMES_PER_CHUNK = 100;
const FRAME_GROUPING_MS = 250;
const REPLAY_CACHE_VERSION = 2;

const INGEST_ENDPOINT_LABELS = {
  location: 'GPS locations',
  position: 'Race positions',
  car_data: 'Throttle/brake/speed',
  intervals: 'Gap/interval data',
  laps: 'Lap times & sectors',
  stints: 'Tyre stints',
  pit: 'Pit stop data',
  team_radio: 'Team radio messages',
  race_control: 'FIA race control',
  building: 'Building frames',
  writing: 'Writing to Firestore',
};

async function fetchOpenF1(endpoint, sessionKey, extra = '', attempt = 1) {
  const url = `${OPENF1_BASE}/${endpoint}?session_key=${sessionKey}${extra}`;
  const data = await fetch(url, { headers: { Accept: 'application/json' } }).then(r => r.json());
  if (!Array.isArray(data)) {
    if (data?.detail?.includes?.('No results')) return [];
    if ((data?.detail?.includes?.('Rate limit') || data?.error?.includes?.('Too Many')) && attempt <= 5) {
      await new Promise(r => setTimeout(r, attempt * 5000));
      return fetchOpenF1(endpoint, sessionKey, extra, attempt + 1);
    }
    throw new Error(`Bad response from /${endpoint}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

function buildTimeLookup(records, driverField, dateField, valueFn) {
  const byDriver = new Map();
  for (const r of records) {
    const dn = r[driverField]; if (dn == null) continue;
    const ts = new Date(r[dateField]).getTime(); if (isNaN(ts)) continue;
    const list = byDriver.get(dn) ?? [];
    list.push({ ts, val: valueFn(r) });
    byDriver.set(dn, list);
  }
  for (const [, list] of byDriver) list.sort((a, b) => a.ts - b.ts);
  return function(dn, ms) {
    const list = byDriver.get(dn);
    if (!list || !list.length) return null;
    let lo = 0, hi = list.length - 1, result = list[0].val;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].ts <= ms) { result = list[mid].val; lo = mid + 1; } else hi = mid - 1;
    }
    return result;
  };
}

function buildPitCountLookup(pits) {
  const byDriver = new Map();
  for (const r of pits) {
    if (!r.driver_number || !r.date) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push(new Date(r.date).getTime());
    byDriver.set(r.driver_number, list);
  }
  for (const [, l] of byDriver) l.sort((a, b) => a - b);
  return (dn, ms) => {
    const l = byDriver.get(dn);
    if (!l) return 0;
    let c = 0;
    for (const t of l) { if (t <= ms) c++; else break; }
    return c;
  };
}

function buildStintLookup(stints) {
  const byDriver = new Map();
  for (const r of stints) {
    if (!r.driver_number) continue;
    const list = byDriver.get(r.driver_number) ?? [];
    list.push({
      lapStart: r.lap_start ?? 1,
      lapEnd: r.lap_end ?? 999,
      compound: r.compound ?? 'UNKNOWN',
      tyreAgeAtStart: r.tyre_age_at_start ?? 0,
    });
    byDriver.set(r.driver_number, list);
  }
  for (const [, l] of byDriver) l.sort((a, b) => a.lapStart - b.lapStart);
  return (dn, lap) => {
    const l = byDriver.get(dn);
    if (!l) return { compound: 'UNKNOWN', tyreLapAge: 0 };
    for (const s of l) {
      if (lap >= s.lapStart && lap <= s.lapEnd) {
        return { compound: s.compound, tyreLapAge: s.tyreAgeAtStart + (lap - s.lapStart) };
      }
    }
    const last = l[l.length - 1];
    return { compound: last.compound, tyreLapAge: last.tyreAgeAtStart };
  };
}

// ── The callable function ──────────────────────────────────────

exports.ingestReplaySession = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    retryCount: 0,
  },
  async (request) => {
    // Auth check — any authenticated user
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required to ingest replay sessions.");
    }

    const sessionKey = Number(request.data?.sessionKey);
    if (!sessionKey || sessionKey <= 0 || !Number.isFinite(sessionKey)) {
      throw new HttpsError("invalid-argument", "sessionKey must be a positive number.");
    }

    const db = getFirestore();
    const sessionDocRef = db.collection('replay_sessions').doc(String(sessionKey));

    // ── Claim ingest lock via transaction ──
    const lockResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionDocRef);
      if (snap.exists) {
        const status = snap.data()?.firestoreStatus;
        if (status === 'ingesting') return { locked: true, reason: 'Ingest already in progress.' };
        if (status === 'complete') return { locked: true, reason: 'Session already ingested.' };
      }
      tx.set(sessionDocRef, {
        firestoreStatus: 'ingesting',
        firestoreError: null,
        firestoreIngestStartedAt: Timestamp.now(),
      }, { merge: true });
      return { locked: false };
    });

    if (lockResult.locked) {
      return { success: false, message: lockResult.reason };
    }

    // ── Progress ping helper ──
    async function ping(endpoint, count) {
      await sessionDocRef.set({
        firestoreIngestCurrentEndpoint: endpoint,
        firestoreIngestCurrentLabel: INGEST_ENDPOINT_LABELS[endpoint] || endpoint,
        firestoreIngestRecordCount: count ?? null,
        firestoreIngestUpdatedAt: Timestamp.now(),
      }, { merge: true }).catch(() => {});
    }

    // ── Chunked fetch for large endpoints ──
    async function fetchChunked(endpoint, sessionKeyVal, dateStart, dateEnd) {
      const start = new Date(dateStart);
      const end = new Date(dateEnd);
      const all = [];
      let cursor = new Date(start);
      while (cursor < end) {
        const next = new Date(cursor.getTime() + INGEST_CHUNK_MINUTES * 60000);
        const from = cursor.toISOString().replace('.000Z', '').replace('Z', '');
        const to = next.toISOString().replace('.000Z', '').replace('Z', '');
        const chunk = await fetchOpenF1(endpoint, sessionKeyVal,
          `&date%3E=${encodeURIComponent(from)}&date%3C=${encodeURIComponent(to)}`);
        all.push(...chunk);
        await ping(endpoint, all.length);
        cursor = next;
        await new Promise(r => setTimeout(r, 2000));
      }
      return all;
    }

    try {
      // 1. Fetch session meta
      await ping('location', 0);
      const sessions = await fetchOpenF1('sessions', sessionKey);
      const meta = sessions[0];
      if (!meta) throw new Error(`No session found for session_key ${sessionKey}`);
      const dateStart = meta.date_start;
      const dateEnd = meta.date_end;
      const sessionStartMs = new Date(dateStart).getTime();

      // 2. Fetch drivers
      const rawDrivers = await fetchOpenF1('drivers', sessionKey);
      const drivers = rawDrivers.map(d => ({
        driverNumber: d.driver_number,
        driverCode: d.name_acronym ?? '',
        fullName: d.full_name ?? '',
        teamName: d.team_name ?? '',
        teamColour: d.team_colour ? `#${d.team_colour}` : '#888',
      }));

      // 3. Fetch all endpoints with progress pings
      await ping('location', 0);
      const rawLocation = await fetchChunked('location', sessionKey, dateStart, dateEnd);

      await ping('position', 0);
      const rawPosition = await fetchOpenF1('position', sessionKey);
      await new Promise(r => setTimeout(r, 1000));

      await ping('car_data', 0);
      const rawCarData = await fetchChunked('car_data', sessionKey, dateStart, dateEnd);

      await ping('intervals', 0);
      const rawIntervals = await fetchOpenF1('intervals', sessionKey);
      await new Promise(r => setTimeout(r, 1000));

      await ping('laps', 0);
      const rawLaps = await fetchOpenF1('laps', sessionKey);
      await new Promise(r => setTimeout(r, 1000));

      await ping('stints', 0);
      const rawStints = await fetchOpenF1('stints', sessionKey);

      await ping('pit', 0);
      const rawPits = await fetchOpenF1('pit', sessionKey);

      await ping('team_radio', 0);
      const rawRadio = await fetchOpenF1('team_radio', sessionKey);

      await ping('race_control', 0);
      const rawRC = await fetchOpenF1('race_control', sessionKey);

      // 4. Build lookups
      await ping('building', 0);

      const getCarData = buildTimeLookup(rawCarData, 'driver_number', 'date', r => ({
        speed: r.speed ?? null, throttle: r.throttle ?? null,
        brake: r.brake ?? null, gear: r.n_gear ?? null, drs: r.drs ?? null,
      }));
      const getInterval = buildTimeLookup(rawIntervals, 'driver_number', 'date', r => ({
        gapToLeader: r.gap_to_leader != null ? String(r.gap_to_leader) : null,
        intervalToAhead: r.interval != null ? String(r.interval) : null,
      }));
      const getLap = buildTimeLookup(rawLaps, 'driver_number', 'date_start', r => ({
        lastLapTime: r.lap_duration ?? null, currentLap: r.lap_number ?? null,
        s1: r.duration_sector_1 ?? null, s2: r.duration_sector_2 ?? null,
        s3: r.duration_sector_3 ?? null,
      }));
      const getPosition = buildTimeLookup(rawPosition, 'driver_number', 'date', r => r.position);
      const getPitCount = buildPitCountLookup(rawPits);
      const getStint = buildStintLookup(rawStints);

      // 5. Build frames
      const valid = rawLocation
        .filter(r => r.x != null && r.y != null && r.date)
        .sort((a, b) => a.date.localeCompare(b.date));

      const frames = [];
      let i = 0;
      let radioIdx = 0;
      let rcIdx = 0;

      const radioSorted = rawRadio
        .filter(r => r.driver_number && r.date)
        .map(r => ({
          ts: new Date(r.date).getTime(),
          driverNumber: r.driver_number,
          message: r.recording_url ?? '(radio)',
          utcTimestamp: r.date,
        }))
        .sort((a, b) => a.ts - b.ts);

      const rcSorted = rawRC
        .filter(r => r.date && r.message)
        .map(r => ({
          ts: new Date(r.date).getTime(),
          date: r.date,
          lapNumber: r.lap_number ?? null,
          category: r.category ?? 'Other',
          flag: r.flag ?? null,
          message: r.message,
          scope: r.scope ?? null,
          sector: r.sector ?? null,
        }))
        .sort((a, b) => a.ts - b.ts);

      while (i < valid.length) {
        const anchor = valid[i];
        const anchorMs = new Date(anchor.date).getTime();
        const positions = [];
        const seen = new Set();

        while (i < valid.length) {
          const posMs = new Date(valid[i].date).getTime();
          if (posMs - anchorMs > FRAME_GROUPING_MS) break;
          const dn = valid[i].driver_number;
          if (seen.has(dn)) { i++; continue; }
          seen.add(dn);
          const frameMs = posMs;
          const car = getCarData(dn, frameMs);
          const intv = getInterval(dn, frameMs);
          const lap = getLap(dn, frameMs);
          const racePos = getPosition(dn, frameMs) ?? 99;
          const pitCount = getPitCount(dn, frameMs);
          const lapNum = lap?.currentLap ?? 0;
          const stint = getStint(dn, lapNum);

          positions.push({
            driverNumber: dn,
            x: valid[i].x,
            y: valid[i].y,
            position: racePos,
            speed: car?.speed ?? null,
            throttle: car?.throttle ?? null,
            brake: car?.brake ?? null,
            gear: car?.gear ?? null,
            drs: car?.drs ?? null,
            gapToLeader: intv?.gapToLeader ?? null,
            intervalToAhead: intv?.intervalToAhead ?? null,
            lastLapTime: lap?.lastLapTime ?? null,
            bestLapTime: null,
            currentLap: lap?.currentLap ?? null,
            s1: lap?.s1 ?? null,
            s2: lap?.s2 ?? null,
            s3: lap?.s3 ?? null,
            tyreCompound: stint.compound,
            tyreLapAge: stint.tyreLapAge,
            pitStopCount: pitCount,
            inPit: car?.speed != null && car.speed < 5 && pitCount > 0 && lapNum > 0,
          });
          i++;
        }

        if (!positions.length) continue;

        const frame = {
          virtualTimeMs: anchorMs - sessionStartMs,
          wallTimeMs: anchorMs,
          positions,
        };

        // Radio messages for this frame window
        const fRadio = [];
        while (radioIdx < radioSorted.length && radioSorted[radioIdx].ts <= anchorMs + 125) {
          const r = radioSorted[radioIdx];
          if (r.ts >= anchorMs - 125) {
            fRadio.push({ driverNumber: r.driverNumber, message: r.message, utcTimestamp: r.utcTimestamp });
          }
          radioIdx++;
        }
        if (fRadio.length) frame.radioMessages = fRadio;

        // Race control messages for this frame window
        const fRC = [];
        while (rcIdx < rcSorted.length && rcSorted[rcIdx].ts <= anchorMs + 125) {
          const r = rcSorted[rcIdx];
          if (r.ts >= anchorMs - 125) {
            fRC.push({
              date: r.date, lapNumber: r.lapNumber, category: r.category,
              flag: r.flag, message: r.message, scope: r.scope, sector: r.sector,
            });
          }
          rcIdx++;
        }
        if (fRC.length) frame.raceControlMessages = fRC;

        frames.push(frame);
      }

      // Best lap post-pass
      const bestLaps = new Map();
      for (const f of frames) {
        for (const p of f.positions) {
          if (p.lastLapTime > 0) {
            const c = bestLaps.get(p.driverNumber) ?? Infinity;
            if (p.lastLapTime < c) bestLaps.set(p.driverNumber, p.lastLapTime);
          }
        }
      }
      for (const f of frames) {
        for (const p of f.positions) {
          p.bestLapTime = bestLaps.get(p.driverNumber) ?? null;
        }
      }

      const durationMs = frames.length > 0 ? frames[frames.length - 1].virtualTimeMs : 0;

      // 6. Write chunks to Firestore
      await ping('writing', frames.length);
      let chunkIndex = 0;
      let chunkFrames = [];

      for (const frame of frames) {
        chunkFrames.push(frame);
        if (chunkFrames.length >= FRAMES_PER_CHUNK) {
          const docId = `${sessionKey}_${String(chunkIndex).padStart(4, '0')}`;
          await db.collection('replay_chunks').doc(docId).set({
            sessionKey,
            chunkIndex,
            startTimeMs: chunkFrames[0].virtualTimeMs,
            endTimeMs: chunkFrames[chunkFrames.length - 1].virtualTimeMs,
            frameCount: chunkFrames.length,
            frames: chunkFrames,
          });
          chunkIndex++;
          chunkFrames = [];
        }
      }
      if (chunkFrames.length > 0) {
        const docId = `${sessionKey}_${String(chunkIndex).padStart(4, '0')}`;
        await db.collection('replay_chunks').doc(docId).set({
          sessionKey,
          chunkIndex,
          startTimeMs: chunkFrames[0].virtualTimeMs,
          endTimeMs: chunkFrames[chunkFrames.length - 1].virtualTimeMs,
          frameCount: chunkFrames.length,
          frames: chunkFrames,
        });
        chunkIndex++;
      }

      // 7. Write replay_meta document
      await db.collection('replay_meta').doc(String(sessionKey)).set({
        sessionKey,
        sessionName: meta.session_name ?? '',
        meetingName: meta.meeting_name ?? '',
        durationMs,
        totalLaps: meta.total_laps ?? null,
        totalFrames: frames.length,
        totalChunks: chunkIndex,
        drivers,
        radioMessages: radioSorted.map(r => ({
          driverNumber: r.driverNumber,
          message: r.message,
          utcTimestamp: r.utcTimestamp,
        })),
        ingestedAt: Timestamp.now(),
      });

      // 8. Update session doc — mark complete + set circuit/meeting metadata
      await sessionDocRef.set({
        firestoreStatus: 'complete',
        firestoreChunkCount: chunkIndex,
        firestoreTotalFrames: frames.length,
        firestoreIngestedAt: Timestamp.now(),
        firestoreError: null,
        cacheVersion: REPLAY_CACHE_VERSION,
        circuitKey: sessionMeta.circuit_key ?? null,
        meetingName: sessionMeta.meeting_name ?? null,
        sessionName: sessionMeta.session_name ?? null,
        dateStart: sessionMeta.date_start ?? null,
        dateEnd: sessionMeta.date_end ?? null,
      }, { merge: true });

      console.log(JSON.stringify({
        severity: "INFO",
        message: "REPLAY_INGEST_COMPLETE",
        sessionKey,
        totalFrames: frames.length,
        totalChunks: chunkIndex,
        durationMs,
        timestamp: new Date().toISOString(),
      }));

      return { success: true, totalFrames: frames.length, totalChunks: chunkIndex };

    } catch (err) {
      // Mark session as failed
      await sessionDocRef.set({
        firestoreStatus: 'failed',
        firestoreError: err.message || String(err),
      }, { merge: true }).catch(() => {});

      console.error(JSON.stringify({
        severity: "ERROR",
        message: "REPLAY_INGEST_FAILED",
        sessionKey,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      }));

      throw new HttpsError("internal", `Ingest failed: ${err.message}`);
    }
  }
);
