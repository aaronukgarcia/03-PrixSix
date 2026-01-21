import { Timestamp } from 'firebase/firestore';

/**
 * League - Represents a group of users who can view standings together
 * Uses "lens" architecture: leagues filter master data, not duplicate it
 */
export interface League {
  id: string;
  name: string;
  ownerId: string;              // Auth UID of creator ("system" for global)
  memberUserIds: string[];      // Array of Auth UIDs
  isGlobal: boolean;            // true = the default "everyone" league
  inviteCode?: string;          // 6-char code for joining (e.g., "ABC123")
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * CreateLeagueData - Data required to create a new league
 */
export interface CreateLeagueData {
  name: string;
  ownerId: string;
}

/**
 * LeagueWithMemberCount - League with computed member count for display
 */
export interface LeagueWithMemberCount extends League {
  memberCount: number;
}

/**
 * Global league constants
 */
export const GLOBAL_LEAGUE_ID = 'global';
export const SYSTEM_OWNER_ID = 'system';
export const INVITE_CODE_LENGTH = 6;
export const MAX_LEAGUES_PER_USER = 5;  // Including global league
