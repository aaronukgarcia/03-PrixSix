/**
 * Attack Detection System
 * Detects bot attacks, credential stuffing, and distributed login attacks.
 */

import type { Firestore, FieldValue as FieldValueType } from 'firebase-admin/firestore';

// Detection thresholds
export const ATTACK_THRESHOLDS = {
  // Bot Attack: 10+ failed attempts from same IP in 5 minutes
  BOT_ATTACK: {
    attempts: 10,
    windowMinutes: 5,
  },
  // Credential Stuffing: Same IP tries 5+ different accounts in 5 minutes
  CREDENTIAL_STUFFING: {
    uniqueAccounts: 5,
    windowMinutes: 5,
  },
  // Distributed Attack: 5+ IPs target same account with 8+ failures in 10 minutes
  DISTRIBUTED_ATTACK: {
    uniqueIPs: 5,
    failedAttempts: 8,
    windowMinutes: 10,
  },
} as const;

export type AttackType = 'bot_attack' | 'credential_stuffing' | 'distributed_attack';
export type AttackSeverity = 'warning' | 'critical';

export interface LoginAttempt {
  timestamp: FirebaseFirestore.Timestamp;
  ip: string;
  email: string;
  userId?: string;
  success: boolean;
  reason?: 'invalid_pin' | 'user_not_found' | 'locked_out';
  userAgent?: string;
}

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

/**
 * Log a login attempt to Firestore
 */
export async function logLoginAttempt(
  db: Firestore,
  FieldValue: typeof FieldValueType,
  attempt: Omit<LoginAttempt, 'timestamp'>
): Promise<void> {
  await db.collection('login_attempts').add({
    ...attempt,
    timestamp: FieldValue.serverTimestamp(),
  });
}

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
  const distributedAttack = await checkDistributedAttack(db, currentEmail, now);
  if (distributedAttack) {
    const existingAlert = await db.collection('attack_alerts')
      .where('type', '==', 'distributed_attack')
      .where('details.targetEmail', '==', currentEmail)
      .where('acknowledged', '==', false)
      .limit(1)
      .get();

    if (existingAlert.empty) {
      await createAttackAlert(db, FieldValue, distributedAttack);
      return distributedAttack;
    }
  }

  return null;
}

/**
 * Check for bot attack: 10+ failed attempts from same IP in 5 minutes
 */
async function checkBotAttack(
  db: Firestore,
  ip: string,
  now: Date
): Promise<AttackAlert | null> {
  const { attempts, windowMinutes } = ATTACK_THRESHOLDS.BOT_ATTACK;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

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

  return null;
}

/**
 * Check for credential stuffing: Same IP tries 5+ different accounts in 5 minutes
 */
async function checkCredentialStuffing(
  db: Firestore,
  ip: string,
  now: Date
): Promise<AttackAlert | null> {
  const { uniqueAccounts, windowMinutes } = ATTACK_THRESHOLDS.CREDENTIAL_STUFFING;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

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

  return null;
}

/**
 * Check for distributed attack: 5+ IPs target same account with 8+ failures in 10 minutes
 */
async function checkDistributedAttack(
  db: Firestore,
  email: string,
  now: Date
): Promise<AttackAlert | null> {
  const { uniqueIPs, failedAttempts, windowMinutes } = ATTACK_THRESHOLDS.DISTRIBUTED_ATTACK;
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

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

  return null;
}

/**
 * Create an attack alert in Firestore
 */
async function createAttackAlert(
  db: Firestore,
  FieldValue: typeof FieldValueType,
  alert: AttackAlert
): Promise<void> {
  await db.collection('attack_alerts').add({
    ...alert,
    timestamp: FieldValue.serverTimestamp(),
  });

  // Log for monitoring
  console.warn(`[ATTACK DETECTED] Type: ${alert.type}, Severity: ${alert.severity}`, alert.details);
}
