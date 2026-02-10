/**
 * Zod Validation Schemas for Prix Six
 *
 * GUID: VALIDATION-001-v03
 * [Intent] Centralized Zod schemas for API request validation with strict
 *          security requirements. Ensures type safety and input sanitization.
 * [Inbound Trigger] Imported by API routes for request.body validation.
 * [Downstream Impact] Prevents injection attacks, malformed requests, and
 *                     provides clear error messages for client debugging.
 */

import { z } from 'zod';

// ── Admin Hot Link Validation ──────────────────────────────────

/**
 * GUID: VALIDATION-HOTLINK-001-v03
 *
 * [Intent] Validate Admin Hot Link token exchange requests. Ensures tokens
 *          are 64-character hex strings (crypto.randomBytes(32)) and emails
 *          are valid format. Prevents SQL injection, XSS, and token enumeration.
 * [Inbound Trigger] POST /api/admin/verify-access request body validation.
 * [Downstream Impact] Rejects malformed tokens before database lookup, preventing
 *                     enumeration attacks and reducing Firestore read costs.
 */
export const AdminHotLinkSchema = z.object({
  /**
   * The admin challenge token (crypto.randomBytes(32).toString('hex'))
   * Must be exactly 64 characters (32 bytes * 2 hex chars per byte)
   */
  token: z.string()
    .length(64, 'Token must be exactly 64 characters')
    .regex(/^[a-f0-9]{64}$/, 'Token must be a valid hex string'),

  /**
   * The admin user's email address (for ownership verification)
   * Must be a valid email format to prevent injection attacks
   */
  email: z.string()
    .email('Invalid email format')
    .max(255, 'Email too long')
    .trim()
    .toLowerCase(),
});

export type AdminHotLinkRequest = z.infer<typeof AdminHotLinkSchema>;

// ── Admin Challenge Request Validation ─────────────────────────

/**
 * GUID: VALIDATION-CHALLENGE-001-v03
 *
 * [Intent] Validate admin challenge (magic link) generation requests. Currently
 *          only validates the request comes from an authenticated admin user.
 *          No body parameters required as admin status is verified via Firebase Auth.
 * [Inbound Trigger] POST /api/auth/admin-challenge request validation.
 * [Downstream Impact] Ensures only authenticated users can request magic links.
 */
export const AdminChallengeRequestSchema = z.object({
  /**
   * Optional: IP address for rate limiting (extracted from headers server-side)
   * Not validated here as it's populated by the API route, not the client
   */
  _ipAddress: z.string().ip().optional(),
});

export type AdminChallengeRequest = z.infer<typeof AdminChallengeRequestSchema>;

// ── Email Validation ───────────────────────────────────────────

/**
 * GUID: VALIDATION-EMAIL-001-v03
 *
 * [Intent] Strict email validation to prevent injection attacks and ensure
 *          RFC 5322 compliance. Rejects emails with special characters that
 *          could be used in XSS or SQL injection attacks.
 * [Inbound Trigger] Used across multiple API routes (login, signup, email verification).
 * [Downstream Impact] Prevents EMAIL-002 (URL injection) and EMAIL-001 (XSS)
 *                     by sanitizing emails before use in templates and URLs.
 */
export const EmailSchema = z.string()
  .email('Invalid email format')
  .max(255, 'Email too long')
  .regex(
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/,
    'Email contains invalid characters'
  )
  .trim()
  .toLowerCase();

// ── Token Generation Helpers ───────────────────────────────────

/**
 * GUID: VALIDATION-TOKEN-001-v03
 *
 * [Intent] Generate cryptographically secure tokens using Node.js crypto module.
 *          Replaces Math.random() usage (LIB-002 vulnerability).
 * [Inbound Trigger] Called by admin challenge endpoint and other token generation.
 * [Downstream Impact] Fixes LIB-002 (weak randomness in correlation IDs) and
 *                     LIB-001 (weak randomness in invite codes) vulnerabilities.
 */
export function generateSecureToken(byteLength: number = 32): string {
  // Use Node.js crypto module for cryptographically secure randomness
  const crypto = require('crypto');
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * GUID: VALIDATION-TOKEN-002-v03
 *
 * [Intent] Generate cryptographically secure correlation IDs for audit trail.
 *          Uses crypto.randomUUID() (RFC 4122 v4) instead of Math.random().
 * [Inbound Trigger] Called at API route entry points for request tracing.
 * [Downstream Impact] Fixes LIB-002 (predictable correlation IDs). Ensures
 *                     audit trail integrity and prevents correlation ID prediction attacks.
 */
export function generateSecureCorrelationId(prefix: string = 'req'): string {
  const crypto = require('crypto');
  const uuid = crypto.randomUUID(); // RFC 4122 v4 UUID
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${uuid}`;
}

// ── Rate Limiting Schemas ──────────────────────────────────────

/**
 * GUID: VALIDATION-RATELIMIT-001-v03
 *
 * [Intent] Define rate limit thresholds for admin operations to prevent
 *          abuse and DoS attacks on the admin challenge endpoint.
 * [Inbound Trigger] Used by admin challenge endpoint rate limiter.
 * [Downstream Impact] Prevents email spam via magic link generation abuse.
 */
export const ADMIN_CHALLENGE_RATE_LIMITS = {
  /** Maximum admin challenge requests per user per hour */
  perUserPerHour: 3,
  /** Maximum admin challenge requests globally per hour */
  globalPerHour: 100,
  /** Cooldown period after successful challenge (minutes) */
  cooldownMinutes: 5,
} as const;
