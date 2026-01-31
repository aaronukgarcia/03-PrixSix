// GUID: API_ADMIN_UPDATE_USER-000-v03
// [Intent] Admin API route for updating user profile fields (email, teamName, isAdmin, mustChangePin) with full validation, deduplication, and downstream propagation.
// [Inbound Trigger] POST request from admin UI (UserManagement component) when an admin edits a user's details.
// [Downstream Impact] Updates Firebase Auth email, Firestore users collection, propagates teamName changes to predictions subcollection, writes audit_logs. Consistency Checker relies on Auth/Firestore sync.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { z } from 'zod';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_UPDATE_USER-001-v03
// [Intent] Zod schema for strict request validation — prevents mass assignment by only allowing known fields.
// [Inbound Trigger] Every incoming POST request body is parsed against this schema.
// [Downstream Impact] Rejects malformed requests before any database operations occur. Adding new updatable fields requires updating this schema.
const updateUserRequestSchema = z.object({
  userId: z.string().min(1),
  adminUid: z.string().min(1),
  data: z.object({
    email: z.string().email().optional(),
    teamName: z.string().min(1).max(50).optional(),
    isAdmin: z.boolean().optional(),
    mustChangePin: z.boolean().optional(),
  }).strict(),
});

// GUID: API_ADMIN_UPDATE_USER-002-v03
// [Intent] POST handler that orchestrates admin user updates: validates input, checks admin permissions, deduplicates email/teamName, updates Auth + Firestore, propagates teamName to predictions, and logs audit events.
// [Inbound Trigger] POST /api/admin/update-user with JSON body containing userId, adminUid, and data object.
// [Downstream Impact] Writes to Firebase Auth (email), Firestore users collection, Firestore predictions subcollection (teamName propagation), and audit_logs collection. Error states logged to error_logs.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const parsed = updateUserRequestSchema.safeParse(body);

    // GUID: API_ADMIN_UPDATE_USER-003-v03
    // [Intent] Early return on Zod validation failure — provides detailed field-level errors to the caller.
    // [Inbound Trigger] Request body fails schema validation (missing fields, invalid types, extra properties).
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS error code. No database operations occur.
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

    const { userId, adminUid, data } = parsed.data;

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // GUID: API_ADMIN_UPDATE_USER-004-v03
    // [Intent] Verify the requesting user has admin privileges before allowing any modifications.
    // [Inbound Trigger] Every valid POST request — admin check is mandatory.
    // [Downstream Impact] Returns 403 if not admin. Prevents privilege escalation. Relies on isAdmin field in Firestore users collection.
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

    // GUID: API_ADMIN_UPDATE_USER-005-v03
    // [Intent] Handle email change: normalise to lowercase, check for duplicates in both Firestore and Firebase Auth, then update Auth record.
    // [Inbound Trigger] data.email is present in the request body.
    // [Downstream Impact] Updates Firebase Auth email. If Auth update fails (duplicate or user-not-found), returns specific error. Normalised email is carried forward to Firestore update. Golden Rule #3: Auth is source of truth for email.
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

    // GUID: API_ADMIN_UPDATE_USER-006-v03
    // [Intent] Handle teamName change: check for case-insensitive duplicates across all users, capture old name for downstream propagation.
    // [Inbound Trigger] data.teamName is present in the request body.
    // [Downstream Impact] If duplicate found, returns 409. Otherwise stores oldTeamName for prediction propagation in SEQ 008. Fetches all users for duplicate check — performance concern at scale.
    let oldTeamName: string | null = null;
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

      // Get the current team name before updating (for propagation)
      const currentUserDoc = await db.collection('users').doc(userId).get();
      if (currentUserDoc.exists) {
        oldTeamName = currentUserDoc.data()?.teamName || null;
      }

      data.teamName = normalizedTeamName;
    }

    // GUID: API_ADMIN_UPDATE_USER-007-v03
    // [Intent] Persist the validated changes to the Firestore users document with a server timestamp.
    // [Inbound Trigger] All validation and deduplication checks have passed.
    // [Downstream Impact] Updates Firestore users/{userId}. The updatedAt timestamp is used for audit trail. Other components reading user data will see the new values.
    const userDocRef = db.collection('users').doc(userId);
    await userDocRef.update({
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // GUID: API_ADMIN_UPDATE_USER-008-v03
    // [Intent] Propagate teamName changes to all of the user's prediction documents (Golden Rule #3: Single Source of Truth — denormalised teamName must stay in sync).
    // [Inbound Trigger] oldTeamName differs from new data.teamName (team name was actually changed, not just other fields).
    // [Downstream Impact] Batch-updates predictions subcollection. Writes a specific TEAM_NAME_CHANGED audit log. If this fails mid-batch, predictions may be partially updated — no rollback mechanism.
    let updatedPredictionCount = 0;
    if (oldTeamName && data.teamName && oldTeamName !== data.teamName) {
      // Get all predictions for this user with the old team name
      const predictionsSnapshot = await db.collection('users').doc(userId)
        .collection('predictions')
        .where('teamName', '==', oldTeamName)
        .get();

      // Update each prediction with the new team name
      const batch = db.batch();
      predictionsSnapshot.forEach(predDoc => {
        batch.update(predDoc.ref, { teamName: data.teamName });
        updatedPredictionCount++;
      });

      if (updatedPredictionCount > 0) {
        await batch.commit();
      }

      // Log specific audit event for team name change
      await db.collection('audit_logs').add({
        userId: adminUid,
        action: 'TEAM_NAME_CHANGED',
        details: {
          targetUserId: userId,
          oldTeamName,
          newTeamName: data.teamName,
          predictionsUpdated: updatedPredictionCount,
        },
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    // GUID: API_ADMIN_UPDATE_USER-009-v03
    // [Intent] Write a general audit log entry for every admin user update, regardless of which fields changed.
    // [Inbound Trigger] Successful completion of all update operations.
    // [Downstream Impact] Populates audit_logs collection for compliance and troubleshooting. Admin dashboard may display these entries.
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'ADMIN_UPDATE_USER',
      details: {
        targetUserId: userId,
        changes: data,
        predictionsUpdated: updatedPredictionCount,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: updatedPredictionCount > 0
        ? `User updated successfully. ${updatedPredictionCount} prediction(s) updated with new team name.`
        : 'User updated successfully.',
    });

  } catch (error: any) {
    // GUID: API_ADMIN_UPDATE_USER-010-v04
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs, and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client for support reference. Golden Rule #1 compliance.
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/update-user', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
