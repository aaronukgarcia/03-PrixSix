// GUID: LIB_LEAGUES-000-v08
// @SECURITY_FIX: All catch blocks now return generic error messages to prevent Firestore path/schema disclosure (GEMINI-AUDIT-062).
// @SECURITY_FIX: Removed deprecated joinLeagueByCode() client-side function that queried Firestore by inviteCode directly — eliminates client-side enumeration vector (FIRESTORE-003).
// @SECURITY_FIX: BOW fl3clCbCBsGmkZVxl069 / GEMINI-AUDIT-063 — Server-side authorization assessment (2026-02-23):
//   These functions write directly to Firestore from the browser. No separate API routes exist for
//   createLeague, leaveLeague, deleteLeague, updateLeagueName, removeMember, or regenerateInviteCode.
//   Authorization is enforced at the Firestore Security Rules layer (see app/src/firestore.rules):
//     - CREATE: rules require ownerId == auth.uid, auth.uid in memberUserIds, isGlobal == false
//     - UPDATE (owner): rules require auth.uid == resource.data.ownerId (or isAdmin())
//     - UPDATE (leave): rules enforce onlySelfRemoval() — only removes self, no other field changes
//     - DELETE: rules require isAdmin() && isGlobal != true (GEMINI-002 fix — was owner-only)
//   ⚠️  deleteLeague() calls deleteDoc() directly via client SDK. After the GEMINI-002 rules fix,
//       this will return permission-denied for non-admin owners. If a league delete UI is needed
//       for regular owners, route it through an admin-authenticated API endpoint that uses Admin SDK.
//   Client-side ownership checks in these functions are defense-in-depth UI guards only.
//   Any attempt to bypass via direct Firestore SDK calls is blocked at the rules layer.
//   RESIDUAL RISK: If Firestore Security Rules are misconfigured or disabled, these functions
//   provide no server-side fallback. Full mitigation requires dedicated API routes (larger refactor,
//   deferred to future wave). Current risk is accepted given app scale (~20 users) and rules enforcement.
// @SECURITY_FIX: BOW zgQ9l0yBv1eZAKG958LE — All catch blocks now use CLIENT_ERRORS registry keys (2026-02-23).
// @SECURITY_FIX: GEMINI-AUDIT-062 — console.error calls gated behind NODE_ENV !== 'production'; production logs only error code (2026-02-23).
// @BOW_FIX: LEAGUES-001 — getUserLeagues now throws on Firestore error (was silently returning []), preventing league limit bypass on DB failure (2026-02-24).
// @BOW_FIX: LEAGUES-002 — All mutation catch blocks now call logClientError to write Pillar 1 error log to error_logs Firestore collection (2026-02-24).
// [Intent] Client-side league management module providing CRUD operations for custom leagues. Handles league creation, leaving, member removal, renaming, invite code regeneration, and deletion. Join-by-code is server-side only via /api/leagues/join-by-code.
// [Inbound Trigger] Called by league management UI components and API routes when users create, leave, or administer leagues.
// [Downstream Impact] Modifies the leagues Firestore collection. League membership affects standings views and scoring filters. Depends on league types from types/league.ts and audit.ts for correlation IDs.

import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore';
import type { League, CreateLeagueData } from './types/league';
import { GLOBAL_LEAGUE_ID, SYSTEM_OWNER_ID, INVITE_CODE_LENGTH, MAX_LEAGUES_PER_USER } from './types/league';
import { getCorrelationId } from './audit';
import { CLIENT_ERRORS } from './error-registry-client';
import { addDocumentNonBlocking } from '@/firebase';

