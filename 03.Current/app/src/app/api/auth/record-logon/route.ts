// GUID: API_AUTH_RECORD_LOGON-000-v03
// [Intent] Records a user logon event in the user_logons collection for session tracking
//          and profile page history display. Writes via Admin SDK (server-side only).
// [Inbound Trigger] Called by FirebaseProvider after OAuth login (onAuthStateChanged first snapshot)
//                   or included in PIN login response from /api/auth/login.
// [Downstream Impact] Creates a user_logons document with Active status. The logonId is stored
//                     client-side so it can be sent to /api/auth/record-logout on sign-out.

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
    const { loginMethod } = body;

    if (!loginMethod || !['pin', 'google', 'apple'].includes(loginMethod)) {
      return NextResponse.json(
        { success: false, error: 'Invalid loginMethod. Must be pin, google, or apple.' },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    const logonRef = await db.collection('user_logons').add({
      userId: verifiedUser.uid,
      logonTimestamp: FieldValue.serverTimestamp(),
      logoutTimestamp: null,
      sessionStatus: 'Active',
      loginMethod,
      ipAddress: null,
      userAgent: null,
    });

    return NextResponse.json({
      success: true,
      logonId: logonRef.id,
    });

  } catch (error: any) {
    console.error('[Record Logon Error]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to record logon event' },
      { status: 500 }
    );
  }
}
