// GUID: QUEUE_PROCESSOR-000-v05
// @BUG_FIX (v04, cold-start false-SENT — 2026-06-20): before sending, await whatsapp.waitForStable()
// so a message is only relayed once the socket has settled (continuously open >=15s + a successful
// query). Without this, a message relayed on a just-opened socket resolves locally (marked SENT) but
// may never reach WhatsApp — the reported "7am + prediction didn't arrive" symptom. If the connection
// can't stabilise, the send is treated as a failure and retried (PENDING) rather than fake-SENT.
// @FEATURE (v05, 2026-06-26): EVERY outgoing message gets a unique trace suffix "Bill#<n>" (auto-
// incrementing, seeded at 98765). This is enforced here — the single chokepoint all messages pass
// through — so the tag is guaranteed regardless of source (alerts, 7am, ad-hoc). The number is
// allocated once per doc (stored as messageNumber) and reused on retry so it stays stable.
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
  messageNumber?: number; // assigned once on first send; reused on retry (see v05)
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

  // Trace-suffix (v05): every message ends with "Bill#<n>". Counter seeded so the first is Bill#98765.
  private readonly MESSAGE_TAG = 'Bill';
  private readonly MESSAGE_NUMBER_SEED = 98765;

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

      // Wait for a genuinely stable connection before sending (v04 cold-start false-SENT fix).
      // If it can't stabilise, fail fast → the catch below retries (PENDING) instead of fake-SENT.
      const stable = await this.whatsapp.waitForStable();
      if (!stable) {
        throw new Error('Connection not stable — deferring send to avoid false-SENT');
      }

      // Apply rate limiting
      await this.applyRateLimit();

      // Assign a stable trace number once per doc (reused on retry), then append "Bill#<n>" to EVERY
      // outgoing message. Enforced here so no source can bypass it.
      let messageNumber = message.messageNumber;
      if (typeof messageNumber !== 'number') {
        messageNumber = await this.allocateMessageNumber();
        await docRef.update({ messageNumber });
      }
      const outgoing = `${message.message}\n\n${this.MESSAGE_TAG}#${messageNumber}`;

      // Send the message
      let success = false;

      if (message.groupName) {
        success = await this.whatsapp.sendToGroup(message.groupName, outgoing);
      } else if (message.chatId) {
        success = await this.whatsapp.sendMessage(message.chatId, outgoing);
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
   * Allocate the next global message trace number atomically (admin_configuration/messageCounter.next).
   * Seeded so the first allocation returns MESSAGE_NUMBER_SEED (98765). Transaction-safe against the
   * (single) worker; persisted so numbers survive restarts.
   */
  private async allocateMessageNumber(): Promise<number> {
    const counterRef = this.db.collection('admin_configuration').doc('messageCounter');
    return this.db.runTransaction(async (t) => {
      const snap = await t.get(counterRef);
      const next = snap.exists && typeof snap.data()!.next === 'number'
        ? (snap.data()!.next as number)
        : this.MESSAGE_NUMBER_SEED;
      t.set(counterRef, { next: next + 1, updatedAt: Timestamp.now() }, { merge: true });
      return next;
    });
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