// GUID: LIB_LEAGUES-001-v05
// [Intent] Generate a cryptographically random invite code of INVITE_CODE_LENGTH characters using an alphabet that excludes visually ambiguous characters (I, O, 0, 1) to reduce user input errors. Uses rejection sampling to eliminate modulo bias (LIB-001 fix).
// [Inbound Trigger] Called by createLeague and regenerateInviteCode when a new or refreshed invite code is needed.
// [Downstream Impact] The generated code is stored in the league document's inviteCode field. Users enter this code to join leagues via /api/leagues/join-by-code. Must be unique enough to avoid collisions (6 chars from 32-char alphabet = ~1B combinations).
// [Security] Rejection sampling prevents modulo bias that would make some codes more predictable.
/**
 * Generate a random 6-character alphanumeric invite code using rejection sampling
 * to eliminate modulo bias
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar-looking chars (I, O, 0, 1)
  const charsLength = chars.length; // 32 characters

  // SECURITY: Rejection sampling to prevent modulo bias (LIB-001 fix)
  // Calculate the largest value that's a multiple of charsLength
  const maxValid = Math.floor(0xFFFFFFFF / charsLength) * charsLength;

  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    let randomValue;
    do {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      randomValue = array[0];
    } while (randomValue >= maxValid); // Reject values that would cause bias

    code += chars.charAt(randomValue % charsLength);
  }
  return code;
}

// GUID: LIB_LEAGUES-011-v01
// [Intent] Fire-and-forget helper that writes a Pillar 1 error log entry to the error_logs Firestore collection from client-side code. Silently swallows its own failures to avoid cascading errors. Uses addDocumentNonBlocking with skipErrorEmit=true so a write failure cannot re-trigger the error emitter.
// [Inbound Trigger] Called from all mutation catch blocks in leagues.ts (createLeague, leaveLeague, regenerateInviteCode, updateLeagueName, removeMember, deleteLeague) to satisfy Golden Rule #1 Pillar 1.
// [Downstream Impact] Writes to error_logs Firestore collection visible in the admin ErrorLogViewer. Does not throw; a logging failure is non-blocking. Requires the client Firestore SDK already imported in this module.
function logClientError(
  firestore: Firestore,
  correlationId: string,
  errorCode: string,
  error: any,
  action: string
): void {
  try {
    const errorLogsRef = collection(firestore, 'error_logs');
    const errorData = {
      correlationId,
      errorType: errorCode,
      message: error?.message || String(error),
      code: error?.code || null,
      stack: error?.stack?.substring(0, 500) || null,
      context: {
        route: 'leagues',
        action,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
        url: typeof window !== 'undefined' ? window.location.href : null,
      },
      timestamp: new Date().toISOString(),
    };
    // skipErrorEmit=true: prevent cascade if error_logs itself is unavailable
    addDocumentNonBlocking(errorLogsRef, errorData, true);
  } catch {
    // Silently ignore — error logging must never throw
  }
}

// GUID: LIB_LEAGUES-002-v05
// [Intent] Create a new custom league in Firestore with the requesting user as owner and sole initial member. Enforces the maximum leagues-per-user limit before creation.
// [Inbound Trigger] Called from the league creation UI when a user submits a new league name.
// [Downstream Impact] Creates a new document in the leagues collection. The owner is automatically added to memberUserIds. On failure, returns a correlation ID for error tracing. Depends on getUserLeagues for limit checking and generateInviteCode for the join code.
// [Security] Authorization enforced by Firestore Security Rules: CREATE requires ownerId == auth.uid, auth.uid in memberUserIds, isGlobal == false. Client-side limit check is defense-in-depth only.
// @BOW_FIX LEAGUES-001: getUserLeagues now throws on Firestore error; catch block returns a safe error to the caller so creation is halted rather than proceeding with a stale empty array.
/**
 * Create a new league
 */
