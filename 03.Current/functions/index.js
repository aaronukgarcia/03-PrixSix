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
const ERROR_CODES = require("../shared/error-codes.json");

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
const HISTORY_COLLECTION = "backup_history";

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

    // GUID: BACKUP_FUNCTIONS-017-v03
    // [Intent] Call performBackup and return structured success/failure response.
    //          On failure, include correlationId and errorCode (PX-7002) so the
    //          frontend can display a Golden Rule #1 compliant error with copyable
    //          details. The correlationId is extracted from the error object where
    //          performBackup attaches it before re-throwing.
    // [Inbound Trigger] Admin passes auth + admin check above.
    // [Downstream Impact] Response is consumed by BackupHealthDashboard handleBackupNow.
    try {
      const { correlationId, gcsPrefix } = await performBackup(db, { trigger: "manual" });
      return { success: true, correlationId, backupPath: gcsPrefix };
    } catch (err) {
      console.error("Manual backup failed:", err);
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
// GUID: BACKUP_FUNCTIONS-055-v05
/**
 * listBackupHistory — Callable Cloud Function (2nd-gen, Cloud Run)
 *
 * [Intent] Backfill the backup_history Firestore collection from existing
 *          GCS backup folders. Lists all top-level prefixes in the backup
 *          bucket, sums file sizes per prefix, and writes each to
 *          backup_history if not already present. Returns the full list.
 *          On failure, returns PX-7008 error code with correlation ID and
 *          writes a failure record to backup_history.
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
      console.error("listBackupHistory failed:", err);

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
      console.error("Recovery test failed:", err);

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
      console.error("Manual smoke test failed:", err);

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
