// GUID: AZURE_STORE-000-v05
// [Intent] Azure Blob Storage adapter for Baileys auth state persistence.
//          Downloads auth files from blob on init, syncs back periodically and on creds.update.
//          Replaces the whatsapp-web.js RemoteAuth zip-based approach with per-file blob storage.
//          v05 (2026-09-11, COST-BLOB-001): INCREMENTAL sync. v04 re-uploaded EVERY auth file
//          (552 blobs) on every 5-min tick AND on every creds.update — 2.1M PutBlob calls in
//          11 days (~£24/month, growing). Now: (1) a SHA-256 map of what is already in blob
//          (seeded on restore) gates each upload — unchanged files are skipped; (2) blobs whose
//          local file Baileys has deleted (consumed pre-keys) are pruned so the set stops
//          growing; (3) creds.update bursts are coalesced by requestSync() (debounced,
//          single-flight) instead of firing a full sync per event.
// [Inbound Trigger] Called by whatsapp-client.ts during initialization and on credential updates.
// [Downstream Impact] Session persistence across container restarts — avoids QR re-scan on redeploy.
//          Blob write volume is now proportional to files that actually changed (typically 1–5
//          per sync), not to the total file count.

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CONTAINER = 'whatsapp-session';
const BLOB_PREFIX = 'baileys-auth';

export class AzureBlobAuthStore {
  private containerClient: ContainerClient;
  private localAuthDir: string;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // v05: relativePath -> sha256 hex of the content currently held in blob storage.
  // Seeded by restoreFromBlob(); maintained by syncToBlob(). A file whose hash matches is
  // NOT re-uploaded. A key present here but absent locally is deleted from blob.
  private remoteHashes = new Map<string, string>();

  // v05: debounce + single-flight for creds.update bursts (Baileys can fire dozens per second
  // during key rotation). One sync runs at a time; a request arriving mid-sync queues exactly
  // one follow-up.
  private readonly DEBOUNCE_MS = 2000;
  private debounceTimer: NodeJS.Timeout | null = null;
  private syncInFlight: Promise<void> | null = null;
  private syncQueued = false;

