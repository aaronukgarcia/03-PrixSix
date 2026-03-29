// GUID: AZURE_STORE-000-v04
// [Intent] Azure Blob Storage adapter for Baileys auth state persistence.
//          Downloads auth files from blob on init, syncs back periodically and on creds.update.
//          Replaces the whatsapp-web.js RemoteAuth zip-based approach with per-file blob storage.
// [Inbound Trigger] Called by whatsapp-client.ts during initialization and on credential updates.
// [Downstream Impact] Session persistence across container restarts — avoids QR re-scan on redeploy.

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CONTAINER = 'whatsapp-session';
const BLOB_PREFIX = 'baileys-auth';

export class AzureBlobAuthStore {
  private containerClient: ContainerClient;
  private localAuthDir: string;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
   * Sync all local auth files to Azure Blob Storage.
   * Called on creds.update and periodically (every 5 min).
   */
  async syncToBlob(): Promise<void> {
    try {
      if (!fs.existsSync(this.localAuthDir)) return;

      const files = this.getFilesRecursive(this.localAuthDir);
      for (const filePath of files) {
        const relativePath = path.relative(this.localAuthDir, filePath).replace(/\\/g, '/');
        const blobName = `${BLOB_PREFIX}/${relativePath}`;
        const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
        const content = fs.readFileSync(filePath);
        await blockBlobClient.upload(content, content.length, {
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
          metadata: { syncedAt: new Date().toISOString() },
        });
      }
      console.log(`☁️ Synced ${files.length} auth files to Azure Blob`);
    } catch (error: any) {
      console.error('☁️ Failed to sync auth to Azure:', error.message);
    }
  }

  /**
   * Start periodic background sync (every 5 minutes)
   */
  startPeriodicSync(): void {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => this.syncToBlob(), this.SYNC_INTERVAL_MS);
    console.log(`☁️ Started periodic auth sync (every ${this.SYNC_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop periodic sync and do one final sync
   */
  async stopSync(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
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

async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data: Buffer) => chunks.push(data));
    readableStream.on('end', () => resolve(Buffer.concat(chunks)));
    readableStream.on('error', reject);
  });
}
