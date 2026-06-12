// GUID: API_ADMIN_WHATSAPP_QUEUE-000-v01
// [Intent] Admin-only endpoint to clear messages from the whatsapp_queue collection — a single
//          message by id, or in bulk (all / by status). whatsapp_queue is server-write-only
//          (Firestore rules deny client writes), so deletes must go through the Admin SDK here.
// [Inbound Trigger] DELETE from the WhatsApp admin panel's queue card (per-message trash + Clear-All).
// [Downstream Impact] Removes whatsapp_queue documents. Prevents a stale/failed backlog from being
//                     sent when the worker reconnects. Writes an audit_log entry.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId, getFirebaseAdmin } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_WHATSAPP_QUEUE-001-v01
// [Intent] DELETE handler. Query params: ?id=<docId> deletes one; ?scope=all deletes every queued
//          message; ?scope=<STATUS> deletes only messages with that status (e.g. FAILED, PENDING).
// [Inbound Trigger] DELETE /api/admin/whatsapp-queue?id=... | ?scope=all | ?scope=FAILED
// [Downstream Impact] Batched deletes against whatsapp_queue. Returns { success, deleted }.
export async function DELETE(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const verifiedUser = await verifyAuthToken(request.headers.get('Authorization'));
    if (!verifiedUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized', correlationId }, { status: 401 });
    }

    const { db, FieldValue } = await getFirebaseAdmin();
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, error: 'Admin access required', correlationId }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const scope = searchParams.get('scope');

    if (!id && !scope) {
      return NextResponse.json(
        { success: false, error: 'Provide ?id=<docId> or ?scope=all|<STATUS>', errorCode: ERRORS.VALIDATION_MISSING_FIELDS.code, correlationId },
        { status: 400 }
      );
    }

    let deleted = 0;

    if (id) {
      // Single message
      await db.collection('whatsapp_queue').doc(id).delete();
      deleted = 1;
    } else {
      // Bulk: all, or filtered by status (case-insensitive)
      let query: FirebaseFirestore.Query = db.collection('whatsapp_queue');
      const isAll = scope!.toLowerCase() === 'all';
      if (!isAll) {
        query = query.where('status', '==', scope!.toUpperCase());
      }
      const snap = await query.get();
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      deleted = docs.length;
    }

    // Audit (best-effort)
    try {
      await db.collection('audit_logs').add({
        userId: verifiedUser.uid,
        action: 'CLEAR_WHATSAPP_QUEUE',
        details: { id: id || null, scope: scope || null, deleted },
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, deleted, correlationId });
  } catch (error: any) {
    if (process.env.NODE_ENV !== 'production') { console.error(`[WhatsApp Queue Clear ${correlationId}]`, error?.message); }
    return NextResponse.json(
      { success: false, error: ERRORS.FIRESTORE_WRITE_FAILED.message, errorCode: ERRORS.FIRESTORE_WRITE_FAILED.code, correlationId },
      { status: 500 }
    );
  }
}
