// GUID: API_EMAIL_HEALTH-000-v03
// [Intent] API route that provides an email system health check for admins. Checks Graph API credentials, Firebase Admin connectivity, recent email success/failure rates, and email queue depth.
// [Inbound Trigger] GET request from the admin email dashboard or monitoring tools.
// [Downstream Impact] Returns a HealthCheckResult JSON with overall status (healthy/degraded/unhealthy) and per-check details. Admin UI uses this to display system health indicators.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_EMAIL_HEALTH-001-v03
// [Intent] Type definition for the health check response — structured result with overall status and individual check statuses for Graph credentials, Firebase Admin, recent emails, and queued emails.
// [Inbound Trigger] Used to type the response object assembled in the GET handler.
// [Downstream Impact] Changing this shape affects the admin EmailHealth component that consumes and displays these check results.
interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    graphCredentials: { status: 'ok' | 'error'; message?: string };
    firebaseAdmin: { status: 'ok' | 'error'; message?: string };
    recentEmails: { status: 'ok' | 'warning' | 'error'; count: number; message?: string };
    queuedEmails: { status: 'ok' | 'warning' | 'error'; count: number; message?: string };
  };
}

// GUID: API_EMAIL_HEALTH-002-v04
// @SECURITY_FIX: Moved admin check to beginning of handler. Previous version performed health
//   checks BEFORE verifying admin status, allowing any authenticated user to see system health
//   information (Graph API credentials status, email failure rates, queue depths).
// [Intent] GET handler — authenticates the caller via Bearer token, checks admin status, then assembles a health report by inspecting Graph API env vars, querying email_logs for failures in the last 24 hours, and checking email_queue for pending items. Returns overall status as healthy/degraded/unhealthy.
// [Inbound Trigger] HTTP GET with Authorization header containing a valid Firebase ID token for an admin user.
// [Downstream Impact] Reads from email_logs (filtered by timestamp >= 24h ago) and email_queue (filtered by status == pending). Admin access is verified via users collection isAdmin flag. Returns 401 if unauthenticated, 403 if non-admin.
export async function GET(request: NextRequest) {
  // SECURITY: Verify authentication AND admin status BEFORE any health checks
  const authHeader = request.headers.get('Authorization');
  const verifiedUser = await verifyAuthToken(authHeader);

  if (!verifiedUser) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // SECURITY: Check admin status immediately after authentication
  try {
    const { db: adminCheckDb } = await getFirebaseAdmin();
    const userDoc = await adminCheckDb.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to verify admin status' },
      { status: 500 }
    );
  }

  const result: HealthCheckResult = {
    overall: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      graphCredentials: { status: 'ok' },
      firebaseAdmin: { status: 'ok' },
      recentEmails: { status: 'ok', count: 0 },
      queuedEmails: { status: 'ok', count: 0 },
    },
  };

  // Check Microsoft Graph credentials
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const senderEmail = process.env.GRAPH_SENDER_EMAIL;

  if (!tenantId || !clientId || !clientSecret) {
    result.checks.graphCredentials = {
      status: 'error',
      message: 'Missing Graph API credentials (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, or GRAPH_CLIENT_SECRET)',
    };
    result.overall = 'unhealthy';
  } else if (!senderEmail) {
    result.checks.graphCredentials = {
      status: 'error',
      message: 'Missing GRAPH_SENDER_EMAIL environment variable',
    };
    result.overall = 'unhealthy';
  }

  // Check Firebase Admin connection
  try {
    const { db } = await getFirebaseAdmin();

    // Check recent emails (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEmailsSnapshot = await db.collection('email_logs')
      .where('timestamp', '>=', twentyFourHoursAgo)
      .get();
    const recentCount = recentEmailsSnapshot.docs.length;
    const failedRecent = recentEmailsSnapshot.docs.filter(d => d.data().status !== 'sent').length;

    result.checks.recentEmails.count = recentCount;
    if (failedRecent > 0) {
      result.checks.recentEmails.status = 'warning';
      result.checks.recentEmails.message = `${failedRecent} of ${recentCount} emails failed in the last 24 hours`;
      if (result.overall === 'healthy') result.overall = 'degraded';
    }

    // Check email queue
    const queuedEmailsSnapshot = await db.collection('email_queue')
      .where('status', '==', 'pending')
      .get();
    const queuedCount = queuedEmailsSnapshot.docs.length;
    result.checks.queuedEmails.count = queuedCount;

    if (queuedCount > 10) {
      result.checks.queuedEmails.status = 'warning';
      result.checks.queuedEmails.message = `${queuedCount} emails waiting in queue`;
      if (result.overall === 'healthy') result.overall = 'degraded';
    } else if (queuedCount > 50) {
      result.checks.queuedEmails.status = 'error';
      result.checks.queuedEmails.message = `${queuedCount} emails backed up in queue`;
      result.overall = 'unhealthy';
    }

  } catch (error: any) {
    result.checks.firebaseAdmin = {
      status: 'error',
      message: `Firebase Admin error: ${error.message}`,
    };
    result.overall = 'unhealthy';
  }

  return NextResponse.json({ success: true, health: result });
}
