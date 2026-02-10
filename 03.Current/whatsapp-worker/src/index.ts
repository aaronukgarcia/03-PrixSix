import 'dotenv/config';
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

// SECURITY: Authentication middleware for sensitive endpoints (WHATSAPP-002 fix)
// Verifies WORKER_API_KEY is set and matches the request header
function requireAuth(req: Request, res: Response, next: Function) {
  const apiKey = process.env.WORKER_API_KEY;

  if (!apiKey) {
    console.error('WORKER_API_KEY environment variable is not set');
    res.status(500).json({ error: 'Server misconfigured: API key not set' });
    return;
  }

  const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (providedKey !== apiKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
}

// Health check endpoint
// SECURITY: Protected with authentication (WHATSAPP-002 fix)
app.get('/health', requireAuth, (req: Request, res: Response) => {
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
// SECURITY: Protected with authentication (WHATSAPP-002 fix)
app.get('/status', requireAuth, async (req: Request, res: Response) => {
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
// SECURITY: CRITICAL - Protected with authentication to prevent session hijacking (WHATSAPP-002 fix)
app.get('/qr', requireAuth, (req: Request, res: Response) => {
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
// SECURITY: Protected with authentication (WHATSAPP-002 fix)
app.post('/ping', requireAuth, async (req: Request, res: Response) => {
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

// Manual trigger endpoint (for testing)
app.post('/trigger-test', async (req: Request, res: Response) => {
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

// NEW: Process queue endpoint for Container Apps scale-to-zero
// This endpoint is called when a message is queued, triggering scale-up
// SECURITY: Protected with authentication (WHATSAPP-002 fix - consolidated with requireAuth middleware)
app.post('/process-queue', requireAuth, async (req: Request, res: Response) => {
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
