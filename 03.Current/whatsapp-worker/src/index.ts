// GUID: WHATSAPP_WORKER_INDEX-000-v03
import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { initializeFirebase } from './firebase-config';
import { WhatsAppClient } from './whatsapp-client';
import { QueueProcessor } from './queue-processor';

const app = express();
const PORT = process.env.PORT || 3000;

// Add JSON body parser for webhook
app.use(express.json());

let whatsappClient: WhatsAppClient;
let queueProcessor: QueueProcessor;

// GUID: WHATSAPP_WORKER-000-v01
// [Intent] HMAC SHA-256 authentication middleware — verifies that incoming requests originate
//          from the trusted Next.js proxy by checking the X-Hub-Signature-256 header.
//          The proxy signs the endpoint name (path without leading slash) with WHATSAPP_APP_SECRET.
//          Uses timing-safe comparison (GR#11) to prevent oracle attacks.
// [Inbound Trigger] Applied to all sensitive endpoints (/status, /qr, /ping, /process-queue, /trigger-test).
//                   /health is intentionally left public for Docker HEALTHCHECK and the admin health monitor.
// [Downstream Impact] Rejects any request that lacks or presents an invalid HMAC signature with 401.
//                     Requests from outside the proxy will always fail this check.
function verifyHmacSignature(req: Request, res: Response, next: Function) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error('[auth] WHATSAPP_APP_SECRET is not set');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: 'Unauthorized: Missing signature' });
    return;
  }

  // The proxy signs the endpoint name — path without leading slash (e.g. "status", "qr", "ping")
  const endpoint = req.path.slice(1);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(endpoint).digest('hex')}`;

  // Timing-safe comparison to prevent length/timing oracle attacks (GR#11)
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: 'Unauthorized: Invalid signature' });
    return;
  }

  next();
}

// Health check endpoint — intentionally PUBLIC (no auth)
// Docker HEALTHCHECK and the admin health monitor route both call /health without credentials.
// This endpoint returns no sensitive data; full status with QR requires /status (authenticated).
app.get('/health', (req: Request, res: Response) => {
  const status = whatsappClient?.getStatus() || {
    ready: false,
    qrCode: null,
    storage: 'unknown',
    lastSuccessfulPing: null,
    consecutiveFailures: 0,
  };

  res.json({
    status: 'ok',
    whatsapp: {
      connected: status.ready,
      awaitingQR: !!status.qrCode,
      storage: status.storage,
      lastSuccessfulPing: status.lastSuccessfulPing,
      consecutiveFailures: status.consecutiveFailures,
    },
    timestamp: new Date().toISOString(),
  });
});

// Status endpoint with more details
app.get('/status', verifyHmacSignature, async (req: Request, res: Response) => {
  const status = whatsappClient?.getStatus() || {
    ready: false,
    qrCode: null,
    storage: 'unknown',
    lastSuccessfulPing: null,
    consecutiveFailures: 0,
  };

  let groups: Array<{ id: string; name: string }> = [];
  if (status.ready) {
    try {
      groups = await whatsappClient.getGroups();
    } catch (e) {
      console.error('Error getting groups:', e);
    }
  }

  // Calculate time since last ping
  const lastPingAgo = status.lastSuccessfulPing
    ? Math.round((Date.now() - new Date(status.lastSuccessfulPing).getTime()) / 1000)
    : null;

  res.json({
    status: 'ok',
    whatsapp: {
      connected: status.ready,
      awaitingQR: !!status.qrCode,
      storage: status.storage,
      groups: groups.map(g => g.name),
      keepAlive: {
        lastSuccessfulPing: status.lastSuccessfulPing,
        lastPingSecondsAgo: lastPingAgo,
        consecutiveFailures: status.consecutiveFailures,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// QR Code endpoint (for remote setup)
// SECURITY: CRITICAL - Protected with HMAC signature to prevent session hijacking
app.get('/qr', verifyHmacSignature, (req: Request, res: Response) => {
  const status = whatsappClient?.getStatus();

  if (!status?.qrCode) {
    res.status(404).json({
      error: 'No QR code available',
      reason: status?.ready ? 'Already authenticated' : 'Initializing...',
    });
    return;
  }

  // Return QR code as text (can be scanned from logs or rendered)
  res.type('text/plain').send(status.qrCode);
});

// Manual ping endpoint (for testing keep-alive)
app.post('/ping', verifyHmacSignature, async (req: Request, res: Response) => {
  const status = whatsappClient?.getStatus();

  if (!status?.ready) {
    res.status(503).json({ error: 'WhatsApp not ready' });
    return;
  }

  try {
    const pingResult = await whatsappClient.forceKeepAlivePing();
    res.json({
      success: pingResult.success,
      state: pingResult.state,
      error: pingResult.error,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Manual trigger endpoint (for testing) — SECURITY: auth was missing, now protected
app.post('/trigger-test', verifyHmacSignature, async (req: Request, res: Response) => {
  const status = whatsappClient?.getStatus();

  if (!status?.ready) {
    res.status(503).json({ error: 'WhatsApp not ready' });
    return;
  }

  try {
    const groups = await whatsappClient.getGroups();
    res.json({
      message: 'WhatsApp is ready',
      groups: groups.map(g => ({ id: g.id, name: g.name })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Process queue endpoint for Container Apps scale-to-zero
// This endpoint is called when a message is queued, triggering scale-up
app.post('/process-queue', verifyHmacSignature, async (req: Request, res: Response) => {
  console.log('📬 Received request to process queue');

  const status = whatsappClient?.getStatus();

  if (!status?.ready) {
    // WhatsApp not ready yet - queue will be processed once ready
    res.json({
      message: 'WhatsApp initializing, queue will be processed when ready',
      status: 'pending',
    });
    return;
  }

  try {
    // Process all pending messages
    await queueProcessor.processAllPending();
    res.json({
      message: 'Queue processing triggered',
      status: 'success',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error processing queue:', error);
    res.status(500).json({
      error: error.message,
      status: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

async function main() {
  console.log('🏎️ Prix Six WhatsApp Worker Starting...');
  console.log('='.repeat(50));

  // Initialize Firebase
  initializeFirebase();

  // Start Express server first (for health checks)
  app.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
  });

  // Initialize WhatsApp client
  whatsappClient = new WhatsAppClient();

  // Initialize queue processor
  queueProcessor = new QueueProcessor(whatsappClient);

  // Start WhatsApp client
  await whatsappClient.initialize();

  // Wait for WhatsApp to be ready before processing queue
  const waitForReady = (): Promise<void> => {
    return new Promise((resolve) => {
      const checkReady = setInterval(() => {
        const status = whatsappClient.getStatus();
        if (status.ready) {
          clearInterval(checkReady);
          resolve();
        }
      }, 1000);
    });
  };

  console.log('⏳ Waiting for WhatsApp to be ready...');
  await waitForReady();

  // Start queue listener
  queueProcessor.startListening();

  console.log('='.repeat(50));
  console.log('✅ Prix Six WhatsApp Worker is running!');
  console.log('='.repeat(50));
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  queueProcessor?.stopListening();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  queueProcessor?.stopListening();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
