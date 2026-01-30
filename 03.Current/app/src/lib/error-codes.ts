// GUID: LIB_ERROR_CODES-000-v03
// [Intent] Central error code registry and error handling utilities for the Prix Six application.
//          Defines all PX-xxxx error codes, correlation ID generation, error object creation,
//          display formatting, and error-to-code mapping. Implements Golden Rule #1.
// [Inbound Trigger] Imported by every API route, server action, and client component that handles errors.
// [Downstream Impact] Adding/changing/removing error codes affects all error handling across the app.
//                     Correlation ID format changes affect error log queries and user-reported error lookups.

// GUID: LIB_ERROR_CODES-001-v03
// [Intent] Master registry of all application error codes organised by category.
//          Each code has a unique PX-xxxx identifier and a human-readable message.
//          Categories: 1xxx=Auth, 2xxx=Validation, 3xxx=External, 4xxx=Firestore,
//          5xxx=Race/Scoring, 6xxx=Session, 7xxx=Backup, 9xxx=Unknown.
// [Inbound Trigger] Referenced by every catch block in the application to map errors to user-facing codes.
// [Downstream Impact] Removing or renaming a key breaks any code referencing that ErrorCode key.
//                     Changing a message alters what users see in error toasts and alerts.
/**
 * Prix Six Global Error Code System
 *
 * STANDARD: Every user-facing error must include:
 * 1. Unique Error Type Number (from this file)
 * 2. Correlation ID (for the specific instance)
 * 3. Selectable text in the UI
 * 4. Server-side log confirmation
 *
 * Format: PX-[CATEGORY][NUMBER]
 * Categories:
 *   1xxx - Authentication & Authorization
 *   2xxx - Data Validation
 *   3xxx - External Services (Email, AI, etc.)
 *   4xxx - Firestore Operations
 *   5xxx - Race/Scoring Logic
 *   6xxx - Session Management
 *   7xxx - Backup & Recovery
 *   9xxx - Unknown/Unexpected Errors
 */

