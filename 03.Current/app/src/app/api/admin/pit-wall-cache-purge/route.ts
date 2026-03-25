// GUID: API_ADMIN_PITWALL_CACHE_PURGE-000-v01
// [Intent] Admin-only endpoint to purge Pit Wall server-side caches.
//          Clears live data cache, detail cache, and OpenF1 token cache.
//          Next request to live-data will trigger a fresh OpenF1 fan-out.
// [Inbound Trigger] Admin clicks "Purge Cache" button in PitWallManager.
// [Downstream Impact] Writes to audit_logs. Forces fresh OpenF1 fetch on next poll.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { purgeAllCaches, resetCacheMetrics } from '@/lib/pit-wall-cache';
import { resetMetrics as resetProcessMetrics } from '@/lib/pit-wall-metrics';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_PITWALL_CACHE_PURGE-001-v01
// [Intent] POST handler — purges all Pit Wall caches and logs to audit_logs.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();

  try {
    // Auth: verify Firebase token
    const authHeader = req.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Unauthorised', code: ERRORS.SESSION_INVALID.code, correlationId },
        { status: 401 },
      );
    }

    // Admin-only gate
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden', code: ERRORS.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 },
      );
    }

    const result = purgeAllCaches();

    // Reset metrics if requested via query param
    const url = new URL(req.url);
    const shouldResetMetrics = url.searchParams.get('resetMetrics') === 'true';
    if (shouldResetMetrics) {
      resetCacheMetrics();
      resetProcessMetrics();
    }

    // Audit log
    const adminEmail = userDoc.data()?.email || verifiedUser.uid;
    await db.collection('audit_logs').add({
      action: 'ADMIN_PURGE_PIT_WALL_CACHE',
      adminEmail,
      userId: verifiedUser.uid,
      purgedLiveData: result.purgedLiveData,
      purgedDetail: result.purgedDetail,
      purgedToken: result.purgedToken,
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      ...result,
      metricsReset: shouldResetMetrics,
      correlationId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to purge Pit Wall cache', code: 'PX-3319', correlationId },
      { status: 500 },
    );
  }
}
