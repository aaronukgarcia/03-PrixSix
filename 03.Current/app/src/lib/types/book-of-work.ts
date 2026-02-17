/**
 * GUID: TYPES_BOOKOFWORK-000-v01
 * Intent: Define TypeScript interfaces and types for the centralized Book of Work system
 * Trigger: Admin needs to track all work items (security, UX, errors, feedback) in one place
 * Impact: Provides type safety for book_of_work Firestore collection and admin UI components
 */

import { Timestamp } from 'firebase/firestore';

/**
 * GUID: TYPES_BOOKOFWORK-001
 * Intent: Define all possible categories for work items
 * Trigger: Work items come from multiple sources (Vestige security, virgin.json UX, error logs, feedback)
 * Impact: Enables filtering and color-coding in admin UI
 */
export type BookOfWorkCategory =
  | 'security'           // Security vulnerabilities and audit findings
  | 'ui'                 // UX/UI improvements and design issues
  | 'feature'            // Feature requests and enhancements
  | 'cosmetic'           // Visual polish and minor tweaks
  | 'infrastructure'     // DevOps, build, deployment, tooling
  | 'system-error'       // Backend errors from error_logs collection
  | 'user-error';        // User-reported bugs from feedback collection

/**
 * GUID: TYPES_BOOKOFWORK-002
 * Intent: Define work item status lifecycle
 * Trigger: Admin needs to track progress from discovery to completion
 * Impact: Enables Kanban-style workflow and filtering by completion state
 */
export type BookOfWorkStatus =
  | 'tbd'                // To be done (default for new items)
  | 'in_progress'        // Currently being worked on
  | 'done'               // Completed and verified
  | 'wont_fix'           // Decided not to fix (with rationale)
  | 'duplicate';         // Duplicate of another entry

/**
 * GUID: TYPES_BOOKOFWORK-003
 * Intent: Define severity levels for prioritization
 * Trigger: Not all issues are equal - critical security bugs need urgent attention
 * Impact: Enables sorting by impact and risk
 */
export type BookOfWorkSeverity =
  | 'critical'           // System-breaking, security-critical
  | 'high'               // Major functionality affected
  | 'medium'             // Moderate impact
  | 'low'                // Minor issues
  | 'informational';     // Nice-to-have, no functional impact

/**
 * GUID: TYPES_BOOKOFWORK-004
 * Intent: Track original source of work item for audit trail
 * Trigger: Items migrated from 5+ different systems (Vestige, JSON files, Firestore collections)
 * Impact: Enables traceability back to original discovery context
 */
export type BookOfWorkSource =
  | 'vestige-security'   // From Vestige security audit nodes
  | 'vestige-redteam'    // From Vestige RedTeam GEMINI-AUDIT entries
  | 'virgin-ux'          // From virgin.json UX audit
  | 'error-log'          // From error_logs Firestore collection
  | 'feedback'           // From feedback Firestore collection
  | 'manual'             // Manually created by admin
  | 'historical';        // Completed work from previous sessions

/**
 * GUID: TYPES_BOOKOFWORK-005
 * Intent: Main interface for book_of_work Firestore document
 * Trigger: Need unified schema across all work item sources
 * Impact: Single source of truth for all work tracking in Prix Six
 */
export interface BookOfWorkEntry {
  // Core Identification
  id: string;                          // Auto-generated Firestore doc ID
  guid?: string;                       // Original GUID if from security audit (e.g., "GEMINI-AUDIT-059")
  referenceId?: string;                // Original reference (e.g., "BG-001", "VIRGIN-019")

  // Content
  title: string;                       // Short summary (100 chars max)
  description: string;                 // Full details (can be markdown)

  // Categorization
  category: BookOfWorkCategory;
  severity?: BookOfWorkSeverity;

  // Status Tracking
  status: BookOfWorkStatus;
  priority?: number;                   // 1-10 for manual sorting

  // Metadata
  source: BookOfWorkSource;
  sourceData?: {                       // Original source metadata
    correlationId?: string;            // From error_logs
    userId?: string;                   // From feedback
    nodeId?: string;                   // From Vestige
    [key: string]: any;                // Flexible additional fields
  };

  // Timestamps
  createdAt: Timestamp;                // When originally created/reported
  updatedAt: Timestamp;                // Last modification
  completedAt?: Timestamp;             // When marked Done

  // Version Tracking
  versionReported?: string;            // App version when issue found (e.g., "1.55.27")
  versionFixed?: string;               // App version when fixed (e.g., "1.56.7")
  commitHash?: string;                 // Git commit that fixed it
  fixedBy?: 'bill' | 'bob' | 'ben';    // Which Claude instance fixed the issue

  // Assignment & Ownership
  assignedTo?: string;                 // UID of assigned admin
  createdBy?: string;                  // UID who created entry
  updatedBy?: string;                  // UID who last updated

  // Additional Context
  module?: string;                     // File/module affected (e.g., "Firebase Admin Library")
  file?: string;                       // File path if applicable
  tags?: string[];                     // Flexible tagging (e.g., ["xss", "client-side", "urgent"])
}

/**
 * GUID: TYPES_BOOKOFWORK-006
 * Intent: Helper type for creating new entries (omits Firestore-managed fields)
 * Trigger: Admin UI and migration scripts need to create entries without IDs/timestamps
 * Impact: Type safety when calling addDoc() or batch.set()
 */
export type BookOfWorkEntryCreate = Omit<BookOfWorkEntry, 'id' | 'createdAt' | 'updatedAt'> & {
  createdAt?: Timestamp;               // Optional for migration scripts with historical dates
  updatedAt?: Timestamp;               // Optional for migration scripts
};

/**
 * GUID: TYPES_BOOKOFWORK-007
 * Intent: Helper type for updating existing entries
 * Trigger: Admin UI needs to update status, description, or other fields
 * Impact: Type safety when calling updateDoc() with partial updates
 */
export type BookOfWorkEntryUpdate = Partial<Omit<BookOfWorkEntry, 'id' | 'createdAt'>> & {
  updatedAt: Timestamp;                // Required: Always update modification timestamp
};

/**
 * GUID: TYPES_BOOKOFWORK-008
 * Intent: Summary statistics for admin dashboard
 * Trigger: Admin needs quick overview of work backlog
 * Impact: Displays counts by status and category in UI banner
 */
export interface BookOfWorkStats {
  total: number;
  byStatus: Record<BookOfWorkStatus, number>;
  byCategory: Record<BookOfWorkCategory, number>;
  lastUpdated: Date;
}