export const ERROR_CODES = {
  // 1xxx - Authentication & Authorization
  AUTH_INVALID_TOKEN: { code: 'PX-1001', message: 'Invalid or missing authentication token' },
  AUTH_ADMIN_REQUIRED: { code: 'PX-1002', message: 'Admin access required' },
  AUTH_USER_NOT_FOUND: { code: 'PX-1003', message: 'User not found' },
  AUTH_SESSION_EXPIRED: { code: 'PX-1004', message: 'Session expired - please log in again' },
  AUTH_DOMAIN_NOT_ALLOWED: { code: 'PX-1005', message: 'Domain not allowlisted for email verification' },
  AUTH_PIN_RESET_FAILED: { code: 'PX-1006', message: 'PIN reset failed' },
  AUTH_PERMISSION_DENIED: { code: 'PX-1007', message: 'Permission denied' },

  // 2xxx - Data Validation
  VALIDATION_MISSING_FIELDS: { code: 'PX-2001', message: 'Missing required fields' },
  VALIDATION_INVALID_FORMAT: { code: 'PX-2002', message: 'Invalid data format' },
  VALIDATION_DUPLICATE_ENTRY: { code: 'PX-2003', message: 'Duplicate entry detected' },
  VALIDATION_SECONDARY_EMAIL_SAME: { code: 'PX-2004', message: 'Secondary email cannot be the same as primary email' },
  VALIDATION_SECONDARY_EMAIL_IN_USE: { code: 'PX-2005', message: 'This email is already in use' },

  // 3xxx - External Services
  EMAIL_SEND_FAILED: { code: 'PX-3001', message: 'Failed to send email' },
  EMAIL_RATE_LIMITED: { code: 'PX-3002', message: 'Email rate limit exceeded' },
  EMAIL_DAILY_LIMIT: { code: 'PX-3003', message: 'Daily email limit reached' },
  EMAIL_CONFIG_MISSING: { code: 'PX-3004', message: 'Email service not configured' },
  AI_GENERATION_FAILED: { code: 'PX-3101', message: 'AI content generation failed' },

  // 4xxx - Firestore Operations
  FIRESTORE_READ_FAILED: { code: 'PX-4001', message: 'Failed to read from database' },
  FIRESTORE_WRITE_FAILED: { code: 'PX-4002', message: 'Failed to write to database' },
  FIRESTORE_BATCH_FAILED: { code: 'PX-4003', message: 'Batch operation failed' },
  FIRESTORE_INDEX_REQUIRED: { code: 'PX-4004', message: 'Database index required' },

  // 5xxx - Race/Scoring Logic
  RACE_NOT_FOUND: { code: 'PX-5001', message: 'Race not found' },
  RACE_ALREADY_SUBMITTED: { code: 'PX-5002', message: 'Race results already submitted' },
  SCORE_CALCULATION_FAILED: { code: 'PX-5003', message: 'Score calculation failed' },
  PREDICTION_LOCKED: { code: 'PX-5004', message: 'Predictions are locked for this race' },
  PREDICTION_INCOMPLETE: { code: 'PX-5005', message: 'Prediction is incomplete' },

  // 6xxx - Session Management
  SESSION_INVALID: { code: 'PX-6001', message: 'Invalid session' },
  SESSION_TIMEOUT: { code: 'PX-6002', message: 'Session timed out due to inactivity' },
  SESSION_CONFLICT: { code: 'PX-6003', message: 'Session conflict detected' },

  // GUID: BACKUP_ERRORS-001-v03
  // [Intent] Define the PX-7xxx error code family for the backup & recovery system.
  //          Each code maps to a specific failure mode in the dailyBackup or
  //          runRecoveryTest Cloud Functions, or in the admin dashboard's status read.
  // [Inbound Trigger] Referenced by BackupHealthDashboard (PX-7001) and
  //                   Cloud Functions index.js (PX-7002..PX-7007 via structured logs).
  // [Downstream Impact] Displayed in the admin Error Log tab (ErrorLogViewer PX-7 category)
  //                     and the Backup Health dashboard (PX-7001 inline alert).
  // 7xxx - Backup & Recovery
  BACKUP_STATUS_READ_FAILED: { code: 'PX-7001', message: 'Failed to read backup status' },
  BACKUP_EXPORT_FAILED: { code: 'PX-7002', message: 'Firestore backup export failed' },
  BACKUP_AUTH_EXPORT_FAILED: { code: 'PX-7003', message: 'Auth data backup export failed' },
  BACKUP_SMOKE_TEST_FAILED: { code: 'PX-7004', message: 'Backup smoke test failed' },
  BACKUP_RESTORE_FAILED: { code: 'PX-7005', message: 'Backup restore failed' },
  BACKUP_CLEANUP_FAILED: { code: 'PX-7006', message: 'Backup cleanup failed' },
  BACKUP_HEARTBEAT_FAILED: { code: 'PX-7007', message: 'Backup heartbeat missing - backup may not be running' },

  // 9xxx - Unknown/Unexpected
  UNKNOWN_ERROR: { code: 'PX-9001', message: 'An unexpected error occurred' },
  NETWORK_ERROR: { code: 'PX-9002', message: 'Network error - please check your connection' },
} as const;

// GUID: LIB_ERROR_CODES-002-v03
// [Intent] Derive a union type of all valid error code keys for type-safe error code references.
// [Inbound Trigger] Used as a parameter type in createAppError, mapErrorToCode, and throughout error handling code.
// [Downstream Impact] Adding or removing keys from ERROR_CODES automatically updates this type.
export type ErrorCode = keyof typeof ERROR_CODES;

// GUID: LIB_ERROR_CODES-003-v03
// [Intent] Define the shape of a structured application error with all four pillars
//          required by Golden Rule #1: code, message, correlationId, and logged status.
// [Inbound Trigger] Returned by createAppError and consumed by formatErrorForDisplay and error handlers.
// [Downstream Impact] Changing this interface affects all error creation and display logic in the app.
export interface AppError {
  code: string;
  message: string;
  correlationId: string;
  details?: string;
  logged: boolean;
}