export async function createLeague(
  firestore: Firestore,
  data: CreateLeagueData
): Promise<{ success: boolean; leagueId?: string; error?: string }> {
  try {
    // Check if user has reached the max league limit.
    // LEAGUES-001: getUserLeagues throws on Firestore error; the throw propagates here
    // to the outer catch, preventing creation when the limit cannot be verified.
    const userLeagues = await getUserLeagues(firestore, data.ownerId);
    if (userLeagues.length >= MAX_LEAGUES_PER_USER) {
      return { success: false, error: `You can only be a member of ${MAX_LEAGUES_PER_USER} leagues. Please leave a league before creating a new one.` };
    }

    const leagueRef = doc(collection(firestore, 'leagues'));
    const inviteCode = generateInviteCode();

    const leagueData: Omit<League, 'id'> = {
      name: data.name.trim(),
      ownerId: data.ownerId,
      memberUserIds: [data.ownerId], // Owner is automatically a member
      isGlobal: false,
      inviteCode,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
    };

    await setDoc(leagueRef, { ...leagueData, id: leagueRef.id });

    return { success: true, leagueId: leagueRef.id };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error creating league [${correlationId}]:`, error);
    } else {
      console.error(`Error creating league [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'createLeague');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}


// GUID: LIB_LEAGUES-004-v05
// [Intent] Remove the requesting user from a league's memberUserIds array. Prevents leaving the global league and prevents the league owner from leaving (they must transfer ownership or delete instead).
// [Inbound Trigger] Called from the league management UI when a user chooses to leave a league.
// [Downstream Impact] Removes the user from the league's memberUserIds, hiding their scores from that league's standings. The league itself continues to exist. On failure, returns a correlation ID for error tracing.
// [Security] Authorization enforced by Firestore Security Rules: UPDATE for leave requires onlySelfRemoval() — only the authenticated user can remove themselves, and no other fields may change. Client-side owner check is defense-in-depth only.
/**
 * Leave a league
 */
export async function leaveLeague(
  firestore: Firestore,
  leagueId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Cannot leave global league
    if (leagueId === GLOBAL_LEAGUE_ID) {
      return { success: false, error: 'You cannot leave the global league.' };
    }

    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return { success: false, error: 'League not found.' };
    }

    const leagueData = leagueDoc.data() as League;

    // Check if user is the owner
    if (leagueData.ownerId === userId) {
      return { success: false, error: 'League owners cannot leave. Transfer ownership or delete the league instead.' };
    }

    // Check if user is a member
    if (!leagueData.memberUserIds.includes(userId)) {
      return { success: false, error: 'You are not a member of this league.' };
    }

    // Remove user from league
    await updateDoc(leagueRef, {
      memberUserIds: arrayRemove(userId),
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error leaving league [${correlationId}]:`, error);
    } else {
      console.error(`Error leaving league [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'leaveLeague');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-005-v05
// [Intent] Query and return all leagues that contain the given userId (or teamId) in their memberUserIds array, using Firestore's array-contains query.
// [Inbound Trigger] Called by createLeague for limit checking, and by league listing UI components to display user's leagues.
// [Downstream Impact] Returns League[] used for display and limit validation. On Firestore error, throws so callers can detect the failure and halt operations that depend on an accurate count (e.g., league creation limit check). Heavily used across the league system; changes to this query affect all league membership checks.
// @BOW_FIX LEAGUES-001: Changed from silent [] return on error to throwing, preventing league limit bypass when Firestore is unavailable. All callers that need to tolerate failure (UI listing) must wrap in try/catch; limit-enforcement callers (createLeague) must propagate the error.
/**
 * Get all leagues a user belongs to.
 * Throws on Firestore error so callers enforcing the league limit cannot bypass it
 * on DB failure.
 */
export async function getUserLeagues(
  firestore: Firestore,
  userId: string
): Promise<League[]> {
  const leaguesRef = collection(firestore, 'leagues');
  const q = query(leaguesRef, where('memberUserIds', 'array-contains', userId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id,
  })) as League[];
}

// GUID: LIB_LEAGUES-006-v04
// [Intent] Fetch a single league document by its Firestore document ID, returning null if not found.
// [Inbound Trigger] Called by UI components that need to display league details for a specific league ID.
// [Downstream Impact] Returns a League object or null. On error, returns null (silent failure). Used for league detail pages and ownership checks in the UI.
/**
 * Get a single league by ID
 */
export async function getLeague(
  firestore: Firestore,
  leagueId: string
): Promise<League | null> {
  try {
    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return null;
    }

    return { ...leagueDoc.data(), id: leagueDoc.id } as League;
  } catch (error: any) {
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error fetching league:', error);
    } else {
      console.error(`Error fetching league: code=${error?.code || 'unknown'}`);
    }
    return null;
  }
}

// GUID: LIB_LEAGUES-007-v05
// [Intent] Generate a new invite code for an existing league, replacing the old one. Only the league owner is authorised to perform this action, invalidating any previously shared invite codes.
// [Inbound Trigger] Called from the league settings UI when the owner requests a new invite code.
// [Downstream Impact] Overwrites the inviteCode field in the league document. Any previously shared codes immediately stop working. Returns the new code to the caller for display.
// [Security] Authorization enforced by Firestore Security Rules: UPDATE requires auth.uid == resource.data.ownerId. Client-side ownership check is defense-in-depth only.
/**
 * Regenerate invite code for a league (owner only)
 */
