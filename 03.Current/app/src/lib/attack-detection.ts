// GUID: LIB_ATTACK_DETECTION-000-v04
// [Intent] Attack detection system that identifies bot attacks, credential stuffing, and distributed login attacks against the authentication layer.
// [Inbound Trigger] Imported by login API routes after failed login attempts.
// [Downstream Impact] Creates attack_alerts documents in Firestore; admin dashboard reads these alerts. Changes to thresholds or detection logic affect security posture.
// @AUDIT_NOTE: Account lockout (auto-locking accounts after repeated failures) not implemented -- requires server-side session management.
// @TECH_DEBT: VPN/proxy detection not implemented -- would require IP reputation service integration.

/**
 * Attack Detection System
 * Detects bot attacks, credential stuffing, and distributed login attacks.
 */

import type { Firestore, FieldValue as FieldValueType } from 'firebase-admin/firestore';

// GUID: LIB_ATTACK_DETECTION-001-v04
// @SECURITY_RISK: Thresholds tightened from v03 -- previous values (BOT:10, STUFFING:5accts, DISTRIBUTED:5IPs/8fails)
//   were too permissive for a small-user-base app. With ~20 users, even 3 unique accounts from one IP is suspicious.
// [Intent] Defines numeric thresholds for each attack type (bot, credential stuffing, distributed) including attempt counts and time windows.
// [Inbound Trigger] Referenced by checkBotAttack, checkCredentialStuffing, and checkDistributedAttack functions.
// [Downstream Impact] Changing these values directly affects sensitivity of attack detection. Lowering thresholds increases false positives; raising them risks missed attacks.
// Detection thresholds
export const ATTACK_THRESHOLDS = {
  // Bot Attack: 5+ failed attempts from same IP in 5 minutes
  BOT_ATTACK: {
    attempts: 5,
    windowMinutes: 5,
  },
  // Credential Stuffing: Same IP tries 3+ different accounts in 5 minutes
  CREDENTIAL_STUFFING: {
    uniqueAccounts: 3,
    windowMinutes: 5,
  },
  // Distributed Attack: 3+ IPs target same account with 5+ failures in 10 minutes
  DISTRIBUTED_ATTACK: {
    uniqueIPs: 3,
    failedAttempts: 5,
    windowMinutes: 10,
  },
} as const;

// GUID: LIB_ATTACK_DETECTION-002-v04
// [Intent] Defines TypeScript types for attack classifications and severity levels used across the detection system and admin UI.
// [Inbound Trigger] Used by all detection functions and the AttackAlert interface.
// [Downstream Impact] Adding or removing attack types requires corresponding changes in checkForAttack orchestrator and any admin UI that renders alerts.
export type AttackType = 'bot_attack' | 'credential_stuffing' | 'distributed_attack';
export type AttackSeverity = 'warning' | 'critical';

// GUID: LIB_ATTACK_DETECTION-003-v04
// [Intent] Defines the shape of a login attempt record stored in the login_attempts Firestore collection.
// [Inbound Trigger] Used by logLoginAttempt and queried by all check* detection functions.
// [Downstream Impact] Schema changes require migration of existing login_attempts documents and updates to all detection query logic.
export interface LoginAttempt {
  timestamp: FirebaseFirestore.Timestamp;
  ip: string;
  email: string;
  userId?: string;
  success: boolean;
  reason?: 'invalid_pin' | 'user_not_found' | 'locked_out';
  userAgent?: string;
}

// GUID: LIB_ATTACK_DETECTION-004-v04
// [Intent] Defines the shape of an attack alert record stored in the attack_alerts Firestore collection.
// [Inbound Trigger] Created by createAttackAlert; read by admin dashboard for security monitoring.
// [Downstream Impact] Schema changes affect admin UI rendering of alerts and any downstream notification systems.
export interface AttackAlert {
  timestamp: FirebaseFirestore.Timestamp;
  type: AttackType;
  severity: AttackSeverity;
  details: {
    ip?: string;
    targetEmail?: string;
    failedAttempts: number;
    uniqueIPs?: number;
    uniqueAccounts?: number;
    timeWindowMinutes: number;
  };
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: FirebaseFirestore.Timestamp;
}

// GUID: LIB_ATTACK_DETECTION-005-v04
// @SECURITY_RISK: Previously had no error handling -- a Firestore write failure would crash the login flow.
// [Intent] Persists a login attempt (successful or failed) to the login_attempts Firestore collection for later analysis.
// [Inbound Trigger] Called by the login API route on every authentication attempt.
// [Downstream Impact] Feeds data to all three detection functions (checkBotAttack, checkCredentialStuffing, checkDistributedAttack). If this fails to write, attack detection becomes blind.
/**
 * Log a login attempt to Firestore
 */
