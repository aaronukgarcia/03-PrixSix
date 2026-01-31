// GUID: API_AUTH_RECORD_LOGOUT-000-v03
// [Intent] Records a user logout event by updating the corresponding user_logons document
//          with a logout timestamp and 'Logged Out' status. Validates document ownership
//          to prevent cross-user spoofing.
// [Inbound Trigger] Called by FirebaseProvider logout() before signOut(auth).
// [Downstream Impact] Updates the user_logons document status from 'Active' to 'Logged Out'.
//                     Profile page logon history will reflect the updated status.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, getFirebaseAdmin } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { logonId } = body;

    if (!logonId || typeof logonId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid logonId' },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // Validate document exists and belongs to the authenticated user
    const logonDoc = await db.collection('user_logons').doc(logonId).get();

    if (!logonDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Logon record not found' },
        { status: 404 }
      );
    }

    const logonData = logonDoc.data();
    if (logonData?.userId !== verifiedUser.uid) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Cannot update another user\'s logon record' },
        { status: 403 }
      );
    }

    await db.collection('user_logons').doc(logonId).update({
      logoutTimestamp: FieldValue.serverTimestamp(),
      sessionStatus: 'Logged Out',
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[Record Logout Error]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to record logout event' },
      { status: 500 }
    );
  }
}
