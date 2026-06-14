// GUID: API_AUTH_ACK_LATE_JOINER-000-v01
// [Intent] Record a late joiner's acknowledgement of the mid-season welcome screen. Sets
//          lateJoinerAcknowledged=true on their user doc (which lifts the /welcome redirect gate in
//          the Firebase provider) and writes an audit_logs entry for transparency.
// [Inbound Trigger] POST from /welcome when the user ticks "I have read and understood" and confirms.
// [Downstream Impact] Updates users/{uid}.lateJoinerAcknowledged and adds a LATE_JOINER_ACKNOWLEDGED
//          audit entry. Auth required (Bearer ID token) — a user can only acknowledge for themselves.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  try {
    const auth = await verifyAuthToken(request.headers.get('authorization'));
    if (!auth) {
      const traced = createTracedError(ERRORS.AUTH_INVALID_TOKEN, {
        correlationId,
        context: { route: '/api/auth/acknowledge-late-joiner', action: 'POST' },
      });
      await logTracedError(traced, (await getFirebaseAdmin()).db);
      return NextResponse.json(
        { success: false, error: traced.definition.message, errorCode: traced.definition.code, correlationId },
        { status: 401 },
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();
    const uid = auth.uid;
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const data: any = snap.exists ? snap.data() : null;

    await userRef.set({ lateJoinerAcknowledged: true }, { merge: true });

    await db.collection('audit_logs').add({
      userId: uid,
      action: 'LATE_JOINER_ACKNOWLEDGED',
      details: {
        teamName: data?.teamName,
        acknowledgedAt: new Date().toISOString(),
        lateJoinerInfo: data?.lateJoinerInfo ?? null,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/auth/acknowledge-late-joiner', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, (await getFirebaseAdmin()).db);
    return NextResponse.json(
      { success: false, error: traced.definition.message, errorCode: traced.definition.code, correlationId },
      { status: 500 },
    );
  }
}