export async function logLoginAttempt(
  db: Firestore,
  FieldValue: typeof FieldValueType,
  attempt: Omit<LoginAttempt, 'timestamp'>
): Promise<void> {
  // GUID: LIB_ATTACK_DETECTION-011-v03
  // [Intent] Normalize email to lowercase before storing login attempt to ensure consistent
  //   querying in detection functions. Without this, "User@Example.com" and "user@example.com"
  //   would be treated as different accounts in credential stuffing detection.
  // [Inbound Trigger] Called as part of logLoginAttempt processing.
  // [Downstream Impact] Ensures checkCredentialStuffing and checkDistributedAttack queries match correctly.
  const normalizedAttempt = {
    ...attempt,
    email: attempt.email?.toLowerCase() ?? attempt.email,
  };

  try {
    await db.collection('login_attempts').add({
      ...normalizedAttempt,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    // Log but don't throw -- login should still succeed even if attempt logging fails
    console.error(`[Attack Detection] Failed to log login attempt [PX-8003]:`, error);
  }
}

// GUID: LIB_ATTACK_DETECTION-006-v04
// @ERROR_PRONE: Previously did not normalize email to lowercase before passing to detection checks,
//   causing potential misses when stored emails used different casing.
// [Intent] Orchestrates all three attack detection checks (bot, credential stuffing, distributed) and creates alerts for newly detected attacks, deduplicating against existing unacknowledged alerts.
// [Inbound Trigger] Called by the login API route after a failed login attempt, receiving the current IP and email.
// [Downstream Impact] Returns an AttackAlert to the caller if a new attack is detected; also writes to attack_alerts collection. Admin dashboard and any notification system depend on these alerts being created.
/**
 * Check for attacks based on recent login attempts
 * Should be called after a failed login attempt
 */
export async function checkForAttack(
  db: Firestore,
  FieldValue: typeof FieldValueType,
  currentIP: string,
  currentEmail: string
): Promise<AttackAlert | null> {
  const now = new Date();
  // Normalize email to lowercase for consistent matching across all checks
  const normalizedEmail = currentEmail.toLowerCase();

  try {
    // Check for bot attack (same IP, many failures)
    const botAttack = await checkBotAttack(db, currentIP, now);
    if (botAttack) {
      // Check if we already have an unacknowledged alert for this IP
      const existingAlert = await db.collection('attack_alerts')
        .where('type', '==', 'bot_attack')
        .where('details.ip', '==', currentIP)
        .where('acknowledged', '==', false)
        .limit(1)
        .get();

      if (existingAlert.empty) {
        await createAttackAlert(db, FieldValue, botAttack);
        return botAttack;
      }
    }

    // Check for credential stuffing (same IP, many different accounts)
    const credentialStuffing = await checkCredentialStuffing(db, currentIP, now);
    if (credentialStuffing) {
      const existingAlert = await db.collection('attack_alerts')
        .where('type', '==', 'credential_stuffing')
        .where('details.ip', '==', currentIP)
        .where('acknowledged', '==', false)
        .limit(1)
        .get();

      if (existingAlert.empty) {
        await createAttackAlert(db, FieldValue, credentialStuffing);
        return credentialStuffing;
      }
    }

    // Check for distributed attack (many IPs, same account)
    const distributedAttack = await checkDistributedAttack(db, normalizedEmail, now);
    if (distributedAttack) {
      const existingAlert = await db.collection('attack_alerts')
        .where('type', '==', 'distributed_attack')
        .where('details.targetEmail', '==', normalizedEmail)
        .where('acknowledged', '==', false)
        .limit(1)
        .get();

      if (existingAlert.empty) {
        await createAttackAlert(db, FieldValue, distributedAttack);
        return distributedAttack;
      }
    }
  } catch (error: any) {
    // Log but don't throw -- attack detection failure should not block login flow
    console.error(`[Attack Detection] Check failed [PX-8004]:`, error);
  }

  return null;
}

// GUID: LIB_ATTACK_DETECTION-007-v04
// [Intent] Detects bot attacks by counting failed login attempts from a single IP within the configured time window (5+ in 5 minutes).
// [Inbound Trigger] Called by checkForAttack when evaluating the current IP address after a failed login.
// [Downstream Impact] Returns an AttackAlert object (severity: critical) if threshold is met, which checkForAttack then persists. Depends on login_attempts collection having accurate IP and timestamp data.
/**
 * Check for bot attack: 5+ failed attempts from same IP in 5 minutes
 */
async function checkBotAttack(
  db: Firestore,
  ip: string,
  now: Date
): Promise<AttackAlert | null> {
  const { attempts, windowMinutes } = ATTACK_THRESHOLDS.BOT_ATTACK;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  try {
    const recentAttempts = await db.collection('login_attempts')
      .where('ip', '==', ip)
      .where('success', '==', false)
      .where('timestamp', '>=', windowStart)
      .get();

    if (recentAttempts.size >= attempts) {
      return {
        timestamp: null as any, // Will be set by serverTimestamp
        type: 'bot_attack',
        severity: 'critical',
        details: {
          ip,
          failedAttempts: recentAttempts.size,
          timeWindowMinutes: windowMinutes,
        },
        acknowledged: false,
      };
    }
  } catch (error: any) {
    console.error(`[Attack Detection] Bot attack check query failed:`, error);
  }

  return null;
}

// GUID: LIB_ATTACK_DETECTION-008-v04
// [Intent] Detects credential stuffing by counting unique email addresses targeted from a single IP within the configured time window (3+ accounts in 5 minutes).
// [Inbound Trigger] Called by checkForAttack when evaluating the current IP address after a failed login.
// [Downstream Impact] Returns an AttackAlert object (severity: critical) if threshold is met. Depends on login_attempts having accurate email and IP data. Email comparison is case-insensitive.
/**
 * Check for credential stuffing: Same IP tries 3+ different accounts in 5 minutes
 */
async function checkCredentialStuffing(
  db: Firestore,
  ip: string,
  now: Date
): Promise<AttackAlert | null> {
  const { uniqueAccounts, windowMinutes } = ATTACK_THRESHOLDS.CREDENTIAL_STUFFING;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  try {
    const recentAttempts = await db.collection('login_attempts')
      .where('ip', '==', ip)
      .where('success', '==', false)
      .where('timestamp', '>=', windowStart)
      .get();

    // Count unique emails
    const uniqueEmails = new Set<string>();
    recentAttempts.forEach(doc => {
      const data = doc.data();
      if (data.email) {
        uniqueEmails.add(data.email.toLowerCase());
      }
    });

    if (uniqueEmails.size >= uniqueAccounts) {
      return {
        timestamp: null as any, // Will be set by serverTimestamp
        type: 'credential_stuffing',
        severity: 'critical',
        details: {
          ip,
          failedAttempts: recentAttempts.size,
          uniqueAccounts: uniqueEmails.size,
          timeWindowMinutes: windowMinutes,
        },
        acknowledged: false,
      };
    }
  } catch (error: any) {
    console.error(`[Attack Detection] Credential stuffing check query failed:`, error);
  }

  return null;
}

// GUID: LIB_ATTACK_DETECTION-009-v04
// [Intent] Detects distributed attacks by counting unique IPs targeting a single email with sufficient failures within the configured time window (3+ IPs and 5+ failures in 10 minutes).
// [Inbound Trigger] Called by checkForAttack when evaluating the current email address after a failed login.
// [Downstream Impact] Returns an AttackAlert object (severity: warning) if threshold is met. Depends on login_attempts having accurate IP and email data. Email comparison is case-insensitive.
/**
 * Check for distributed attack: 3+ IPs target same account with 5+ failures in 10 minutes
 */
async function checkDistributedAttack(
  db: Firestore,
  email: string,
  now: Date
): Promise<AttackAlert | null> {
  const { uniqueIPs, failedAttempts, windowMinutes } = ATTACK_THRESHOLDS.DISTRIBUTED_ATTACK;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  try {
    const recentAttempts = await db.collection('login_attempts')
      .where('email', '==', email.toLowerCase())
      .where('success', '==', false)
      .where('timestamp', '>=', windowStart)
      .get();

    // Count unique IPs
    const uniqueIPSet = new Set<string>();
    recentAttempts.forEach(doc => {
      const data = doc.data();
      if (data.ip) {
        uniqueIPSet.add(data.ip);
      }
    });

    if (uniqueIPSet.size >= uniqueIPs && recentAttempts.size >= failedAttempts) {
      return {
        timestamp: null as any, // Will be set by serverTimestamp
        type: 'distributed_attack',
        severity: 'warning',
        details: {
          targetEmail: email.toLowerCase(),
          failedAttempts: recentAttempts.size,
          uniqueIPs: uniqueIPSet.size,
          timeWindowMinutes: windowMinutes,
        },
        acknowledged: false,
      };
    }
  } catch (error: any) {
    console.error(`[Attack Detection] Distributed attack check query failed:`, error);
  }

  return null;
}

// GUID: LIB_ATTACK_DETECTION-010-v04
// [Intent] Persists a detected attack alert to the attack_alerts Firestore collection and logs a console warning for server-side monitoring.
// [Inbound Trigger] Called by checkForAttack after confirming no duplicate unacknowledged alert exists for the detected attack.
// [Downstream Impact] Creates documents in attack_alerts collection read by admin dashboard. Console warning is picked up by server log aggregation. If this fails, attacks are detected but not recorded.
/**
 * Create an attack alert in Firestore
 */
async function createAttackAlert(
  db: Firestore,
  FieldValue: typeof FieldValueType,
  alert: AttackAlert
): Promise<void> {
  try {
    await db.collection('attack_alerts').add({
      ...alert,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    console.error(`[Attack Detection] Failed to create attack alert [PX-8002]:`, error);
    // Don't throw -- the alert object is still returned to the caller for immediate action
  }

  // Log for monitoring (always log, even if Firestore write failed)
  console.warn(`[ATTACK DETECTED] Type: ${alert.type}, Severity: ${alert.severity}`, alert.details);
}
