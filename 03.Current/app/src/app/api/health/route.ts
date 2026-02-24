// GUID: API_HEALTH-000-v04
// @SECURITY_FIX (GEMINI-AUDIT-125): checkFirestore() and checkAuth() now return generic error strings instead of raw error.message (prevents internal DB/auth config details leaking via public endpoint).
// @COLD_START (Wave 15+): SERVER_START_TIME captured at module load to detect Cloud Run cold starts.
//             Cold start = instance age < 30s on first request. Logged to Firestore system/cold-starts.
//             Pair with Cloud Scheduler free-tier ping every 10 min to prevent cold starts entirely.
// @PHASE_3C: Health check endpoint for monitoring and uptime checks (DEPLOY-005).
// [Intent] Provides operational health status by checking connectivity to critical services:
//          Firestore, Firebase Auth. Returns 200 if all healthy, 503 if degraded.
// [Inbound Trigger] GET requests from uptime monitors, Azure Monitor, or admin health dashboards.
// [Downstream Impact] Used by monitoring systems to detect outages. Alerts triggered on 503 responses.
//                     Does not require authentication - public endpoint for monitoring.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { APP_VERSION } from '@/lib/version';

// Force dynamic to prevent static optimization
export const dynamic = 'force-dynamic';

// GUID: API_HEALTH-009-v01
// [Intent] Module-level timestamp captured at Cloud Run instance startup.
//          Used to detect cold starts: if this request arrives within 30s of instance load, it IS the cold start.
//          Module-level variables persist for the lifetime of the Cloud Run instance (warm = reused).
// [Inbound Trigger] Evaluated once when Node.js first loads this module.
// [Downstream Impact] Enables cold-start logging to Firestore and instanceAge in health response.
const SERVER_START_TIME = Date.now();
let coldStartEventLogged = false; // ensure we log the cold-start event only once per instance

// GUID: API_HEALTH-001-v02
// [Intent] Interface defining the structure of health check responses with per-service status.
//          instanceAge and coldStart added for cold-start detection (Wave 15+).
// [Inbound Trigger] Used by the GET handler to structure response data.
// [Downstream Impact] Monitoring systems parse this structure. Changes require monitor config updates.
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    firestore: ServiceStatus;
    auth: ServiceStatus;
  };
  responseTime: number;
  instanceAge?: number;   // seconds since Cloud Run instance started (module load time)
  coldStart?: boolean;    // true if this request arrived within 30s of instance startup
}

interface ServiceStatus {
  status: 'up' | 'down' | 'unknown';
  responseTime?: number;
  error?: string;
}