export async function regenerateInviteCode(
  firestore: Firestore,
  leagueId: string,
  userId: string
): Promise<{ success: boolean; newCode?: string; error?: string }> {
  try {
    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return { success: false, error: 'League not found.' };
    }

    const leagueData = leagueDoc.data() as League;

    // Only owner can regenerate
    if (leagueData.ownerId !== userId) {
      return { success: false, error: 'Only the league owner can regenerate the invite code.' };
    }

    const newCode = generateInviteCode();

    await updateDoc(leagueRef, {
      inviteCode: newCode,
      updatedAt: serverTimestamp(),
    });

    return { success: true, newCode };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error regenerating invite code [${correlationId}]:`, error);
    } else {
      console.error(`Error regenerating invite code [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'regenerateInviteCode');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-008-v05
// [Intent] Update the display name of a league. Only the league owner is authorised to rename. Trims whitespace from the new name before saving.
// [Inbound Trigger] Called from the league settings UI when the owner submits a new name.
// [Downstream Impact] Changes the league name displayed across all standings, league lists, and member views. The name field in the leagues document is updated.
// [Security] Authorization enforced by Firestore Security Rules: UPDATE requires auth.uid == resource.data.ownerId. Client-side ownership check is defense-in-depth only.
/**
 * Update league name (owner only)
 */
export async function updateLeagueName(
  firestore: Firestore,
  leagueId: string,
  userId: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return { success: false, error: 'League not found.' };
    }

    const leagueData = leagueDoc.data() as League;

    // Only owner can rename
    if (leagueData.ownerId !== userId) {
      return { success: false, error: 'Only the league owner can rename the league.' };
    }

    await updateDoc(leagueRef, {
      name: newName.trim(),
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error updating league name [${correlationId}]:`, error);
    } else {
      console.error(`Error updating league name [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'updateLeagueName');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-009-v05
// [Intent] Remove a specified member from a league's memberUserIds array. Only the league owner can remove members, and the owner cannot remove themselves.
// [Inbound Trigger] Called from the league member management UI when the owner removes a member.
// [Downstream Impact] The removed member loses access to the league standings and their scores are no longer visible in that league. The league continues to exist with remaining members.
// [Security] Authorization enforced by Firestore Security Rules: UPDATE requires auth.uid == resource.data.ownerId. Client-side ownership check is defense-in-depth only.
/**
 * Remove a member from league (owner only)
 */
export async function removeMember(
  firestore: Firestore,
  leagueId: string,
  ownerId: string,
  memberIdToRemove: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return { success: false, error: 'League not found.' };
    }

    const leagueData = leagueDoc.data() as League;

    // Only owner can remove members
    if (leagueData.ownerId !== ownerId) {
      return { success: false, error: 'Only the league owner can remove members.' };
    }

    // Cannot remove the owner
    if (memberIdToRemove === ownerId) {
      return { success: false, error: 'Cannot remove the league owner.' };
    }

    await updateDoc(leagueRef, {
      memberUserIds: arrayRemove(memberIdToRemove),
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error removing member [${correlationId}]:`, error);
    } else {
      console.error(`Error removing member [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'removeMember');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-010-v07
// [Intent] Permanently delete a league document from Firestore. The global league is protected from deletion.
// [Inbound Trigger] LEGACY — UI pages now call /api/leagues/delete directly (Admin SDK route, Wave 13 fix).
//                   This client-side function remains for admin use only; it will fail with permission-denied
//                   for non-admin owners due to the GEMINI-002 Firestore rules change.
// [Downstream Impact] The league document is permanently removed. All member associations are lost. Standings that reference this league will no longer find it. On failure, returns a correlation ID for error tracing.
// [Security] Authorization enforced by Firestore Security Rules (GEMINI-002 fix): DELETE now requires
//            isAdmin() && isGlobal != true. Non-admin owners use /api/leagues/delete (Admin SDK)
//            which enforces ownership server-side and bypasses Firestore rules safely.
/**
 * Delete a league (owner only, not global)
 */
export async function deleteLeague(
  firestore: Firestore,
  leagueId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Cannot delete global league
    if (leagueId === GLOBAL_LEAGUE_ID) {
      return { success: false, error: 'The global league cannot be deleted.' };
    }

    const leagueRef = doc(firestore, 'leagues', leagueId);
    const leagueDoc = await getDoc(leagueRef);

    if (!leagueDoc.exists()) {
      return { success: false, error: 'League not found.' };
    }

    const leagueData = leagueDoc.data() as League;

    // Only owner can delete
    if (leagueData.ownerId !== userId) {
      return { success: false, error: 'Only the league owner can delete the league.' };
    }

    await deleteDoc(leagueRef);

    return { success: true };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    // GEMINI-AUDIT-062: Gate detailed logging behind NODE_ENV; production logs only error code
    if (process.env.NODE_ENV !== 'production') {
      console.error(`Error deleting league [${correlationId}]:`, error);
    } else {
      console.error(`Error deleting league [${correlationId}]: code=${error?.code || 'unknown'}`);
    }
    // LEAGUES-002 Pillar 1: write to error_logs
    logClientError(firestore, correlationId, CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.code, error, 'deleteLeague');
    return { success: false, error: `${CLIENT_ERRORS.FIRESTORE_WRITE_FAILED.message} (ID: ${correlationId})` };
  }
}
