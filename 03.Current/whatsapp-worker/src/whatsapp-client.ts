import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { FirebaseSessionStore } from './firebase-store';

// Puppeteer args for containerized environments
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process', // Important for containers
  '--disable-gpu',
  '--disable-extensions',
  '--disable-software-rasterizer',
];

export class WhatsAppClient {
  private client: Client;
  private isReady: boolean = false;
  private sessionStore: FirebaseSessionStore;
  private qrCodeData: string | null = null;

  constructor() {
    this.sessionStore = new FirebaseSessionStore();

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'prixsix-whatsapp',
        dataPath: '/tmp/.wwebjs_auth', // Use /tmp for ephemeral storage
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: PUPPETEER_ARGS,
      },
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
        return false;
      }

      await group.sendMessage(message);
      console.log(`✅ Message sent to group "${group.name}"`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send message to group "${groupName}":`, error);
      return false;
    }
  }

  getStatus(): { ready: boolean; qrCode: string | null } {
    return {
      ready: this.isReady,
      qrCode: this.qrCodeData,
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
