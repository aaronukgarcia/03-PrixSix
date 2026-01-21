import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

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

export async function GET(request: NextRequest) {
  // Verify admin token
  const authHeader = request.headers.get('Authorization');
  const verifiedUser = await verifyAuthToken(authHeader);

  if (!verifiedUser) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
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

  // Check if admin user
  try {
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
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

  return NextResponse.json({ success: true, health: result });
}
