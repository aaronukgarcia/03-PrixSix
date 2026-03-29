// GUID: WHATSAPP_CLIENT-000-v04
// [Intent] WhatsApp client wrapper using Baileys (WebSocket protocol, no Puppeteer/Chromium).
//          Drop-in replacement for the whatsapp-web.js based client — same public interface.
// [Inbound Trigger] Instantiated by index.ts at server startup.
// [Downstream Impact] Provides sendMessage, sendToGroup, getStatus, getGroups for queue-processor
//                     and Express endpoints. Logs status changes to Firestore.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { AzureBlobAuthStore } from './azure-store';
import { getFirestore } from './firebase-config';
import * as path from 'path';

// Use Azure Blob Storage in production (when connection string is set)
const useAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

// Keep-alive interval for Firestore status monitoring (Baileys handles WS keep-alive internally)
const KEEP_ALIVE_INTERVAL_MS = 3 * 60 * 1000;

// Reconnect delay after disconnect
const RECONNECT_DELAY_MS = 10000;

// Auth folder paths
const AUTH_DIR_DOCKER = '/app/auth_info';
const AUTH_DIR_WINDOWS = path.join(process.cwd(), 'auth_info');
const isWindows = process.platform === 'win32';

// Status types for logging (same as v03 for Firestore compatibility)
type WhatsAppStatus = 'initializing' | 'qr_received' | 'authenticated' | 'ready' | 'disconnected' | 'auth_failure' | 'keep_alive_ping' | 'keep_alive_fail' | 'reconnecting';

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private isReady: boolean = false;
  private azureStore: AzureBlobAuthStore | null = null;
  private qrCodeData: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private lastStatus: WhatsAppStatus = 'initializing';
  private consecutiveFailures: number = 0;
  private lastSuccessfulPing: Date | null = null;
  private authDir: string;
  private shouldReconnect: boolean = true;

  constructor() {
    this.authDir = isWindows ? AUTH_DIR_WINDOWS : AUTH_DIR_DOCKER;
  }

  /**
   * Initialize the Baileys WhatsApp client.
   * Restores session from Azure Blob if available, otherwise starts fresh (QR scan needed).
   */
  async initialize(): Promise<void> {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Initialising WhatsApp client (Baileys)...');
    console.log(`📂 Auth dir: ${this.authDir}`);
    console.log(`☁️ Storage: ${useAzureStorage ? 'Azure Blob' : 'Local filesystem'}`);
    console.log('='.repeat(50) + '\n');

    await this.logStatusChange('initializing');

    // Set up Azure session persistence if configured
    if (useAzureStorage) {
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
      const containerName = process.env.AZURE_STORAGE_CONTAINER || 'whatsapp-session';
      this.azureStore = new AzureBlobAuthStore(connectionString, this.authDir, containerName);
      await this.azureStore.ensureContainer();
      await this.azureStore.restoreFromBlob();
    }

    await this.connectSocket();
  }

  /**
   * Create and connect the Baileys WebSocket
   */
  private async connectSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

    this.sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: true,
      // Don't mark messages as read automatically
      markOnlineOnConnect: false,
    });

    // Credential updates — save locally and sync to Azure
    this.sock.ev.on('creds.update', async () => {
      await saveCreds();
      // Fire-and-forget Azure sync on every creds update
      if (this.azureStore) {
        this.azureStore.syncToBlob().catch(err =>
          console.error('☁️ Creds sync failed:', err.message)
        );
      }
    });

    // Connection state changes — maps to our status events
    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code available
      if (qr) {
        this.qrCodeData = qr;
        await this.logStatusChange('qr_received', { qrLength: qr.length });
        console.log('\n' + '='.repeat(50));
        console.log('📱 SCAN THIS QR CODE WITH WHATSAPP:');
        console.log('='.repeat(50));
        console.log('QR Data (first 50 chars):', qr.substring(0, 50) + '...');
        console.log('='.repeat(50) + '\n');
      }

      // Connected successfully
      if (connection === 'open') {
        this.isReady = true;
        this.qrCodeData = null;
        this.consecutiveFailures = 0;
        this.lastSuccessfulPing = new Date();
        this.shouldReconnect = true;

        const clientInfo = {
          pushname: this.sock?.user?.name || 'unknown',
          platform: 'baileys',
          phone: this.sock?.user?.id?.split(':')[0] || 'unknown',
        };

        await this.logStatusChange('authenticated');
        await this.logStatusChange('ready', clientInfo);
        console.log('✅ WhatsApp client is ready!');
        console.log('📱 Connected as:', clientInfo.pushname);

        // Start keep-alive monitoring and Azure periodic sync
        this.startKeepAlive();
        if (this.azureStore) {
          this.azureStore.startPeriodicSync();
        }
      }

      // Disconnected
      if (connection === 'close') {
        this.isReady = false;
        this.stopKeepAlive();

        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const reason = DisconnectReason[statusCode] || `code ${statusCode}`;

        await this.logStatusChange('disconnected', { reason, statusCode });
        console.log('⚠️ WhatsApp disconnected:', reason);

        // If logged out, clear session and stop
        if (statusCode === DisconnectReason.loggedOut) {
          await this.logStatusChange('auth_failure', { message: 'Logged out by WhatsApp' });
          console.error('❌ Logged out — session cleared. QR scan required on next restart.');
          this.shouldReconnect = false;
          if (this.azureStore) {
            await this.azureStore.clearBlob();
          }
          return;
        }

        // Auto-reconnect for all other disconnect reasons
        if (this.shouldReconnect) {
          await this.logStatusChange('reconnecting', { afterReason: reason });
          console.log(`🔄 Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
          setTimeout(() => this.connectSocket(), RECONNECT_DELAY_MS);
        }
      }
    });

    // Incoming messages (for debugging)
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
          if (text) {
            console.log(`📨 Message from ${msg.key.remoteJid}: ${text.substring(0, 50)}...`);
          }
        }
      }
    });
  }

  /**
   * Send a message to a specific chat ID (JID)
   */
  async sendMessage(chatId: string, message: string): Promise<boolean> {
    if (!this.isReady || !this.sock) {
      console.error('❌ Cannot send message — WhatsApp not ready');
      return false;
    }

    try {
      await this.sock.sendMessage(chatId, { text: message });
      console.log(`✅ Message sent to ${chatId}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to send message to ${chatId}:`, error.message);
      return false;
    }
  }

  /**
   * Send a message to a WhatsApp group by name (case-insensitive substring match)
   */
  async sendToGroup(groupName: string, message: string): Promise<boolean> {
    if (!this.isReady || !this.sock) {
      console.error('❌ Cannot send to group — WhatsApp not ready');
      return false;
    }

    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const searchName = groupName.toLowerCase();

      const match = Object.entries(groups).find(([, data]) =>
        data.subject.toLowerCase().includes(searchName)
      );

      if (!match) {
        const available = Object.values(groups).map(g => g.subject);
        console.error(`❌ Group "${groupName}" not found. Available groups:`, available);
        return false;
      }

      const [groupJid, groupData] = match;
      await this.sock.sendMessage(groupJid, { text: message });
      console.log(`✅ Message sent to group "${groupData.subject}"`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to send to group "${groupName}":`, error.message);
      return false;
    }
  }

  /**
   * Get current client status (same shape as v03 for admin UI compatibility)
   */
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

  /**
   * Get all groups as array of {id, name}
   */
  async getGroups(): Promise<Array<{ id: string; name: string }>> {
    if (!this.isReady || !this.sock) return [];

    try {
      const groups = await this.sock.groupFetchAllParticipating();
      return Object.entries(groups).map(([jid, data]) => ({
        id: jid,
        name: data.subject,
      }));
    } catch (error: any) {
      console.error('Failed to fetch groups:', error.message);
      return [];
    }
  }

  /**
   * Manual keep-alive ping for testing/debugging
   */
  async forceKeepAlivePing(): Promise<{ success: boolean; state?: string; error?: string }> {
    if (!this.isReady || !this.sock) {
      return { success: false, error: 'WhatsApp not ready' };
    }

    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const state = this.sock.user ? 'CONNECTED' : 'DISCONNECTED';
      this.lastSuccessfulPing = new Date();
      this.consecutiveFailures = 0;
      return { success: true, state };
    } catch (error: any) {
      this.consecutiveFailures++;
      return { success: false, error: error.message };
    }
  }

  /**
   * Start keep-alive monitoring — periodically pings WhatsApp and logs to Firestore
   */
  private startKeepAlive(): void {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);

    console.log(`⏰ Starting keep-alive monitoring (every ${KEEP_ALIVE_INTERVAL_MS / 1000}s)`);
    this.keepAliveInterval = setInterval(() => this.performKeepAlivePing(), KEEP_ALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      console.log('⏰ Keep-alive stopped');
    }
  }

  private async performKeepAlivePing(): Promise<void> {
    if (!this.isReady || !this.sock) return;

    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const state = this.sock.user ? 'CONNECTED' : 'DISCONNECTED';

      this.lastSuccessfulPing = new Date();
      this.consecutiveFailures = 0;

      // Log to Firestore ~10% of the time to reduce spam
      if (Math.random() < 0.1) {
        await this.logStatusChange('keep_alive_ping', {
          state,
          groupCount: Object.keys(groups).length,
          timestamp: new Date().toISOString(),
        });
      }

      if (state !== 'CONNECTED') {
        console.warn(`⚠️ Keep-alive: state is ${state}, not CONNECTED`);
      }
    } catch (error: any) {
      this.consecutiveFailures++;
      console.error(`❌ Keep-alive failed (${this.consecutiveFailures}):`, error.message);

      await this.logStatusChange('keep_alive_fail', {
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
      });

      // After 3 consecutive failures, attempt reconnect
      if (this.consecutiveFailures >= 3) {
        console.warn('⚠️ 3+ consecutive keep-alive failures — reconnecting...');
        this.isReady = false;
        this.stopKeepAlive();
        await this.logStatusChange('reconnecting', { afterReason: '3+ keep-alive failures' });
        setTimeout(() => this.connectSocket(), RECONNECT_DELAY_MS);
      }
    }
  }

  /**
   * Log status changes to Firestore (whatsapp_status_log and whatsapp_status/current)
   */
  private async logStatusChange(status: WhatsAppStatus, details: Record<string, any> = {}): Promise<void> {
    this.lastStatus = status;

    try {
      const db = getFirestore();
      const timestamp = new Date();

      const logEntry = {
        status,
        details,
        platform: 'baileys',
        storage: useAzureStorage ? 'azure' : 'local',
        consecutiveFailures: this.consecutiveFailures,
        lastSuccessfulPing: this.lastSuccessfulPing,
      };

      // Add to historical log
      await db.collection('whatsapp_status_log').add({
        ...logEntry,
        timestamp,
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
}
