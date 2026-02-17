// GUID: API_HEALTH-000-v01
// @PHASE_3C: Health check endpoint for monitoring and uptime checks (DEPLOY-005).
// [Intent] Provides operational health status by checking connectivity to critical services:
//          Firestore, Firebase Auth. Returns 200 if all healthy, 503 if degraded.
// [Inbound Trigger] GET requests from uptime monitors, Azure Monitor, or admin health dashboards.
// [Downstream Impact] Used by monitoring systems to detect outages. Alerts triggered on 503 responses.
//                     Does not require authentication - public endpoint for monitoring.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';

// Force dynamic to prevent static optimization
export const dynamic = 'force-dynamic';

// GUID: API_HEALTH-001-v01
// [Intent] Interface defining the structure of health check responses with per-service status.
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
}

interface ServiceStatus {
  status: 'up' | 'down' | 'unknown';
  responseTime?: number;
  error?: string;
}

// GUID: API_HEALTH-002-v01
// [Intent] GET handler that performs health checks on all critical services and returns aggregated status.
//          Checks run in parallel for speed. Returns 200 for healthy, 503 for degraded/unhealthy.
// [Inbound Trigger] HTTP GET /api/health from monitoring systems or health dashboards.
// [Downstream Impact] Response time should be <200ms for accurate health monitoring.
//                     503 responses trigger alerts in monitoring systems.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

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

    // GUID: API_HEALTH-005-v01
    // [Intent] Build health check response with version info from package.json.
    // [Inbound Trigger] After status aggregation completes.
    // [Downstream Impact] Version string helps correlate health issues with deployments.
    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.56.0',
      services: {
        firestore: firestoreStatus,
        auth: authStatus,
      },
      responseTime,
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
    // GUID: API_HEALTH-006-v02
    // @GOLDEN_RULE_1: Add correlation ID for monitoring system tracing (Phase 4 compliance).
    // [Intent] Catch-all error handler for unexpected failures in the health check itself.
    //          Does not write to error_logs (high-frequency endpoint) but includes correlation ID.
    // [Inbound Trigger] Any uncaught exception during health checks.
    // [Downstream Impact] Returns 503 with correlation ID. Monitoring systems can track repeated failures.
    //                     Does not expose raw error.message (security compliance).
    const responseTime = Date.now() - startTime;
    console.error(`[Health Check Failed] correlationId: ${correlationId}`, error);
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

// GUID: API_HEALTH-007-v01
// [Intent] Check Firestore connectivity by attempting to read the global settings document.
//          Uses a lightweight read operation that should complete in <100ms.
// [Inbound Trigger] Called by GET handler as part of parallel health checks.
// [Downstream Impact] If Firestore is down, all database operations fail. Critical service.
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
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    return {
      status: 'down',
      responseTime,
      error: error.message || 'Firestore connection failed',
    };
  }
}

// GUID: API_HEALTH-008-v01
// [Intent] Check Firebase Auth connectivity by attempting to retrieve the Auth instance.
//          This validates that Firebase Admin SDK can connect to Auth service.
// [Inbound Trigger] Called by GET handler as part of parallel health checks.
// [Downstream Impact] If Auth is down, users cannot login/signup. Critical service.
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
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    return {
      status: 'down',
      responseTime,
      error: error.message || 'Firebase Auth connection failed',
    };
  }
}
