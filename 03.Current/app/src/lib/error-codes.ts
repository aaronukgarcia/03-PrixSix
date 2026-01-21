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
 *   9xxx - Unknown/Unexpected Errors
 */

export const ERROR_CODES = {
  // 1xxx - Authentication & Authorization
  AUTH_INVALID_TOKEN: { code: 'PX-1001', message: 'Invalid or missing authentication token' },
  AUTH_ADMIN_REQUIRED: { code: 'PX-1002', message: 'Admin access required' },
  AUTH_USER_NOT_FOUND: { code: 'PX-1003', message: 'User not found' },
  AUTH_SESSION_EXPIRED: { code: 'PX-1004', message: 'Session expired - please log in again' },
  AUTH_DOMAIN_NOT_ALLOWED: { code: 'PX-1005', message: 'Domain not allowlisted for email verification' },

  // 2xxx - Data Validation
  VALIDATION_MISSING_FIELDS: { code: 'PX-2001', message: 'Missing required fields' },
  VALIDATION_INVALID_FORMAT: { code: 'PX-2002', message: 'Invalid data format' },
  VALIDATION_DUPLICATE_ENTRY: { code: 'PX-2003', message: 'Duplicate entry detected' },

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

  // 9xxx - Unknown/Unexpected
  UNKNOWN_ERROR: { code: 'PX-9001', message: 'An unexpected error occurred' },
  NETWORK_ERROR: { code: 'PX-9002', message: 'Network error - please check your connection' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface AppError {
  code: string;
  message: string;
  correlationId: string;
  details?: string;
  logged: boolean;
}

/**
 * Generate a unique correlation ID for error tracking
 * Format: err_[timestamp-base36]_[random-6-chars]
 */
export function generateClientCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `err_${timestamp}_${random}`;
}

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
