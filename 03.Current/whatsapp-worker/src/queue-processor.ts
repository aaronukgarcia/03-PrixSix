import { getFirestore } from './firebase-config';
import { WhatsAppClient } from './whatsapp-client';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

interface QueueMessage {
  id: string;
  chatId?: string;
  groupName?: string;
  message: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  createdAt: Timestamp;
  processedAt?: Timestamp;
  error?: string;
  retryCount?: number;
}

export class QueueProcessor {
  private db: Firestore;
  private whatsapp: WhatsAppClient;
  private isProcessing: boolean = false;
  private unsubscribe: (() => void) | null = null;

  // Rate limiting
  private lastMessageTime: number = 0;
  private readonly MIN_DELAY_MS = 5000; // 5 seconds between messages
  private readonly MAX_DELAY_MS = 10000; // 10 seconds max delay
  private readonly MAX_RETRIES = 3;

  constructor(whatsapp: WhatsAppClient) {
    this.db = getFirestore();
    this.whatsapp = whatsapp;
  }

  /**
   * Start listening to the queue collection
   */
  startListening(): void {
    console.log('👂 Starting queue listener...');

    const queueRef = this.db
      .collection('whatsapp_queue')
      .where('status', '==', 'PENDING')
      .orderBy('createdAt', 'asc');

    this.unsubscribe = queueRef.onSnapshot(
      async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === 'added') {
            const doc = change.doc;
            const data = doc.data() as Omit<QueueMessage, 'id'>;
            const message: QueueMessage = { id: doc.id, ...data };

            console.log(`📥 New message in queue: ${message.id}`);
            await this.processMessage(message);
          }
        }
      },
      (error) => {
        console.error('❌ Queue listener error:', error);
        // Attempt to restart listener after delay
        setTimeout(() => this.startListening(), 5000);
      }
    );

    console.log('✅ Queue listener started');
  }

  /**
   * Stop listening to the queue
   */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      console.log('🛑 Queue listener stopped');
    }
  }

  /**
   * Process a single message from the queue
   */
  private async processMessage(message: QueueMessage): Promise<void> {
    // Skip if already being processed
    if (this.isProcessing) {
      console.log(`⏳ Queue busy, will process ${message.id} later`);
      return;
    }

    this.isProcessing = true;
    const docRef = this.db.collection('whatsapp_queue').doc(message.id);

    try {
      // Mark as processing
      await docRef.update({
        status: 'PROCESSING',
        processedAt: Timestamp.now(),
      });

      // Apply rate limiting
      await this.applyRateLimit();

      // Send the message
      let success = false;

      if (message.groupName) {
        success = await this.whatsapp.sendToGroup(message.groupName, message.message);
      } else if (message.chatId) {
        success = await this.whatsapp.sendMessage(message.chatId, message.message);
      } else {
        throw new Error('No chatId or groupName specified');
      }

      if (success) {
        // Mark as sent
        await docRef.update({
          status: 'SENT',
          processedAt: Timestamp.now(),
        });
        console.log(`✅ Message ${message.id} sent successfully`);
      } else {
        throw new Error('Message send returned false');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const retryCount = (message.retryCount || 0) + 1;

      console.error(`❌ Failed to process message ${message.id}:`, errorMessage);

      if (retryCount < this.MAX_RETRIES) {
        // Mark for retry
        await docRef.update({
          status: 'PENDING',
          error: errorMessage,
          retryCount,
        });
        console.log(`🔄 Will retry message ${message.id} (attempt ${retryCount}/${this.MAX_RETRIES})`);
      } else {
        // Mark as failed permanently
        await docRef.update({
          status: 'FAILED',
          error: errorMessage,
          retryCount,
          processedAt: Timestamp.now(),
        });
        console.log(`❌ Message ${message.id} failed permanently after ${this.MAX_RETRIES} attempts`);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Apply rate limiting between messages
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;

    if (timeSinceLastMessage < this.MIN_DELAY_MS) {
      // Random delay between MIN and MAX to appear more human
      const delay = this.MIN_DELAY_MS + Math.random() * (this.MAX_DELAY_MS - this.MIN_DELAY_MS);
      const waitTime = delay - timeSinceLastMessage;

      console.log(`⏱️ Rate limiting: waiting ${Math.round(waitTime / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastMessageTime = Date.now();
  }

  /**
   * Manually process all pending messages (for testing)
   */
  async processAllPending(): Promise<void> {
    const snapshot = await this.db
      .collection('whatsapp_queue')
      .where('status', '==', 'PENDING')
      .orderBy('createdAt', 'asc')
      .get();

    console.log(`📋 Found ${snapshot.size} pending messages`);

    for (const doc of snapshot.docs) {
      const data = doc.data() as Omit<QueueMessage, 'id'>;
      const message: QueueMessage = { id: doc.id, ...data };
      await this.processMessage(message);
    }
  }
}
