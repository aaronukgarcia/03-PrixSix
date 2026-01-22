import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface UpdateUserRequest {
  userId: string;
  adminUid: string; // The admin making the request
  data: {
    email?: string;
    teamName?: string;
    isAdmin?: boolean;
    mustChangePin?: boolean;
    [key: string]: any;
  };
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const { userId, adminUid, data }: UpdateUserRequest = await request.json();

    // Validate required fields
    if (!userId || !adminUid || !data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

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

    // If email is being changed, check for duplicates and update Auth
    if (data.email) {
      const normalizedEmail = data.email.toLowerCase().trim();

      // Check if email already exists in Firestore (excluding current user)
      const emailQuery = await db.collection('users')
        .where('email', '==', normalizedEmail)
        .get();

      const emailExists = emailQuery.docs.some(doc => doc.id !== userId);
      if (emailExists) {
        return NextResponse.json(
          {
            success: false,
            error: 'This email address is already in use by another team.',
            errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
            correlationId,
          },
          { status: 409 }
        );
      }

      // Update email in Firebase Auth
      try {
        await auth.updateUser(userId, { email: normalizedEmail });
      } catch (authError: any) {
        console.error(`[Admin Update Auth Error ${correlationId}]`, authError);

        if (authError.code === 'auth/email-already-exists') {
          return NextResponse.json(
            {
              success: false,
              error: 'This email address is already in use in Firebase Auth.',
              errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
              correlationId,
            },
            { status: 409 }
          );
        }

        if (authError.code === 'auth/user-not-found') {
          return NextResponse.json(
            {
              success: false,
              error: 'User not found in Firebase Auth.',
              errorCode: ERROR_CODES.AUTH_USER_NOT_FOUND.code,
              correlationId,
            },
            { status: 404 }
          );
        }

        throw authError;
      }

      // Normalize email in the data object
      data.email = normalizedEmail;
    }

    // If team name is being changed, check for duplicates
    if (data.teamName) {
      const normalizedTeamName = data.teamName.trim();
      const allUsersSnapshot = await db.collection('users').get();
      const normalizedNewName = normalizedTeamName.toLowerCase();
      let teamNameExists = false;

      allUsersSnapshot.forEach(doc => {
        if (doc.id === userId) return; // Skip the user being updated
        const existingName = doc.data().teamName?.toLowerCase()?.trim();
        if (existingName === normalizedNewName) {
          teamNameExists = true;
        }
      });

      if (teamNameExists) {
        return NextResponse.json(
          {
            success: false,
            error: 'This team name is already taken. Please choose a unique name.',
            errorCode: ERROR_CODES.VALIDATION_DUPLICATE_ENTRY.code,
            correlationId,
          },
          { status: 409 }
        );
      }

      data.teamName = normalizedTeamName;
    }

    // Update Firestore user document
    const userDocRef = db.collection('users').doc(userId);
    await userDocRef.update({
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log audit event
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'ADMIN_UPDATE_USER',
      details: {
        targetUserId: userId,
        changes: data,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'User updated successfully.',
    });

  } catch (error: any) {
    console.error(`[Admin Update User Error ${correlationId}]`, error);

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/admin/update-user',
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
        error: 'Failed to update user. Please try again.',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
