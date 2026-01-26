import { Client, LocalAuth, RemoteAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { AzureBlobStore } from './azure-store';
import { getFirestore } from './firebase-config';
import * as path from 'path';

// Detect if running on Windows (local dev) vs Linux (Azure container)
const isWindows = process.platform === 'win32';

// Use Azure Blob Storage in production (when connection string is set)
const useAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

// Keep-alive interval (ping every 3 minutes)
const KEEP_ALIVE_INTERVAL_MS = 3 * 60 * 1000;

// Reconnect delay after disconnect
const RECONNECT_DELAY_MS = 10000;

// Puppeteer args - fewer restrictions needed on Windows
const PUPPETEER_ARGS_DOCKER = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-software-rasterizer',
];

const PUPPETEER_ARGS_WINDOWS = [
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
];

// Status types for logging
type WhatsAppStatus = 'initializing' | 'qr_received' | 'authenticated' | 'ready' | 'disconnected' | 'auth_failure' | 'keep_alive_ping' | 'keep_alive_fail' | 'reconnecting';

export class WhatsAppClient {
  private client: Client;
  private isReady: boolean = false;
  private azureStore: AzureBlobStore | null = null;
  private qrCodeData: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private lastStatus: WhatsAppStatus = 'initializing';
  private consecutiveFailures: number = 0;
  private lastSuccessfulPing: Date | null = null;

