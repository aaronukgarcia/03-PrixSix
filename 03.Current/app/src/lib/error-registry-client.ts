// GUID: ERROR_REGISTRY_CLIENT-000-v01
// @SECURITY_FIX: GEMINI-AUDIT-058 — Created client-safe error registry.
//   The full error-registry.ts contains internal metadata (guid, module, file path,
//   functionName, recovery, failureModes, calledBy, calls) that should NOT be bundled
//   into client-side JavaScript where it is accessible to any user via browser DevTools.
//   This file re-exports only the safe subset of each error definition (key, code,
//   message, severity) for use in client components and pages.
//   Server-side code (API routes, lib utilities) should continue importing from
//   '@/lib/error-registry' to retain full diagnostic metadata.
// [Intent] Provide a client-safe ERRORS map that exposes only user-facing fields.
//          Prevents internal file paths, GUID identifiers, and module names from being
//          bundled into client JS and exposed via browser DevTools / network inspection.
// [Inbound Trigger] Imported by any 'use client' component or page that needs error codes
//                   or messages for display, correlation ID logging, or API error body construction.
// [Downstream Impact] Reduces the client JS bundle payload. Sensitive internal metadata
//                     (guid, module, file, functionName, recovery, failureModes, calledBy,
//                     calls) is stripped — only key, code, message, and severity remain.

