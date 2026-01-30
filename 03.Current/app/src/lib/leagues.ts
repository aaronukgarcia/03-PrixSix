// GUID: LIB_LEAGUES-000-v03
// [Intent] Client-side league management module providing CRUD operations for custom leagues. Handles league creation, joining via invite codes, leaving, member removal, renaming, invite code regeneration, and deletion. All operations interact with the leagues Firestore collection.
// [Inbound Trigger] Called by league management UI components and API routes when users create, join, leave, or administer leagues.
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

// GUID: LIB_LEAGUES-001-v03
// [Intent] Generate a cryptographically random invite code of INVITE_CODE_LENGTH characters using an alphabet that excludes visually ambiguous characters (I, O, 0, 1) to reduce user input errors.
// [Inbound Trigger] Called by createLeague and regenerateInviteCode when a new or refreshed invite code is needed.
// [Downstream Impact] The generated code is stored in the league document's inviteCode field. Users enter this code to join leagues via joinLeagueByCode. Must be unique enough to avoid collisions (6 chars from 30-char alphabet = ~729M combinations).
/**
 * Generate a random 6-character alphanumeric invite code
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar-looking chars (I, O, 0, 1)
  const array = new Uint32Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(array);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += chars.charAt(array[i] % chars.length);
  }
  return code;
}

// GUID: LIB_LEAGUES-002-v03
// [Intent] Create a new custom league in Firestore with the requesting user as owner and sole initial member. Enforces the maximum leagues-per-user limit before creation.
// [Inbound Trigger] Called from the league creation UI when a user submits a new league name.
// [Downstream Impact] Creates a new document in the leagues collection. The owner is automatically added to memberUserIds. On failure, returns a correlation ID for error tracing. Depends on getUserLeagues for limit checking and generateInviteCode for the join code.
/**
 * Create a new league
 */
export async function createLeague(
  firestore: Firestore,
  data: CreateLeagueData
): Promise<{ success: boolean; leagueId?: string; error?: string }> {
  try {
    // Check if user has reached the max league limit
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
    console.error(`Error creating league [${correlationId}]:`, error);
    return { success: false, error: `${error.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-003-v03
// [Intent] Join an existing league by looking up its invite code (case-insensitive), validating membership limits and duplicate membership, then adding the user's team ID to the league's memberUserIds array.
// [Inbound Trigger] Called from the league join UI when a user enters an invite code. Supports both primary (userId) and secondary (userId-secondary) team memberships.
// [Downstream Impact] Adds the team to the league's memberUserIds array, making that team's scores visible in the league standings. Checks both primary and secondary league counts against doubled MAX_LEAGUES_PER_USER. On failure, returns a correlation ID for error tracing.
/**
 * Join a league using an invite code
 * @param teamId - Optional team ID. If not provided, uses userId (primary team).
 *                 For secondary teams, pass `${userId}-secondary`
 */
export async function joinLeagueByCode(
  firestore: Firestore,
  code: string,
  userId: string,
  teamId?: string
): Promise<{ success: boolean; leagueId?: string; leagueName?: string; error?: string }> {
  try {
    // Use provided teamId or default to userId (primary team)
    const memberIdToAdd = teamId || userId;

    // Check if user has reached the max league limit (count both primary and secondary memberships)
    const userLeagues = await getUserLeagues(firestore, userId);
    const secondaryLeagues = await getUserLeagues(firestore, `${userId}-secondary`);
    const totalMemberships = userLeagues.length + secondaryLeagues.length;

    if (totalMemberships >= MAX_LEAGUES_PER_USER * 2) { // Allow double since user can have 2 teams
      return { success: false, error: `You have reached the maximum number of league memberships.` };
    }

    const normalizedCode = code.toUpperCase().trim();

    // Find league with matching invite code
    const leaguesRef = collection(firestore, 'leagues');
    const q = query(leaguesRef, where('inviteCode', '==', normalizedCode));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { success: false, error: 'Invalid invite code. Please check and try again.' };
    }

    const leagueDoc = snapshot.docs[0];
    const leagueData = leagueDoc.data() as League;

    // Check if this team is already a member
    if (leagueData.memberUserIds.includes(memberIdToAdd)) {
      return { success: false, error: 'This team is already a member of this league.' };
    }

    // Add team to league
    await updateDoc(leagueDoc.ref, {
      memberUserIds: arrayUnion(memberIdToAdd),
      updatedAt: serverTimestamp(),
    });

    return { success: true, leagueId: leagueDoc.id, leagueName: leagueData.name };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    console.error(`Error joining league [${correlationId}]:`, error);
    return { success: false, error: `${error.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-004-v03
// [Intent] Remove the requesting user from a league's memberUserIds array. Prevents leaving the global league and prevents the league owner from leaving (they must transfer ownership or delete instead).
// [Inbound Trigger] Called from the league management UI when a user chooses to leave a league.
// [Downstream Impact] Removes the user from the league's memberUserIds, hiding their scores from that league's standings. The league itself continues to exist. On failure, returns a correlation ID for error tracing.
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
    console.error(`Error leaving league [${correlationId}]:`, error);
    return { success: false, error: `${error.message} (ID: ${correlationId})` };
  }
}

// GUID: LIB_LEAGUES-005-v03
// [Intent] Query and return all leagues that contain the given userId (or teamId) in their memberUserIds array, using Firestore's array-contains query.
// [Inbound Trigger] Called by createLeague and joinLeagueByCode for limit checking, and by league listing UI components to display user's leagues.
// [Downstream Impact] Returns League[] used for display and limit validation. On error, returns an empty array (silent failure). Heavily used across the league system; changes to this query affect all league membership checks.
/**
 * Get all leagues a user belongs to
 */
export async function getUserLeagues(
  firestore: Firestore,
  userId: string
): Promise<League[]> {
  try {
    const leaguesRef = collection(firestore, 'leagues');
    const q = query(leaguesRef, where('memberUserIds', 'array-contains', userId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
    })) as League[];
  } catch (error: any) {
    console.error('Error fetching user leagues:', error);
    return [];
  }
}

// GUID: LIB_LEAGUES-006-v03
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
    console.error('Error fetching league:', error);
    return null;
  }
}

