import { Timestamp } from 'firebase/firestore';

// GUID: LIB_TYPES_LEAGUE-000-v03
// [Intent] Type definitions and constants for the league system. Leagues use a "lens" architecture —
//          they filter the master data without duplicating it. The global league covers all users;
//          custom leagues cover subsets. Invite codes and member arrays live on league documents only.
// [Inbound Trigger] Imported by lib/leagues.ts (operations), firebase/provider.tsx (context),
//                   and any component that displays or manages leagues.
// [Downstream Impact] Changes to the League interface require updates to Firestore read/write logic
//                     in leagues.ts and to all UI components that destructure league documents.
//                     Constants (GLOBAL_LEAGUE_ID, MAX_LEAGUES_PER_USER) are enforced in API routes —
//                     changing them without updating server-side validation will create inconsistencies.

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

// GUID: LIB_TYPES_LEAGUE-001-v03
// [Intent] League system constants defining identity values and business rules. These constants are
//          the single source of truth for league limits and special identifiers. GLOBAL_LEAGUE_ID and
//          SYSTEM_OWNER_ID identify the built-in system-wide league. INVITE_CODE_LENGTH defines the
//          format of join codes. MAX_LEAGUES_PER_USER enforces the per-user league cap (incl. global).
// [Inbound Trigger] Imported by lib/leagues.ts for validation logic and by the admin and league UI
//                   components for display. Also referenced in API route guards for limit enforcement.
// [Downstream Impact] Changing GLOBAL_LEAGUE_ID or SYSTEM_OWNER_ID requires a Firestore data migration
//                     for existing league documents. Changing MAX_LEAGUES_PER_USER changes join/create
//                     eligibility. Changing INVITE_CODE_LENGTH invalidates existing invite codes.
/**
 * Global league constants
 */
export const GLOBAL_LEAGUE_ID = 'global';
export const SYSTEM_OWNER_ID = 'system';
export const INVITE_CODE_LENGTH = 6;
export const MAX_LEAGUES_PER_USER = 5;  // Including global league