// Safe subset of ErrorDefinition — contains only fields appropriate for client bundles.
export interface ClientErrorDefinition {
  key: string;
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

/**
 * Client-safe error definitions. Only includes user-facing fields.
 * Server-side code should use the full ERRORS from '@/lib/error-registry'.
 */
export const CLIENT_ERRORS: Record<string, ClientErrorDefinition> = {
  AUTH_INVALID_TOKEN:             { key: 'AUTH_INVALID_TOKEN',             code: 'PX-1001', message: 'Invalid or missing authentication token',                                  severity: 'error'    },
  AUTH_ADMIN_REQUIRED:            { key: 'AUTH_ADMIN_REQUIRED',            code: 'PX-1002', message: 'Admin access required',                                                    severity: 'error'    },
  AUTH_USER_NOT_FOUND:            { key: 'AUTH_USER_NOT_FOUND',            code: 'PX-1003', message: 'User not found',                                                           severity: 'error'    },
  AUTH_SESSION_EXPIRED:           { key: 'AUTH_SESSION_EXPIRED',           code: 'PX-1004', message: 'Session expired - please log in again',                                    severity: 'error'    },
  AUTH_DOMAIN_NOT_ALLOWED:        { key: 'AUTH_DOMAIN_NOT_ALLOWED',        code: 'PX-1005', message: 'Domain not allowlisted for email verification',                            severity: 'error'    },
  AUTH_PIN_RESET_FAILED:          { key: 'AUTH_PIN_RESET_FAILED',          code: 'PX-1006', message: 'PIN reset failed',                                                         severity: 'error'    },
  AUTH_PERMISSION_DENIED:         { key: 'AUTH_PERMISSION_DENIED',         code: 'PX-1007', message: 'Permission denied',                                                        severity: 'error'    },
  AUTH_SIGNIN_VERIFICATION_FAILED:{ key: 'AUTH_SIGNIN_VERIFICATION_FAILED',code: 'PX-1008', message: 'Sign-in verification failed',                                              severity: 'error'    },
  AUTH_LOGIN_TIMEOUT:             { key: 'AUTH_LOGIN_TIMEOUT',             code: 'PX-1009', message: 'Login verification timed out',                                             severity: 'error'    },
  AUTH_OAUTH_POPUP_BLOCKED:       { key: 'AUTH_OAUTH_POPUP_BLOCKED',       code: 'PX-1010', message: 'Sign-in popup was blocked by the browser',                                 severity: 'error'    },
  AUTH_OAUTH_POPUP_CLOSED:        { key: 'AUTH_OAUTH_POPUP_CLOSED',        code: 'PX-1011', message: 'Sign-in popup was closed before completing',                               severity: 'error'    },
  AUTH_OAUTH_ACCOUNT_EXISTS:      { key: 'AUTH_OAUTH_ACCOUNT_EXISTS',      code: 'PX-1012', message: 'An account already exists with a different sign-in method',                severity: 'error'    },
  AUTH_OAUTH_LINK_FAILED:         { key: 'AUTH_OAUTH_LINK_FAILED',         code: 'PX-1013', message: 'Failed to link sign-in provider',                                          severity: 'error'    },
  AUTH_OAUTH_REDIRECT_FAILED:     { key: 'AUTH_OAUTH_REDIRECT_FAILED',     code: 'PX-1014', message: 'Sign-in redirect failed',                                                  severity: 'error'    },
  AUTH_OAUTH_APPLE_NONCE:         { key: 'AUTH_OAUTH_APPLE_NONCE',         code: 'PX-1015', message: 'Apple sign-in nonce verification failed',                                  severity: 'error'    },
  AUTH_OAUTH_PROFILE_INCOMPLETE:  { key: 'AUTH_OAUTH_PROFILE_INCOMPLETE',  code: 'PX-1016', message: 'Profile incomplete \u2014 please enter your team name',                   severity: 'error'    },
  AUTH_OAUTH_PROVIDER_ERROR:      { key: 'AUTH_OAUTH_PROVIDER_ERROR',      code: 'PX-1017', message: 'Sign-in provider error',                                                   severity: 'error'    },
  VALIDATION_MISSING_FIELDS:      { key: 'VALIDATION_MISSING_FIELDS',      code: 'PX-2001', message: 'Missing required fields',                                                  severity: 'warning'  },
  VALIDATION_INVALID_FORMAT:      { key: 'VALIDATION_INVALID_FORMAT',      code: 'PX-2002', message: 'Invalid data format',                                                      severity: 'warning'  },
  VALIDATION_DUPLICATE_ENTRY:     { key: 'VALIDATION_DUPLICATE_ENTRY',     code: 'PX-2003', message: 'Duplicate entry detected',                                                 severity: 'warning'  },
  VALIDATION_SECONDARY_EMAIL_SAME:{ key: 'VALIDATION_SECONDARY_EMAIL_SAME',code: 'PX-2004', message: 'Secondary email cannot be the same as primary email',                     severity: 'warning'  },
  VALIDATION_SECONDARY_EMAIL_IN_USE:{ key: 'VALIDATION_SECONDARY_EMAIL_IN_USE', code: 'PX-2005', message: 'This email is already in use',                                       severity: 'warning'  },
  VALIDATION_NULL_DRIVER:         { key: 'VALIDATION_NULL_DRIVER',         code: 'PX-2010', message: 'Race result contains null or empty driver',                                severity: 'warning'  },
  VALIDATION_DUPLICATE_DRIVER:    { key: 'VALIDATION_DUPLICATE_DRIVER',    code: 'PX-2011', message: 'Race result contains duplicate drivers',                                   severity: 'warning'  },
  VALIDATION_BUSINESS_RULE:       { key: 'VALIDATION_BUSINESS_RULE',       code: 'PX-2012', message: 'Business rule violation',                                                  severity: 'warning'  },
  EMAIL_SEND_FAILED:              { key: 'EMAIL_SEND_FAILED',              code: 'PX-3001', message: 'Failed to send email',                                                     severity: 'error'    },
  EMAIL_RATE_LIMITED:             { key: 'EMAIL_RATE_LIMITED',             code: 'PX-3002', message: 'Email rate limit exceeded',                                                severity: 'error'    },
  EMAIL_DAILY_LIMIT:              { key: 'EMAIL_DAILY_LIMIT',              code: 'PX-3003', message: 'Daily email limit reached',                                                severity: 'error'    },
  EMAIL_CONFIG_MISSING:           { key: 'EMAIL_CONFIG_MISSING',           code: 'PX-3004', message: 'Email service not configured',                                             severity: 'error'    },
  AI_GENERATION_FAILED:           { key: 'AI_GENERATION_FAILED',           code: 'PX-3101', message: 'AI content generation failed',                                             severity: 'error'    },
  OPENF1_FETCH_FAILED:            { key: 'OPENF1_FETCH_FAILED',            code: 'PX-3201', message: 'OpenF1 API request failed',                                                severity: 'error'    },
  OPENF1_NO_DATA:                 { key: 'OPENF1_NO_DATA',                 code: 'PX-3202', message: 'No timing data returned from OpenF1',                                      severity: 'error'    },
  OPENF1_PARSE_FAILED:            { key: 'OPENF1_PARSE_FAILED',            code: 'PX-3203', message: 'Failed to parse OpenF1 response',                                          severity: 'error'    },
  PIT_WALL_FETCH_FAILED:          { key: 'PIT_WALL_FETCH_FAILED',          code: 'PX-3301', message: 'Pit Wall live data fetch failed',                                           severity: 'error'    },
  PIT_WALL_NO_SESSION:            { key: 'PIT_WALL_NO_SESSION',            code: 'PX-3302', message: 'No active F1 session found',                                                severity: 'warning'  },
  PIT_WALL_PARTIAL_DATA:          { key: 'PIT_WALL_PARTIAL_DATA',          code: 'PX-3303', message: 'Some Pit Wall data could not be loaded',                                    severity: 'warning'  },
  PIT_WALL_RADIO_UNAVAIL:         { key: 'PIT_WALL_RADIO_UNAVAIL',         code: 'PX-3304', message: 'Team radio data unavailable for this session',                              severity: 'info'     },
  PIT_WALL_RAIN_FETCH_FAILED:     { key: 'PIT_WALL_RAIN_FETCH_FAILED',     code: 'PX-3305', message: 'Weather radar data could not be loaded',                                    severity: 'info'     },
  PIT_WALL_HISTORICAL_LOOKUP_FAILED: { key: 'PIT_WALL_HISTORICAL_LOOKUP_FAILED', code: 'PX-3306', message: 'Could not look up historical sessions for showreel',              severity: 'warning'  },
  PIT_WALL_HISTORICAL_REPLAY_FAILED: { key: 'PIT_WALL_HISTORICAL_REPLAY_FAILED', code: 'PX-3307', message: 'Historical replay data could not be loaded',                      severity: 'warning'  },
  PIT_WALL_SHOWREEL_NO_SESSIONS:  { key: 'PIT_WALL_SHOWREEL_NO_SESSIONS',  code: 'PX-3308', message: 'No 2025 historical sessions found for this circuit',                    severity: 'info'     },
  PIT_WALL_OPENF1_RESTRICTED:     { key: 'PIT_WALL_OPENF1_RESTRICTED',     code: 'PX-3309', message: 'OpenF1 historical data restricted during live session',                 severity: 'info'     },
  PIT_WALL_SHOWREEL_SCHEDULE_FAILED: { key: 'PIT_WALL_SHOWREEL_SCHEDULE_FAILED', code: 'PX-3310', message: 'Could not build showreel schedule',                               severity: 'warning'  },
  PIT_WALL_REPLAY_LOAD_FAILED:       { key: 'PIT_WALL_REPLAY_LOAD_FAILED',       code: 'PX-3311', message: 'GPS replay data could not be loaded',                                severity: 'error'    },
  PIT_WALL_REPLAY_SESSIONS_FAILED:   { key: 'PIT_WALL_REPLAY_SESSIONS_FAILED',   code: 'PX-3312', message: 'Could not load available replay sessions',                           severity: 'error'    },
  PIT_WALL_REPLAY_INGEST_FAILED:     { key: 'PIT_WALL_REPLAY_INGEST_FAILED',     code: 'PX-3313', message: 'Replay ingest from OpenF1 failed',                                       severity: 'error'    },
  PIT_WALL_REPLAY_INGEST_IN_PROGRESS:{ key: 'PIT_WALL_REPLAY_INGEST_IN_PROGRESS',code: 'PX-3314', message: 'Replay ingest already in progress for this session',                     severity: 'info'     },
  PIT_WALL_REPLAY_CHUNKS_FAILED:     { key: 'PIT_WALL_REPLAY_CHUNKS_FAILED',     code: 'PX-3315', message: 'Could not load replay chunks from Firestore',                             severity: 'error'    },
  PIT_WALL_REPLAY_PURGE_FAILED:      { key: 'PIT_WALL_REPLAY_PURGE_FAILED',      code: 'PX-3316', message: 'Failed to purge replay data',                                             severity: 'error'    },
  PIT_WALL_REPLAY_META_NOT_FOUND:    { key: 'PIT_WALL_REPLAY_META_NOT_FOUND',    code: 'PX-3317', message: 'Replay metadata not found in Firestore',                                  severity: 'warning'  },
  PIT_WALL_HEALTH_CHECK_FAILED:     { key: 'PIT_WALL_HEALTH_CHECK_FAILED',     code: 'PX-3318', message: 'Pit Wall health check failed',                                              severity: 'error'    },
  PIT_WALL_CACHE_PURGE_FAILED:      { key: 'PIT_WALL_CACHE_PURGE_FAILED',      code: 'PX-3319', message: 'Failed to purge Pit Wall cache',                                            severity: 'error'    },
  PIT_WALL_METRICS_FAILED:          { key: 'PIT_WALL_METRICS_FAILED',          code: 'PX-3320', message: 'Failed to collect Pit Wall process metrics',                                    severity: 'warning'  },
  PIT_WALL_INGEST_TRIGGER_FAILED: { key: 'PIT_WALL_INGEST_TRIGGER_FAILED', code: 'PX-3321', message: 'Failed to trigger replay ingest',                                            severity: 'error'    },
  FIRESTORE_READ_FAILED:          { key: 'FIRESTORE_READ_FAILED',          code: 'PX-4001', message: 'Failed to read from database',                                             severity: 'error'    },
  FIRESTORE_WRITE_FAILED:         { key: 'FIRESTORE_WRITE_FAILED',         code: 'PX-4002', message: 'Failed to write to database',                                              severity: 'error'    },
  FIRESTORE_BATCH_FAILED:         { key: 'FIRESTORE_BATCH_FAILED',         code: 'PX-4003', message: 'Batch operation failed',                                                   severity: 'error'    },
  FIRESTORE_INDEX_REQUIRED:       { key: 'FIRESTORE_INDEX_REQUIRED',       code: 'PX-4004', message: 'Database index required',                                                  severity: 'error'    },
  FIRESTORE_COLLECTION_GROUP_FAILED:{ key: 'FIRESTORE_COLLECTION_GROUP_FAILED', code: 'PX-4005', message: 'Collection group query failed',                                      severity: 'error'    },
  RACE_NOT_FOUND:                 { key: 'RACE_NOT_FOUND',                 code: 'PX-5001', message: 'Race not found',                                                           severity: 'error'    },
  RACE_ALREADY_SUBMITTED:         { key: 'RACE_ALREADY_SUBMITTED',         code: 'PX-5002', message: 'Race results already submitted',                                           severity: 'error'    },
  SCORE_CALCULATION_FAILED:       { key: 'SCORE_CALCULATION_FAILED',       code: 'PX-5003', message: 'Score calculation failed',                                                 severity: 'error'    },
  PREDICTION_LOCKED:              { key: 'PREDICTION_LOCKED',              code: 'PX-5004', message: 'Predictions are locked for this race',                                     severity: 'error'    },
  PREDICTION_INCOMPLETE:          { key: 'PREDICTION_INCOMPLETE',          code: 'PX-5005', message: 'Prediction is incomplete',                                                 severity: 'error'    },
  SCORE_WRITE_FAILED:             { key: 'SCORE_WRITE_FAILED',             code: 'PX-5006', message: 'Failed to write score to database',                                        severity: 'error'    },
  SCORE_DELETE_FAILED:            { key: 'SCORE_DELETE_FAILED',            code: 'PX-5007', message: 'Failed to delete score from database',                                     severity: 'error'    },
  SCORE_STANDINGS_FAILED:         { key: 'SCORE_STANDINGS_FAILED',         code: 'PX-5008', message: 'Failed to calculate standings',                                            severity: 'error'    },
  SCORE_USER_LOOKUP_FAILED:       { key: 'SCORE_USER_LOOKUP_FAILED',       code: 'PX-5009', message: 'Failed to look up user data during scoring',                               severity: 'error'    },
  SESSION_INVALID:                { key: 'SESSION_INVALID',                code: 'PX-6001', message: 'Invalid session',                                                          severity: 'error'    },
  SESSION_TIMEOUT:                { key: 'SESSION_TIMEOUT',                code: 'PX-6002', message: 'Session timed out due to inactivity',                                      severity: 'error'    },
  SESSION_CONFLICT:               { key: 'SESSION_CONFLICT',               code: 'PX-6003', message: 'Session conflict detected',                                                severity: 'error'    },
  LOGON_RECORD_FAILED:            { key: 'LOGON_RECORD_FAILED',            code: 'PX-6004', message: 'Failed to record logon event',                                             severity: 'warning'  },
  LOGON_LOGOUT_FAILED:            { key: 'LOGON_LOGOUT_FAILED',            code: 'PX-6005', message: 'Failed to record logout event',                                            severity: 'error'    },
  LOGON_EXPIRY_FAILED:            { key: 'LOGON_EXPIRY_FAILED',            code: 'PX-6006', message: 'Failed to expire stale session',                                           severity: 'error'    },
  BACKUP_STATUS_READ_FAILED:      { key: 'BACKUP_STATUS_READ_FAILED',      code: 'PX-7001', message: 'Failed to read backup status',                                             severity: 'critical' },
  BACKUP_EXPORT_FAILED:           { key: 'BACKUP_EXPORT_FAILED',           code: 'PX-7002', message: 'Firestore backup export failed',                                           severity: 'critical' },
  BACKUP_AUTH_EXPORT_FAILED:      { key: 'BACKUP_AUTH_EXPORT_FAILED',      code: 'PX-7003', message: 'Auth data backup export failed',                                           severity: 'critical' },
  BACKUP_SMOKE_TEST_FAILED:       { key: 'BACKUP_SMOKE_TEST_FAILED',       code: 'PX-7004', message: 'Backup smoke test failed',                                                 severity: 'critical' },
  BACKUP_RESTORE_FAILED:          { key: 'BACKUP_RESTORE_FAILED',          code: 'PX-7005', message: 'Backup restore failed',                                                    severity: 'critical' },
  BACKUP_CLEANUP_FAILED:          { key: 'BACKUP_CLEANUP_FAILED',          code: 'PX-7006', message: 'Backup cleanup failed',                                                    severity: 'critical' },
  BACKUP_HEARTBEAT_FAILED:        { key: 'BACKUP_HEARTBEAT_FAILED',        code: 'PX-7007', message: 'Backup heartbeat missing - backup may not be running',                     severity: 'critical' },
  ATTACK_LOG_FAILED:              { key: 'ATTACK_LOG_FAILED',              code: 'PX-8001', message: 'Failed to log login attempt',                                              severity: 'error'    },
  ATTACK_ALERT_FAILED:            { key: 'ATTACK_ALERT_FAILED',            code: 'PX-8002', message: 'Failed to create attack alert',                                            severity: 'error'    },
  ATTACK_LOG_WRITE_FAILED:        { key: 'ATTACK_LOG_WRITE_FAILED',        code: 'PX-8003', message: 'Failed to write login attempt to database',                                severity: 'error'    },
  ATTACK_CHECK_FAILED:            { key: 'ATTACK_CHECK_FAILED',            code: 'PX-8004', message: 'Attack detection check failed',                                            severity: 'error'    },
  AUDIT_LOG_FAILED:               { key: 'AUDIT_LOG_FAILED',               code: 'PX-8101', message: 'Failed to write audit log entry',                                          severity: 'warning'  },
  UNKNOWN_ERROR:                  { key: 'UNKNOWN_ERROR',                  code: 'PX-9001', message: 'An unexpected error occurred',                                              severity: 'error'    },
  NETWORK_ERROR:                  { key: 'NETWORK_ERROR',                  code: 'PX-9002', message: 'Network error - please check your connection',                              severity: 'error'    },
} as const;
