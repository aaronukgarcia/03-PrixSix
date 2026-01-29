import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { z } from 'zod';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const deleteUserRequestSchema = z.object({
  userId: z.string().min(1),
  adminUid: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const parsed = deleteUserRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: parsed.error.flatten().fieldErrors,
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { userId, adminUid } = parsed.data;

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // Verify the requester is an admin
    const adminDoc = await db.collection('users').doc(adminUid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied. Admin access required.',
          errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // Prevent deleting yourself
    if (userId === adminUid) {
      return NextResponse.json(
        {
          success: false,
          error: 'You cannot delete your own account.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Get user info before deletion for audit log
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // Coordinated deletion: Auth + Firestore as a unit of work
    let authDeleted = false;
    try {
      await auth.deleteUser(userId);
      authDeleted = true;
    } catch (authError: any) {
      console.error(`[Admin Delete Auth Error ${correlationId}]`, authError);

      if (authError.code === 'auth/user-not-found') {
        console.warn(`[Admin Delete] User ${userId} not found in Auth, cleaning up Firestore only`);
      } else {
        throw authError;
      }
    }

    // Delete Firestore documents
    try {
      const batch = db.batch();
      batch.delete(db.collection('users').doc(userId));
      batch.delete(db.collection('presence').doc(userId));
      await batch.commit();
    } catch (firestoreError: any) {
      // Critical: Auth was deleted but Firestore cleanup failed
      if (authDeleted) {
        await logError({
          correlationId,
          error: firestoreError,
          context: {
            route: '/api/admin/delete-user',
            action: 'firestore_cleanup_after_auth_delete',
            additionalInfo: { userId, authDeleted: true, critical: true },
          },
        });
      }
      throw firestoreError;
    }

    // Remove user from all leagues
    try {
      const leaguesSnapshot = await db.collection('leagues').get();
      const leagueUpdates: Promise<any>[] = [];

      leaguesSnapshot.forEach(leagueDoc => {
        const leagueData = leagueDoc.data();
        if (leagueData.memberUserIds?.includes(userId)) {
          leagueUpdates.push(
            leagueDoc.ref.update({
              memberUserIds: FieldValue.arrayRemove(userId),
              updatedAt: FieldValue.serverTimestamp(),
            })
          );
        }
      });

      await Promise.all(leagueUpdates);
    } catch (leagueError: any) {
      console.warn(`[Admin Delete] Could not clean up league memberships:`, leagueError.message);
    }

    // Log audit event
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'ADMIN_DELETE_USER',
      details: {
        targetUserId: userId,
        deletedEmail: userData?.email || 'unknown',
        deletedTeamName: userData?.teamName || 'unknown',
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'User deleted successfully.',
    });

  } catch (error: any) {
    console.error(`[Admin Delete User Error ${correlationId}]`, error);

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/admin/delete-user',
        action: 'POST',
        additionalInfo: {
          errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
          errorType: error.code || error.name || 'UnknownError',
        },
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete user. Please try again.',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