// GUID: LIB_ERROR_CODES-004-v03
// [Intent] Generate a unique client-side correlation ID for error tracking.
//          Format: err_[timestamp-base36]_[random-6-chars] — short, unique, and copyable.
// [Inbound Trigger] Called in client-side catch blocks to create a per-error-instance identifier
//                   that the user can report via WhatsApp or email.
// [Downstream Impact] The correlation ID links user-reported errors to server-side error_logs entries.
//                     Changing the format requires updating any log queries that parse correlation IDs.
/**
 * Generate a unique correlation ID for error tracking
 * Format: err_[timestamp-base36]_[random-6-chars]
 */
export function generateClientCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `err_${timestamp}_${random}`;
}

// GUID: LIB_ERROR_CODES-005-v03
// [Intent] Factory function to create a fully populated AppError object from an error code key,
//          correlation ID, and optional details. Ensures all four Golden Rule #1 pillars are present.
// [Inbound Trigger] Called by API routes and components after catching an error and generating a correlation ID.
// [Downstream Impact] The returned AppError is passed to formatErrorForDisplay for user-facing rendering
//                     and to logError for server-side persistence.
/**
 * Create an AppError object with all required fields
 */
export function createAppError(
  errorCode: ErrorCode,
  correlationId: string,
  details?: string
): AppError {
  const errorDef = ERROR_CODES[errorCode];
  return {
    code: errorDef.code,
    message: errorDef.message,
    correlationId,
    details,
    logged: false, // Will be set to true after server logging
  };
}

// GUID: LIB_ERROR_CODES-006-v03
// [Intent] Format an AppError into title, description, and copyable text for UI display.
//          Ensures the user can select and copy the error code + correlation ID (Golden Rule #1, Pillar 4).
// [Inbound Trigger] Called by toast/alert components when rendering an error to the user.
// [Downstream Impact] Changes to the copyableText format affect what users paste into WhatsApp/email
//                     when reporting errors. Support workflows depend on this format being parseable.
/**
 * Format an error for display in a toast/alert
 * Returns selectable text that users can copy
 */
export function formatErrorForDisplay(error: AppError): {
  title: string;
  description: string;
  copyableText: string;
} {
  const copyableText = `Error ${error.code} | ID: ${error.correlationId}${error.details ? ` | ${error.details}` : ''}`;

  return {
    title: `Error ${error.code}`,
    description: error.message,
    copyableText,
  };
}

// GUID: LIB_ERROR_CODES-007-v03
// [Intent] Heuristically map a raw error message string to the most appropriate ErrorCode key.
//          Provides a best-effort classification when the calling code does not know the specific error type.
// [Inbound Trigger] Called by generic catch blocks that receive untyped Error objects and need to
//                   assign a PX-xxxx code for user display and logging.
// [Downstream Impact] If mapping rules change, errors may be classified differently in logs and UI.
//                     Falls back to UNKNOWN_ERROR if no pattern matches.
/**
 * Map common error messages to error codes
 */
export function mapErrorToCode(error: Error | string): ErrorCode {
  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('authentication')) {
    return 'AUTH_INVALID_TOKEN';
  }
  if (lowerMessage.includes('admin')) {
    return 'AUTH_ADMIN_REQUIRED';
  }
  if (lowerMessage.includes('rate limit')) {
    return 'EMAIL_RATE_LIMITED';
  }
  if (lowerMessage.includes('daily') && lowerMessage.includes('limit')) {
    return 'EMAIL_DAILY_LIMIT';
  }
  if (lowerMessage.includes('email') && lowerMessage.includes('fail')) {
    return 'EMAIL_SEND_FAILED';
  }
  if (lowerMessage.includes('domain') && lowerMessage.includes('allowlist')) {
    return 'AUTH_DOMAIN_NOT_ALLOWED';
  }
  if (lowerMessage.includes('index')) {
    return 'FIRESTORE_INDEX_REQUIRED';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN_ERROR';
}
