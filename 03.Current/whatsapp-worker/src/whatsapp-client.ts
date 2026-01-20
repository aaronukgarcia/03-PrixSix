import { Client, LocalAuth, RemoteAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { AzureBlobStore } from './azure-store';
import * as path from 'path';

// Detect if running on Windows (local dev) vs Linux (Azure container)
const isWindows = process.platform === 'win32';

// Use Azure Blob Storage in production (when connection string is set)
const useAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

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

export class WhatsAppClient {
  private client: Client;
  private isReady: boolean = false;
  private azureStore: AzureBlobStore | null = null;
  private qrCodeData: string | null = null;

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

  private setupEventHandlers(): void {
    // QR Code event - display in terminal/logs for initial setup
    this.client.on('qr', (qr: string) => {
      this.qrCodeData = qr;
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
      console.log('✅ WhatsApp client is ready!');

      // Log connection info
      try {
        console.log('📱 Connected as:', this.client.info?.pushname);
      } catch (error) {
        console.error('Error getting client info:', error);
      }
    });

    // Authentication events
    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated');
    });

    this.client.on('auth_failure', (message: string) => {
      console.error('❌ Authentication failed:', message);
      this.isReady = false;
    });

    // Remote session saved (Azure backup)
    this.client.on('remote_session_saved', () => {
      console.log('☁️ Session backed up to Azure Blob Storage');
    });

    // Disconnection handling
    this.client.on('disconnected', async (reason: string) => {
      console.log('⚠️ WhatsApp disconnected:', reason);
      this.isReady = false;

      // Auto-reconnect after delay
      setTimeout(() => {
        console.log('🔄 Attempting to reconnect...');
        this.initialize();
      }, 10000);
    });

    // Message received (for debugging)
    this.client.on('message', (message: Message) => {
      console.log(`📨 Message from ${message.from}: ${message.body.substring(0, 50)}...`);
    });
  }

  async initialize(): Promise<void> {
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

  getStatus(): { ready: boolean; qrCode: string | null; storage: string } {
    return {
      ready: this.isReady,
      qrCode: this.qrCodeData,
      storage: useAzureStorage ? 'azure' : 'local',
    };
  }

  async getGroups(): Promise<Array<{ id: string; name: string }>> {
    if (!this.isReady) return [];

    const chats = await this.client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
  }
}
