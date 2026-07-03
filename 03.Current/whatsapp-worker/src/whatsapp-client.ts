// GUID: WHATSAPP_CLIENT-000-v07
// [Intent] WhatsApp client wrapper using Baileys (WebSocket protocol, no Puppeteer/Chromium).
//          Drop-in replacement for the whatsapp-web.js based client — same public interface.
// [Inbound Trigger] Instantiated by index.ts at server startup.
// [Downstream Impact] Provides sendMessage, sendToGroup, getStatus, getGroups, waitForStable for
//                     queue-processor and Express endpoints. Logs status changes to Firestore.
//
// @BUG_FIX (v07, self-inflicted rate-overlimit query storm — 2026-07-03): WhatsApp began returning
// `rate-overlimit` on sends (7am Hot News + submission notices silently FAILED / needed retries), and
// it degraded with socket uptime — worst since minReplicas:1 keep-warm (v3.2.8) made the socket
// persist for days. ROOT CAUSE: groupFetchAllParticipating() — a heavyweight, WhatsApp-rate-limited IQ
// query — was used as a general primitive on THREE hot paths, uncached: (a) the keep-alive ping every
// 180s, (b) waitForStable() before EVERY send, (c) sendToGroup() to resolve the group JID on EVERY
// send + retry. On an always-on socket those IQ queries accumulate against the account's rate limit
// until WhatsApp throttles; then the keep-alive's own 3-strikes-→-reconnect handler tore down a
// healthy socket, whose reconnect fired MORE init-queries — a self-reinforcing spiral. FIX:
//   1. Cache the group JID (resolveGroupJid + jidCache) — sendToGroup does ONE groupFetch on the first
//      send after (re)connect, then reuses the JID. Group JIDs are permanent, so the cache survives
//      reconnects. Removes a groupFetch from every steady-state send.
//   2. waitForStable() no longer runs groupFetch as its probe — it time-gates (continuously open >=
//      STABILIZE_MS) + checks sock.user. The first send's resolveGroupJid still does a real query, so
//      the cold-start false-SENT guard (v05) is preserved for that first send, then the socket is warm.
//   3. Keep-alive is now a LIGHTWEIGHT in-memory liveness check (sock.user + WS readyState), no IQ
//      query, and a `rate-overlimit`-class failure is NOT treated as a dead socket. Real disconnects
//      still arrive via connection.update 'close', which handles reconnect. Net effect: IQ-query volume
//      drops ~10-20x, so the always-on socket stops accumulating the throttle and keep-warm can stay.
// FOLLOW-UP (not in v07): queue-processor retries re-fire immediately (3 in ~14s) with no backoff; a
// rate-overlimit-aware backoff belongs there, but it interacts with the fragile isProcessing single-
// flight (which drops concurrent messages) so it was deferred to avoid a regression in the queue model.
//
// @BUG_FIX (v06, SELF-INFLICTED connectionReplaced storm — 2026-06-26): the flap that "looked like a
// second device" was the worker fighting ITS OWN orphaned sockets. connectSocket() created a new
// Baileys socket WITHOUT ending the previous one, and TWO paths (the connection 'close' handler AND
// the keep-alive 3-fail handler) each scheduled a reconnect with no single-flight guard. After any
// disconnect (WhatsApp restartRequired/timedOut), a scheduled reconnect spun up a 2nd socket on the
// same creds → connectionReplaced → which scheduled ANOTHER reconnect → a self-perpetuating ~10s
// (== RECONNECT_DELAY_MS) storm. FIX: (1) scheduleReconnect() single-flight guard so only one
// reconnect is ever pending; (2) connectSocket() tears down the old socket (removeAllListeners + end)
// before creating a new one, so two sockets never run on the same credentials. The earlier
// "external competitor / re-pair" theory was a dead end (Azure swept clean, flap period == our own
// reconnect timer).
//
// @BUG_FIX (v05, cold-start false-SENT — 2026-06-20): the connection reports `isReady` the instant
// Baileys' socket opens, but the socket isn't yet usable — its init-queries window is still settling
// (we observe `getUSyncDevices` 408 timeouts right after open). A queued message relayed in that
// window resolves locally (marked SENT) but WhatsApp may never receive it — the reported "7am +
// prediction didn't arrive" symptom. FIX: waitForStable() — only treat the connection as send-ready
// once it has been continuously OPEN for STABILIZE_MS *and* a real query (groupFetchAllParticipating)
// succeeds. queue-processor awaits this before every send. A reconnect resets the timer. This is the
// same settle the 7am Cloud Function does via warmAndWaitReady, now applied to ALL queued messages.

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
  // Single-flight reconnect guard (v06): true while a reconnect timer is pending, so the 'close'
  // handler and the keep-alive-fail handler can never schedule two overlapping reconnects.
  private reconnecting: boolean = false;
  private groupNameCache: Map<string, string> = new Map();
  // v07: cache of lowercased group-name search term -> resolved group JID. Group JIDs are permanent,
  // so this survives reconnects and eliminates a groupFetchAllParticipating() on every steady-state
  // send. Invalidated for a specific entry only if a send to that cached JID throws (stale JID).
  private jidCache: Map<string, string> = new Map();
  // Timestamp (ms) of the most recent successful 'open'. Reset to null on close. Used by
  // waitForStable() to require the socket has been continuously open long enough to settle.
  private readyAt: number | null = null;
  // How long the connection must be continuously open before we trust it for sends (see v05 @BUG_FIX).
  private readonly STABILIZE_MS = 15000;

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
    // A reconnect (if one was pending) is now being consumed — clear the guard so a future
    // disconnect can schedule the NEXT one, but not until then.
    this.reconnecting = false;

    // Tear down any previous socket BEFORE creating a new one, so we never run two sockets on the
    // same credentials (that self-replacement is the v06 connectionReplaced storm). Remove listeners
    // first so the old socket's 'close' can't fire our handler and schedule yet another reconnect.
    if (this.sock) {
      try { (this.sock.ev as any).removeAllListeners(); } catch { /* ignore */ }
      try { this.sock.end(undefined as any); } catch { /* ignore */ }
      this.sock = null;
    }

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
        this.readyAt = Date.now(); // start the stabilization clock (see waitForStable)
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
        this.readyAt = null; // reset the stabilization clock; next 'open' restarts the settle
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

        // Auto-reconnect for all other disconnect reasons (single-flight — see scheduleReconnect).
        if (this.shouldReconnect) {
          await this.logStatusChange('reconnecting', { afterReason: reason });
          this.scheduleReconnect(reason);
        }
      }
    });

    // Incoming messages — log Prix6.Win group messages to Firestore
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
          if (!text) continue;

          const remoteJid = msg.key.remoteJid || '';
          console.log(`📨 Message from ${remoteJid}: ${text.substring(0, 50)}...`);

          // Log Prix6.Win group messages to Firestore (fire-and-forget)
          if (remoteJid.endsWith('@g.us')) {
            this.logGroupMessage(remoteJid, msg.key.participant || '', text).catch(() => {});
          }
        }
      }
    });
  }

  /**
   * Schedule a single reconnect after RECONNECT_DELAY_MS. Single-flight: if a reconnect is already
   * pending (this.reconnecting), do nothing — this is what prevents the 'close' handler and the
   * keep-alive-fail handler from each spawning a socket and triggering the connectionReplaced storm.
   * The guard is cleared at the top of connectSocket() when the pending reconnect actually runs.
   */
  private scheduleReconnect(reason: string): void {
    if (!this.shouldReconnect) return;
    if (this.reconnecting) {
      console.log(`↩️  Reconnect already pending — ignoring duplicate trigger (${reason})`);
      return;
    }
    this.reconnecting = true;
    console.log(`🔄 Reconnecting in ${RECONNECT_DELAY_MS / 1000}s... (${reason})`);
    setTimeout(() => this.connectSocket().catch(e => console.error('Reconnect failed:', e?.message)), RECONNECT_DELAY_MS);
  }

  /**
   * Wait until the connection is genuinely send-ready: continuously OPEN for at least STABILIZE_MS
   * with an authenticated socket (sock.user set). Resolves true when stable, false if it can't
   * stabilise within timeoutMs. Called by the queue-processor before every send to avoid the
   * cold-start false-SENT (a relay on a just-opened, not-yet-settled socket that resolves locally but
   * never reaches WhatsApp). A reconnect resets readyAt, so this re-waits the full settle.
   *
   * v07: previously this probed with groupFetchAllParticipating() — a rate-limited IQ query — on every
   * send, a major driver of the rate-overlimit throttle. The STABILIZE_MS time-gate already clears the
   * post-open settle window (the getUSyncDevices 408s occur in the first few seconds), and the first
   * send's resolveGroupJid() still issues ONE real query, so the false-SENT guard is preserved for the
   * first send while steady-state sends no longer each pay an IQ query here.
   */
  async waitForStable(timeoutMs: number = 90000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        this.isReady && this.sock && this.sock.user &&
        this.readyAt !== null && (Date.now() - this.readyAt) >= this.STABILIZE_MS
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.error(`❌ waitForStable: connection did not stabilise within ${timeoutMs / 1000}s`);
    return false;
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
   * Resolve a group name (case-insensitive substring match) to its permanent JID, caching the result.
   * v07: this is the ONLY steady-state caller of groupFetchAllParticipating() on the send path, and it
   * runs it at most once per group per (re)connect — a cache hit on every subsequent send. Populates
   * groupNameCache (jid -> subject) as a side effect so inbound logging benefits too.
   */
  private async resolveGroupJid(groupName: string): Promise<string | null> {
    const searchName = groupName.toLowerCase();
    const cached = this.jidCache.get(searchName);
    if (cached) return cached;
    if (!this.sock) return null;

    const groups = await this.sock.groupFetchAllParticipating();
    for (const [jid, data] of Object.entries(groups)) {
      this.groupNameCache.set(jid, data.subject);
    }
    const match = Object.entries(groups).find(([, data]) =>
      data.subject.toLowerCase().includes(searchName)
    );
    if (!match) {
      const available = Object.values(groups).map(g => g.subject);
      console.error(`❌ Group "${groupName}" not found. Available groups:`, available);
      return null;
    }
    this.jidCache.set(searchName, match[0]);
    return match[0];
  }

  /**
   * Send a message to a WhatsApp group by name (case-insensitive substring match).
   * v07: resolves the JID via the cache (one groupFetch per (re)connect, not per send). If a send to a
   * cached JID throws, the cache entry is invalidated so the next attempt re-resolves it.
   */
  async sendToGroup(groupName: string, message: string): Promise<boolean> {
    if (!this.isReady || !this.sock) {
      console.error('❌ Cannot send to group — WhatsApp not ready');
      return false;
    }

    try {
      const groupJid = await this.resolveGroupJid(groupName);
      if (!groupJid) return false;

      try {
        await this.sock.sendMessage(groupJid, { text: message });
      } catch (sendErr) {
        // A cached JID could (rarely) be stale — drop it so the next retry re-resolves fresh.
        this.jidCache.delete(groupName.toLowerCase());
        throw sendErr;
      }
      console.log(`✅ Message sent to group "${groupName}" (${groupJid})`);
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

    // v07: LIGHTWEIGHT liveness only — NO groupFetchAllParticipating() (that IQ query was the main
    // driver of the rate-overlimit throttle). Baileys keeps the WS alive itself and emits
    // connection.update 'close' on real disconnects (which drives reconnect). Here we merely observe
    // the socket: an authenticated user + an OPEN WebSocket means healthy. A throttle (rate-overlimit)
    // is NOT a dead socket, so it must never trigger a reconnect the way the old query-failure path did.
    const ws: any = (this.sock as any).ws;
    const wsState = ws?.readyState;
    const wsOpen = wsState === undefined ? true : (wsState === 1 /* WebSocket.OPEN */);
    const connected = !!this.sock.user && wsOpen;

    if (connected) {
      this.lastSuccessfulPing = new Date();
      this.consecutiveFailures = 0;

      // Log to Firestore ~10% of the time to reduce spam
      if (Math.random() < 0.1) {
        await this.logStatusChange('keep_alive_ping', {
          state: 'CONNECTED',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // Not connected at the socket level — this is a genuine liveness problem, not a rate limit.
    this.consecutiveFailures++;
    console.warn(`⚠️ Keep-alive: socket not healthy (user=${!!this.sock.user}, wsState=${wsState}) — failure ${this.consecutiveFailures}`);
    await this.logStatusChange('keep_alive_fail', {
      error: `socket not healthy (wsState=${wsState})`,
      consecutiveFailures: this.consecutiveFailures,
    });

    // After 3 consecutive genuinely-unhealthy checks, force a reconnect (single-flight guarded).
    if (this.consecutiveFailures >= 3) {
      console.warn('⚠️ 3+ consecutive unhealthy keep-alive checks — reconnecting...');
      this.isReady = false;
      this.stopKeepAlive();
      await this.logStatusChange('reconnecting', { afterReason: '3+ unhealthy keep-alive checks' });
      this.scheduleReconnect('3+ unhealthy keep-alive checks');
    }
  }

  /**
   * Log an inbound group message to Firestore (whatsapp_messages collection).
   * Only logs messages from the target group (Prix6.Win) to avoid noise.
   */
  private async logGroupMessage(groupJid: string, participant: string, text: string): Promise<void> {
    try {
      // Only log messages from the target group
      const targetGroup = (process.env.WHATSAPP_GROUP_NAME || 'Prix6.Win').toLowerCase();

      // Resolve group name (cache after first lookup)
      if (!this.groupNameCache.has(groupJid) && this.sock) {
        try {
          const groups = await this.sock.groupFetchAllParticipating();
          for (const [jid, data] of Object.entries(groups)) {
            this.groupNameCache.set(jid, data.subject);
          }
        } catch { /* non-critical */ }
      }

      const groupName = this.groupNameCache.get(groupJid) || '';
      if (!groupName.toLowerCase().includes(targetGroup)) return;

      const db = getFirestore();
      await db.collection('whatsapp_messages').add({
        groupJid,
        groupName,
        participant,
        text: text.substring(0, 2000),
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to log group message:', error);
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