// GUID: LIB_LEAGUES-007-v03
// [Intent] Generate a new invite code for an existing league, replacing the old one. Only the league owner is authorised to perform this action, invalidating any previously shared invite codes.
// [Inbound Trigger] Called from the league settings UI when the owner requests a new invite code.
// [Downstream Impact] Overwrites the inviteCode field in the league document. Any previously shared codes immediately stop working. Returns the new code to the caller for display.
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
    console.error('Error regenerating invite code:', error);
    return { success: false, error: error.message };
  }
}

// GUID: LIB_LEAGUES-008-v03
// [Intent] Update the display name of a league. Only the league owner is authorised to rename. Trims whitespace from the new name before saving.
// [Inbound Trigger] Called from the league settings UI when the owner submits a new name.
// [Downstream Impact] Changes the league name displayed across all standings, league lists, and member views. The name field in the leagues document is updated.
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
    console.error('Error updating league name:', error);
    return { success: false, error: error.message };
  }
}

// GUID: LIB_LEAGUES-009-v03
// [Intent] Remove a specified member from a league's memberUserIds array. Only the league owner can remove members, and the owner cannot remove themselves.
// [Inbound Trigger] Called from the league member management UI when the owner removes a member.
// [Downstream Impact] The removed member loses access to the league standings and their scores are no longer visible in that league. The league continues to exist with remaining members.
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
    console.error('Error removing member:', error);
    return { success: false, error: error.message };
  }
}

// GUID: LIB_LEAGUES-010-v03
// [Intent] Permanently delete a league document from Firestore. Only the league owner can delete, and the global league is protected from deletion.
// [Inbound Trigger] Called from the league settings UI when the owner confirms league deletion.
// [Downstream Impact] The league document is permanently removed. All member associations are lost. Standings that reference this league will no longer find it. On failure, returns a correlation ID for error tracing.
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
    console.error(`Error deleting league [${correlationId}]:`, error);
    return { success: false, error: `${error.message} (ID: ${correlationId})` };
  }
}
