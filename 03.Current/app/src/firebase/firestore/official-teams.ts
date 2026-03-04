// GUID: FS_OFFICIAL_TEAMS-000-v01
// [Intent] Client-side Firestore module for reading the official_teams collection.
//          Maps 2026 F1 team names → their two drivers (with OpenF1 driver numbers).
//          Driver numbers are the canonical join key to OpenF1 timing data.
// [Downstream Impact] Used by PubChatPanel Team Lens to filter live timing data
//                     by the correct drivers for a selected team.

import { collection, getDocs, Firestore } from 'firebase/firestore';

// GUID: FS_OFFICIAL_TEAMS-001-v01
// [Intent] Shape of a driver entry within an official team document.
export interface OfficialDriver {
  surname: string;
  fullName: string;
  number: number;
}

// GUID: FS_OFFICIAL_TEAMS-002-v01
// [Intent] Shape of a team document in the official_teams collection.
export interface OfficialTeam {
  id: string;            // Firestore document ID (e.g. "williams")
  teamName: string;      // Display name (e.g. "Williams")
  teamColour: string;    // Hex without # (e.g. "00A0DE")
  openf1TeamName: string; // Team name as returned by OpenF1 API
  season: number;
  drivers: OfficialDriver[];
}

// GUID: FS_OFFICIAL_TEAMS-003-v01
// [Intent] Fetch all official team documents from Firestore (11 teams).
//          Returns empty array on error — Team Lens degrades gracefully to string matching.
// [Inbound Trigger] Called by PubChatPanel on mount.
// [Downstream Impact] Teams cached in component state; used to resolve driver numbers for Team Lens.
export async function getOfficialTeams(db: Firestore): Promise<OfficialTeam[]> {
  try {
    const snap = await getDocs(collection(db, 'official_teams'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as OfficialTeam));
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[official_teams] Failed to load:', error);
    }
    return [];
  }
}