  constructor(connectionString: string, localAuthDir: string, containerName?: string) {
    // SECURITY: Validate connection string format (WHATSAPP-003)
    if (!connectionString.includes('AccountName=') || !connectionString.includes('AccountKey=')) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is malformed — must contain AccountName and AccountKey');
    }

    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      this.containerClient = blobServiceClient.getContainerClient(containerName || DEFAULT_CONTAINER);
    } catch (error: any) {
      // SECURITY: Sanitize error to prevent connection string exposure in logs
      throw new Error(`Failed to initialize Azure Blob Storage: ${error.code || 'Invalid configuration'}`);
    }

    this.localAuthDir = localAuthDir;
  }

  /**
   * Ensure the blob container exists before any operations
   */
  async ensureContainer(): Promise<void> {
    try {
      await this.containerClient.createIfNotExists();
      console.log(`☁️ Azure blob container ready: ${this.containerClient.containerName}`);
    } catch (error: any) {
      throw new Error(`Failed to create Azure blob container: ${error.message}`);
    }
  }

  /**
   * Download all auth files from Azure Blob to local directory.
   * Called once at startup before initializing the Baileys socket.
   * Returns true if any files were restored, false if starting fresh.
   * v05: seeds remoteHashes so the first sync after restore only uploads real changes.
   */
  async restoreFromBlob(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.localAuthDir)) {
        fs.mkdirSync(this.localAuthDir, { recursive: true });
      }

      let fileCount = 0;
      for await (const blob of this.containerClient.listBlobsFlat({ prefix: `${BLOB_PREFIX}/` })) {
        const blobClient = this.containerClient.getBlobClient(blob.name);
        const fileName = blob.name.replace(`${BLOB_PREFIX}/`, '');
        const localPath = path.join(this.localAuthDir, fileName);

        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const downloadResponse = await blobClient.download(0);
        const body = await streamToBuffer(downloadResponse.readableStreamBody!);
        fs.writeFileSync(localPath, body);
        this.remoteHashes.set(fileName, sha256(body));
        fileCount++;
      }

      if (fileCount > 0) {
        console.log(`☁️ Restored ${fileCount} auth files from Azure Blob Storage`);
        return true;
      } else {
        console.log('☁️ No existing auth files in Azure — starting fresh (QR scan required)');
        return false;
      }
    } catch (error: any) {
      console.error('☁️ Failed to restore auth from Azure:', error.message);
      return false;
    }
  }

  /**
   * v05: Debounced, single-flight sync request. Use this from event handlers (creds.update).
   * Many calls within DEBOUNCE_MS collapse into one syncToBlob(); a call during an in-flight
   * sync schedules exactly one follow-up so no change is lost.
   */
  requestSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.syncToBlob().catch(err => console.error('☁️ Requested sync failed:', err.message));
    }, this.DEBOUNCE_MS);
  }

  /**
   * Sync local auth files to Azure Blob Storage — INCREMENTAL (v05).
   * Uploads only files whose content hash differs from what blob already holds; deletes blobs
   * whose local file no longer exists. Single-flight: concurrent callers share the running
   * sync and at most one follow-up is queued.
   */
  async syncToBlob(): Promise<void> {
    if (this.syncInFlight) {
      this.syncQueued = true;
      return this.syncInFlight;
    }
    this.syncInFlight = this.runSync().finally(() => {
      this.syncInFlight = null;
      if (this.syncQueued) {
        this.syncQueued = false;
        this.syncToBlob().catch(err => console.error('☁️ Follow-up sync failed:', err.message));
      }
    });
    return this.syncInFlight;
  }

  private async runSync(): Promise<void> {
    try {
      if (!fs.existsSync(this.localAuthDir)) return;

      const files = this.getFilesRecursive(this.localAuthDir);
      const seen = new Set<string>();
      let uploaded = 0;
      let skipped = 0;
      let deleted = 0;

      for (const filePath of files) {
        const relativePath = path.relative(this.localAuthDir, filePath).replace(/\\/g, '/');
        seen.add(relativePath);

        let content: Buffer;
        try {
          content = fs.readFileSync(filePath);
        } catch (readErr: any) {
          // Baileys deletes consumed pre-key files between readdir and read — benign race.
          if (readErr.code === 'ENOENT') { seen.delete(relativePath); continue; }
          throw readErr;
        }

        const hash = sha256(content);
        if (this.remoteHashes.get(relativePath) === hash) {
          skipped++;
          continue;
        }

        const blockBlobClient = this.containerClient.getBlockBlobClient(`${BLOB_PREFIX}/${relativePath}`);
        await blockBlobClient.upload(content, content.length, {
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
          metadata: { syncedAt: new Date().toISOString() },
        });
        this.remoteHashes.set(relativePath, hash);
        uploaded++;
      }

      // Prune blobs for files Baileys has removed locally (consumed pre-keys, rotated sessions).
      for (const relativePath of Array.from(this.remoteHashes.keys())) {
        if (seen.has(relativePath)) continue;
        try {
          await this.containerClient.deleteBlob(`${BLOB_PREFIX}/${relativePath}`);
        } catch (delErr: any) {
          // Already gone (404) is fine; anything else is logged and the entry is kept for retry.
          if (delErr.statusCode !== 404) {
            console.error(`☁️ Failed to prune blob ${relativePath}:`, delErr.message);
            continue;
          }
        }
        this.remoteHashes.delete(relativePath);
        deleted++;
      }

      if (uploaded > 0 || deleted > 0) {
        console.log(`☁️ Auth sync: ${uploaded} uploaded, ${deleted} pruned, ${skipped} unchanged`);
      }
    } catch (error: any) {
      console.error('☁️ Failed to sync auth to Azure:', error.message);
    }
  }

  /**
   * Start periodic background sync (every 5 minutes) — safety net for anything the
   * creds.update path missed. Cheap now: unchanged files cost zero blob operations.
   */
  startPeriodicSync(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => this.syncToBlob(), this.SYNC_INTERVAL_MS);
    console.log(`☁️ Started periodic auth sync (every ${this.SYNC_INTERVAL_MS / 1000}s, incremental)`);
  }

  /**
   * Stop periodic sync and do one final sync
   */
  async stopSync(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.syncToBlob();
  }

  /**
   * Delete all auth files from Azure Blob (for logout/reset)
   */
  async clearBlob(): Promise<void> {
    try {
      for await (const blob of this.containerClient.listBlobsFlat({ prefix: `${BLOB_PREFIX}/` })) {
        await this.containerClient.deleteBlob(blob.name);
      }
      this.remoteHashes.clear();
      console.log('☁️ Cleared all auth files from Azure Blob');
    } catch (error: any) {
      console.error('☁️ Failed to clear Azure auth:', error.message);
    }
  }

  private getFilesRecursive(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.getFilesRecursive(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data: Buffer) => chunks.push(data));
    readableStream.on('end', () => resolve(Buffer.concat(chunks)));
    readableStream.on('error', reject);
  });
}