  constructor() {
    // Configure based on platform
    const authDataPath = isWindows
      ? path.join(process.cwd(), '.wwebjs_auth')
      : '/tmp/.wwebjs_auth';

    // Set env var for azure store to find the zip files
    process.env.REMOTE_AUTH_DATA_PATH = authDataPath;

    const puppeteerConfig: any = {
      headless: true,
      args: isWindows ? PUPPETEER_ARGS_WINDOWS : PUPPETEER_ARGS_DOCKER,
    };

    // Only set executablePath on Linux/Docker - let Puppeteer find Chrome on Windows
    if (!isWindows && process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (!isWindows) {
      puppeteerConfig.executablePath = '/usr/bin/chromium';
    }

    console.log(`🖥️ Platform: ${process.platform}`);
    console.log(`💾 Storage: ${useAzureStorage ? 'Azure Blob Storage' : 'Local filesystem'}`);
    console.log(`📁 Auth path: ${authDataPath}`);

    // Choose auth strategy based on environment
    let authStrategy;

    if (useAzureStorage) {
      // Production: Use RemoteAuth with Azure Blob Storage
      this.azureStore = new AzureBlobStore('prixsix-whatsapp');
      authStrategy = new RemoteAuth({
        clientId: 'prixsix-whatsapp',
        dataPath: authDataPath,
        store: this.azureStore,
        backupSyncIntervalMs: 300000, // Sync every 5 minutes
      });
      console.log('🔐 Using RemoteAuth with Azure Blob Storage');
    } else {
      // Local development: Use LocalAuth
      authStrategy = new LocalAuth({
        clientId: 'prixsix-whatsapp',
        dataPath: authDataPath,
      });
      console.log('🔐 Using LocalAuth (local development)');
    }

    this.client = new Client({
      authStrategy,
      puppeteer: puppeteerConfig,
    });

    this.setupEventHandlers();
  }

  /**
   * Log status changes to Firestore for monitoring
   */
  private async logStatusChange(
    status: WhatsAppStatus,
    details?: Record<string, any>
  ): Promise<void> {
    // Only log if status actually changed (except for keep_alive which we always log)
    if (status === this.lastStatus && status !== 'keep_alive_ping' && status !== 'keep_alive_fail') {
      return;
    }

    this.lastStatus = status;
    const timestamp = new Date();

    const logEntry = {
      status,
      timestamp,
      details: details || {},
      platform: process.platform,
      storage: useAzureStorage ? 'azure' : 'local',
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessfulPing: this.lastSuccessfulPing,
    };

    console.log(`📊 Status change: ${status}`, details || '');

    try {
      const db = getFirestore();

      // Log to status_log collection (historical)
      await db.collection('whatsapp_status_log').add({
        ...logEntry,
        timestamp: timestamp,
      });

      // Update current status document
      await db.collection('whatsapp_status').doc('current').set({
        ...logEntry,
        updatedAt: timestamp,
      }, { merge: true });

    } catch (error) {
      console.error('Failed to log status to Firestore:', error);
    }
  }

  private setupEventHandlers(): void {
    // QR Code event - display in terminal/logs for initial setup
    this.client.on('qr', (qr: string) => {
      this.qrCodeData = qr;
      this.logStatusChange('qr_received', { qrLength: qr.length });

      console.log('\n' + '='.repeat(50));
      console.log('📱 SCAN THIS QR CODE WITH WHATSAPP:');
      console.log('='.repeat(50) + '\n');
      qrcode.generate(qr, { small: true });
      console.log('\n' + '='.repeat(50));
      console.log('QR Data (for debugging):', qr.substring(0, 50) + '...');
      console.log('='.repeat(50) + '\n');
    });

    // Ready event
    this.client.on('ready', async () => {
      this.isReady = true;
      this.qrCodeData = null;
      this.consecutiveFailures = 0;
      this.lastSuccessfulPing = new Date();

      let clientInfo = {};
      try {
        clientInfo = {
          pushname: this.client.info?.pushname,
          platform: this.client.info?.platform,
          phone: this.client.info?.wid?.user,
        };
      } catch (error) {
        console.error('Error getting client info:', error);
      }

      await this.logStatusChange('ready', clientInfo);
      console.log('✅ WhatsApp client is ready!');
      console.log('📱 Connected as:', this.client.info?.pushname);

      // Start keep-alive mechanism
      this.startKeepAlive();
    });

    // Authentication events
    this.client.on('authenticated', () => {
      this.logStatusChange('authenticated');
      console.log('✅ WhatsApp authenticated');
    });

    this.client.on('auth_failure', (message: string) => {
      this.logStatusChange('auth_failure', { message });
      console.error('❌ Authentication failed:', message);
      this.isReady = false;
      this.stopKeepAlive();
    });

    // Remote session saved (Azure backup)
    this.client.on('remote_session_saved', () => {
      console.log('☁️ Session backed up to Azure Blob Storage');
    });

    // Disconnection handling
    this.client.on('disconnected', async (reason: string) => {
      await this.logStatusChange('disconnected', { reason });
      console.log('⚠️ WhatsApp disconnected:', reason);
      this.isReady = false;
      this.stopKeepAlive();

      // Auto-reconnect after delay
      setTimeout(async () => {
        await this.logStatusChange('reconnecting', { afterReason: reason });
        console.log('🔄 Attempting to reconnect...');
        this.initialize();
      }, RECONNECT_DELAY_MS);
    });

    // State change event (if available)
    this.client.on('change_state', (state: any) => {
      console.log('📊 State changed:', state);
    });

    // Message received (for debugging)
    this.client.on('message', (message: Message) => {
      console.log(`📨 Message from ${message.from}: ${message.body.substring(0, 50)}...`);
    });
  }

  /**
   * Start keep-alive mechanism - periodically ping WhatsApp to prevent disconnection
   */
  private startKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    console.log(`⏰ Starting keep-alive (every ${KEEP_ALIVE_INTERVAL_MS / 1000}s)`);

    this.keepAliveInterval = setInterval(async () => {
      await this.performKeepAlivePing();
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  /**
   * Stop keep-alive mechanism
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('⏰ Keep-alive stopped');
    }
  }

  /**
   * Perform a keep-alive ping by interacting with WhatsApp
   * This helps prevent the session from going stale
   */
  private async performKeepAlivePing(): Promise<void> {
    if (!this.isReady) {
      console.log('⏭️ Skipping keep-alive ping (not ready)');
      return;
    }

    try {
      // Method 1: Get connection state
      const state = await this.client.getState();

      // Method 2: Get chats (forces interaction with WhatsApp servers)
      const chats = await this.client.getChats();

      this.consecutiveFailures = 0;
      this.lastSuccessfulPing = new Date();

      // Log success (but not every time to avoid spam - only log every 10 pings or on state issues)
      const logDetails = {
        state,
        chatCount: chats.length,
        timestamp: new Date().toISOString(),
      };

      // Only log to Firestore occasionally (every ~30 mins = every 10 pings)
      if (Math.random() < 0.1) {
        await this.logStatusChange('keep_alive_ping', logDetails);
      }

      console.log(`💓 Keep-alive ping OK - State: ${state}, Chats: ${chats.length}`);

      // If state isn't CONNECTED, there might be an issue
      if (state !== 'CONNECTED') {
        console.warn(`⚠️ WhatsApp state is ${state}, not CONNECTED`);
        await this.logStatusChange('keep_alive_ping', { ...logDetails, warning: 'Not CONNECTED state' });
      }

    } catch (error: any) {
      this.consecutiveFailures++;

      await this.logStatusChange('keep_alive_fail', {
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
      });

      console.error(`❌ Keep-alive ping failed (attempt ${this.consecutiveFailures}):`, error.message);

      // If we've failed multiple times, try to reinitialize
      if (this.consecutiveFailures >= 3) {
        console.error('🔄 Too many keep-alive failures, attempting reconnection...');
        this.isReady = false;
        this.stopKeepAlive();

        setTimeout(() => {
          this.initialize();
        }, RECONNECT_DELAY_MS);
      }
    }
  }

  async initialize(): Promise<void> {
    await this.logStatusChange('initializing');
    console.log('🚀 Initializing WhatsApp client...');

    // Ensure Azure container exists if using Azure storage
    if (this.azureStore) {
      try {
        await this.azureStore.ensureContainer();
      } catch (error) {
        console.error('⚠️ Failed to ensure Azure container (continuing anyway):', error);
      }
    }

    try {
      await this.client.initialize();
    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client:', error);
      throw error;
    }
  }

  async sendMessage(chatId: string, message: string): Promise<boolean> {
    if (!this.isReady) {
      console.error('❌ WhatsApp client not ready');
      return false;
    }

    try {
      await this.client.sendMessage(chatId, message);
      console.log(`✅ Message sent to ${chatId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send message to ${chatId}:`, error);
      return false;
    }
  }

  /**
   * Send message to a group by name (searches for the group)
   */
  async sendToGroup(groupName: string, message: string): Promise<boolean> {
    if (!this.isReady) {
      console.error('❌ WhatsApp client not ready');
      return false;
    }

    try {
      const chats = await this.client.getChats();
      const group = chats.find(
        (chat) => chat.isGroup && chat.name.toLowerCase().includes(groupName.toLowerCase())
      );

      if (!group) {
        console.error(`❌ Group "${groupName}" not found`);
        // List available groups for debugging
        const groups = chats.filter(c => c.isGroup).map(c => c.name);
        console.log(`📋 Available groups: ${groups.join(', ')}`);
        return false;
      }

      // Use client.sendMessage with chat ID and disable sendSeen to avoid markedUnread error
      const chatId = group.id._serialized;
      await this.client.sendMessage(chatId, message, { sendSeen: false });
      console.log(`✅ Message sent to group "${group.name}" (${chatId})`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send message to group "${groupName}":`, error);
      return false;
    }
  }

  getStatus(): {
    ready: boolean;
    qrCode: string | null;
    storage: string;
    lastSuccessfulPing: Date | null;
    consecutiveFailures: number;
  } {
    return {
      ready: this.isReady,
      qrCode: this.qrCodeData,
      storage: useAzureStorage ? 'azure' : 'local',
      lastSuccessfulPing: this.lastSuccessfulPing,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  async getGroups(): Promise<Array<{ id: string; name: string }>> {
    if (!this.isReady) return [];

    const chats = await this.client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
  }

  /**
   * Force a manual keep-alive ping (for testing/debugging)
   */
  async forceKeepAlivePing(): Promise<{ success: boolean; state?: string; error?: string }> {
    try {
      const state = await this.client.getState();
      const chats = await this.client.getChats();
      this.lastSuccessfulPing = new Date();
      this.consecutiveFailures = 0;
      return { success: true, state };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