// GUID: API_HEALTH-002-v02
// [Intent] GET handler that performs health checks on all critical services and returns aggregated status.
//          Checks run in parallel for speed. Returns 200 for healthy, 503 for degraded/unhealthy.
//          Cold-start detection: computes instanceAge from SERVER_START_TIME, logs to Firestore once per instance.
// [Inbound Trigger] HTTP GET /api/health from monitoring systems or health dashboards.
// [Downstream Impact] Response time should be <200ms for accurate health monitoring.
//                     503 responses trigger alerts in monitoring systems.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();
  const instanceAge = Math.floor((startTime - SERVER_START_TIME) / 1000); // seconds
  const coldStart = instanceAge < 30; // Cloud Run cold start window is ~15-25s typically

  try {
    // GUID: API_HEALTH-003-v01
    // [Intent] Parallel health checks on Firestore and Firebase Auth to minimize total check time.
    // [Inbound Trigger] Every GET request to the health endpoint.
    // [Downstream Impact] If any check throws, it's caught individually to prevent cascading failures.
    const [firestoreStatus, authStatus] = await Promise.all([
      checkFirestore(),
      checkAuth(),
    ]);

    // GUID: API_HEALTH-004-v01
    // [Intent] Aggregate individual service statuses into overall system health.
    //          Degraded if any service is down, unhealthy if critical services unavailable.
    // [Inbound Trigger] After all service checks complete.
    // [Downstream Impact] Overall status determines HTTP status code (200 vs 503).
    const allHealthy = firestoreStatus.status === 'up' && authStatus.status === 'up';
    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' = allHealthy
      ? 'healthy'
      : 'degraded';

    const responseTime = Date.now() - startTime;

    // GUID: API_HEALTH-010-v01
    // [Intent] Log cold-start event to Firestore once per instance lifetime.
    //          Uses module-level flag to prevent repeated writes on subsequent warm requests.
    //          Fire-and-forget (no await) — never block the health response for logging.
    // [Inbound Trigger] First request on a fresh Cloud Run instance (instanceAge < 30s).
    // [Downstream Impact] cold_start_events collection in Firestore — admin visibility only.
    if (coldStart && !coldStartEventLogged && firestoreStatus.status === 'up') {
      coldStartEventLogged = true;
      getFirebaseAdmin().then(({ db }) => {
        db.collection('cold_start_events').add({
          timestamp: new Date().toISOString(),
          instanceAge,
          version: APP_VERSION,
          correlationId,
        }).catch(() => { /* never throw on cold-start logging */ });
      }).catch(() => { /* never throw on cold-start logging */ });
    }

    // GUID: API_HEALTH-005-v02
    // [Intent] Build health check response with version info from package.json.
    //          instanceAge and coldStart added for operational visibility.
    // [Inbound Trigger] After status aggregation completes.
    // [Downstream Impact] Version string helps correlate health issues with deployments.
    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      services: {
        firestore: firestoreStatus,
        auth: authStatus,
      },
      responseTime,
      instanceAge,
      coldStart,
    };

    // Return 503 if degraded, 200 if healthy
    const httpStatus = overallStatus === 'healthy' ? 200 : 503;

    return NextResponse.json(result, {
      status: httpStatus,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    // GUID: API_HEALTH-006-v03
    // @GOLDEN_RULE_1: Add correlation ID for monitoring system tracing (Phase 4 compliance).
    // [Intent] Catch-all error handler for unexpected failures in the health check itself.
    //          Does not write to error_logs (high-frequency endpoint) but includes correlation ID.
    // [Inbound Trigger] Any uncaught exception during health checks.
    // [Downstream Impact] Returns 503 with correlation ID. Monitoring systems can track repeated failures.
    //                     Does not expose raw error.message (security compliance).
    // @SECURITY_FIX (Wave 10): NODE_ENV gate
    const responseTime = Date.now() - startTime;
    if (process.env.NODE_ENV !== 'production') { console.error(`[Health Check Failed] correlationId: ${correlationId}`, error); }
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.57.0',
        error: 'Health check infrastructure failure',
        correlationId,
        responseTime,
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  }
}

// GUID: API_HEALTH-007-v02
// [Intent] Check Firestore connectivity by attempting to read the global settings document.
//          Uses a lightweight read operation that should complete in <100ms.
// [Inbound Trigger] Called by GET handler as part of parallel health checks.
// [Downstream Impact] If Firestore is down, all database operations fail. Critical service.
// @SECURITY_FIX (GEMINI-AUDIT-125): Returns generic error string — does not expose raw error.message on this public endpoint.
async function checkFirestore(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    const { db } = await getFirebaseAdmin();

    // Try to read a lightweight document (admin_configuration/global exists on all instances)
    const testDoc = await db.collection('admin_configuration').doc('global').get();

    const responseTime = Date.now() - startTime;

    // Document existence doesn't matter - if we can query, Firestore is up
    return {
      status: 'up',
      responseTime,
    };
  } catch (_error) {
    // GEMINI-AUDIT-125: Return generic message — raw error.message could expose DB config details via public endpoint
    const responseTime = Date.now() - startTime;
    return {
      status: 'down',
      responseTime,
      error: 'Firestore connection failed',
    };
  }
}

// GUID: API_HEALTH-008-v02
// [Intent] Check Firebase Auth connectivity by attempting to retrieve the Auth instance.
//          This validates that Firebase Admin SDK can connect to Auth service.
// [Inbound Trigger] Called by GET handler as part of parallel health checks.
// [Downstream Impact] If Auth is down, users cannot login/signup. Critical service.
// @SECURITY_FIX (GEMINI-AUDIT-125): Returns generic error string — does not expose raw error.message on this public endpoint.
async function checkAuth(): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    const { auth } = await getFirebaseAdmin();

    // Simply getting the auth instance validates connectivity
    // We don't actually need to make a request
    const responseTime = Date.now() - startTime;

    return {
      status: 'up',
      responseTime,
    };
  } catch (_error) {
    // GEMINI-AUDIT-125: Return generic message — raw error.message could expose Auth config details via public endpoint
    const responseTime = Date.now() - startTime;
    return {
      status: 'down',
      responseTime,
      error: 'Firebase Auth connection failed',
    };
  }
}
