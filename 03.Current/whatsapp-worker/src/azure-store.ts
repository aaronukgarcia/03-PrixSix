/**
 * Azure Blob Storage store for WhatsApp RemoteAuth session persistence
 * Saves session data to Azure Blob Storage for container persistence
 */

import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';

export class AzureBlobStore {
  private containerClient: ContainerClient;
  private sessionId: string;

  constructor(sessionId: string = 'prixsix-whatsapp') {
    this.sessionId = sessionId;

    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER || 'whatsapp-session';

    // SECURITY: Validate connection string before use (WHATSAPP-003 fix)
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
    }

    // Validate connection string format (should contain AccountName and AccountKey)
    if (!connectionString.includes('AccountName=') || !connectionString.includes('AccountKey=')) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is malformed: missing AccountName or AccountKey');
    }

    // Wrap Azure SDK initialization to prevent credential exposure in error messages
    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      this.containerClient = blobServiceClient.getContainerClient(containerName);
      console.log(`☁️ Azure Blob Store initialised for container: ${containerName}`);
    } catch (error: any) {
      // SECURITY: Sanitize error to prevent connection string exposure in logs
      throw new Error(`Failed to initialize Azure Blob Storage: ${error.code || 'Invalid configuration'}. Check AZURE_STORAGE_CONNECTION_STRING format.`);
    }
  }

  /**
   * Ensure the container exists
   */
  async ensureContainer(): Promise<void> {
    try {
      await this.containerClient.createIfNotExists();
      console.log('✅ Azure container ready');
    } catch (error) {
      console.error('❌ Failed to create Azure container:', error);
      throw error;
    }
  }

  /**
   * Get the blob name for a session
   */
  private getBlobName(session: string): string {
    return `${session}/session.zip`;
  }

  /**
   * Check if a session exists in Azure Blob Storage
   * Required by RemoteAuth store interface
   */
  async sessionExists(options: { session: string }): Promise<boolean> {
    try {
      const blobName = this.getBlobName(options.session);
      const blobClient = this.containerClient.getBlobClient(blobName);
      const exists = await blobClient.exists();
      console.log(`📁 Session '${options.session}' exists in Azure: ${exists}`);
      return exists;
    } catch (error) {
      console.error('Error checking session existence:', error);
      return false;
    }
  }

  /**
   * Save session data to Azure Blob Storage
   * Called by RemoteAuth after zipping the auth folder
   * Required by RemoteAuth store interface
   */
  async save(options: { session: string }): Promise<void> {
    // RemoteAuth passes the session ID, and we need to read from the temp zip file
    // The zip file is created at `${RemoteAuth.dataPath}/${session}.zip`
    // But RemoteAuth actually calls this after creating the zip and expects us
    // to read it from the path it provides

    // Note: RemoteAuth v1.26+ passes the zip path differently
    // We need to handle the file upload from the local temp location
    const fs = await import('fs');
    const path = await import('path');

    try {
      // RemoteAuth creates the zip at the data path
      const dataPath = process.env.REMOTE_AUTH_DATA_PATH || '/tmp/.wwebjs_auth';
      const zipPath = path.join(dataPath, `${options.session}.zip`);

      if (!fs.existsSync(zipPath)) {
        console.error(`❌ Zip file not found at ${zipPath}`);
        throw new Error(`Session zip not found: ${zipPath}`);
      }

      const zipBuffer = fs.readFileSync(zipPath);
      const blobName = this.getBlobName(options.session);
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      await blockBlobClient.upload(zipBuffer, zipBuffer.length, {
        blobHTTPHeaders: {
          blobContentType: 'application/zip',
        },
        metadata: {
          session: options.session,
          timestamp: new Date().toISOString(),
        },
      });

      console.log(`✅ Session '${options.session}' saved to Azure Blob Storage (${zipBuffer.length} bytes)`);
    } catch (error) {
      console.error('❌ Error saving session to Azure:', error);
      throw error;
    }
  }

  /**
   * Extract/load session data from Azure Blob Storage
   * Downloads the zip and saves to local temp path for RemoteAuth to extract
   * Required by RemoteAuth store interface
   */
  async extract(options: { session: string }): Promise<string | null> {
    const fs = await import('fs');
    const path = await import('path');

    try {
      const blobName = this.getBlobName(options.session);
      const blobClient = this.containerClient.getBlobClient(blobName);

      const exists = await blobClient.exists();
      if (!exists) {
        console.log(`📭 No session '${options.session}' found in Azure`);
        return null;
      }

      // Download to local temp path
      const dataPath = process.env.REMOTE_AUTH_DATA_PATH || '/tmp/.wwebjs_auth';

      // Ensure directory exists
      if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
      }

      const zipPath = path.join(dataPath, `${options.session}.zip`);

      const downloadResponse = await blobClient.download(0);
      const chunks: Buffer[] = [];

      // Stream to buffer
      if (downloadResponse.readableStreamBody) {
        for await (const chunk of downloadResponse.readableStreamBody) {
          chunks.push(Buffer.from(chunk));
        }
      }

      const zipBuffer = Buffer.concat(chunks);
      fs.writeFileSync(zipPath, zipBuffer);

      console.log(`✅ Session '${options.session}' extracted from Azure (${zipBuffer.length} bytes)`);

      // Return the path where RemoteAuth can find the zip
      return zipPath;
    } catch (error) {
      console.error('❌ Error extracting session from Azure:', error);
      return null;
    }
  }

  /**
   * Delete session from Azure Blob Storage
   * Required by RemoteAuth store interface
   */
  async delete(options: { session: string }): Promise<void> {
    try {
      const blobName = this.getBlobName(options.session);
      const blobClient = this.containerClient.getBlobClient(blobName);

      const exists = await blobClient.exists();
      if (exists) {
        await blobClient.delete();
        console.log(`🗑️ Session '${options.session}' deleted from Azure`);
      } else {
        console.log(`📭 Session '${options.session}' not found in Azure (nothing to delete)`);
      }
    } catch (error) {
      console.error('❌ Error deleting session from Azure:', error);
    }
  }
}
