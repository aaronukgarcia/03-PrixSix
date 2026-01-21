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

/**
 * Generate a random 6-character alphanumeric invite code
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar-looking chars (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

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

/**
 * Join a league using an invite code
 */
export async function joinLeagueByCode(
  firestore: Firestore,
  code: string,
  userId: string
): Promise<{ success: boolean; leagueId?: string; leagueName?: string; error?: string }> {
  try {
    // Check if user has reached the max league limit
    const userLeagues = await getUserLeagues(firestore, userId);
    if (userLeagues.length >= MAX_LEAGUES_PER_USER) {
      return { success: false, error: `You can only be a member of ${MAX_LEAGUES_PER_USER} leagues. Please leave a league before joining a new one.` };
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

    // Check if already a member
    if (leagueData.memberUserIds.includes(userId)) {
      return { success: false, error: 'You are already a member of this league.' };
    }

    // Add user to league
    await updateDoc(leagueDoc.ref, {
      memberUserIds: arrayUnion(userId),
      updatedAt: serverTimestamp(),
    });

    return { success: true, leagueId: leagueDoc.id, leagueName: leagueData.name };
  } catch (error: any) {
    const correlationId = getCorrelationId();
    console.error(`Error joining league [${correlationId}]:`, error);
    return { success: false, error: `${error.message} (ID: ${correlationId})` };
  }
}

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
