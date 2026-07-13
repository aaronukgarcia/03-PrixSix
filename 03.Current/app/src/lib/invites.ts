// GUID: LIB_INVITES-000-v01
// [Intent] Single source of truth for the friend-invite system: token generation, invite
//          validation, and single-use consumption. Invites live in the server-only
//          `invites` collection (doc ID = 256-bit hex token). A valid pending invite is
//          the ONLY bypass for the fail-closed signup gate (SEC-SIGNUP-001) while
//          admin_configuration/global.newUserSignupEnabled is false.
// [Inbound Trigger] Imported by /api/invites/create (creation), /api/auth/signup and
//                   /api/auth/complete-oauth-profile (validation + consumption), and the
//                   /signup server component (validation for rendering).
// [Downstream Impact] Reads/writes the `invites` collection via Admin SDK only — Firestore
//                     rules deny all client access. Consumption uses a transaction so a
//                     token can never provision two accounts.

import type { Firestore } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';

// GUID: LIB_INVITES-001-v01
// [Intent] Invite lifetime and token shape constants. TTL is enforced at validation time
//          against the stored expiresAt (no scheduled cleanup needed — expired docs are
//          simply invalid and remain for audit).
// [Inbound Trigger] Referenced by creation and validation logic below.
// [Downstream Impact] Changing INVITE_TTL_DAYS affects only invites created after the
//                     change (expiresAt is stamped at creation). TOKEN_REGEX guards
//                     Firestore doc-ID lookups from malformed user input.
export const INVITE_TTL_DAYS = 14;
export const INVITE_TOKEN_REGEX = /^[a-f0-9]{64}$/;

export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface InviteDoc {
  email: string;
  invitedByUid: string;
  invitedByTeamName: string;
  status: InviteStatus;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  acceptedAt?: FirebaseFirestore.Timestamp;
  acceptedUid?: string;
  acceptedEmail?: string;
}

export type InviteValidation =
  | { valid: true; token: string; invite: InviteDoc }
  | { valid: false; reason: 'malformed' | 'not_found' | 'expired' | 'used' };

// GUID: LIB_INVITES-002-v01
// [Intent] Generate a cryptographically random 256-bit invite token (64 lowercase hex
//          chars) used as the invites doc ID and the ?invite= URL parameter.
// [Inbound Trigger] Called by /api/invites/create.
// [Downstream Impact] Token entropy is the entire security of the invite link — anyone
//                     holding it can register one account. 256 bits makes guessing
//                     infeasible; tokens are single-use once accepted.
export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

// GUID: LIB_INVITES-003-v01
// [Intent] Read-only validation of an invite token: exists, still pending, not expired.
//          Performs NO writes — safe to call from the /signup page renderer.
// [Inbound Trigger] Called by the /signup server component and by both signup API gates
//                   before attempting consumption.
// [Downstream Impact] Returning valid:true lets the caller render the signup form or
//                     proceed to consumeInvite(). Malformed tokens never touch Firestore.
export async function validateInvite(db: Firestore, token: unknown): Promise<InviteValidation> {
  if (typeof token !== 'string' || !INVITE_TOKEN_REGEX.test(token)) {
    return { valid: false, reason: 'malformed' };
  }
  const snap = await db.collection('invites').doc(token).get();
  if (!snap.exists) {
    return { valid: false, reason: 'not_found' };
  }
  const invite = snap.data() as InviteDoc;
  if (invite.status !== 'pending') {
    return { valid: false, reason: 'used' };
  }
  if (invite.expiresAt.toMillis() < Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, token, invite };
}

// GUID: LIB_INVITES-004-v01
// [Intent] Atomically consume a pending invite (pending → accepted) inside a Firestore
//          transaction, mirroring the team_names sentinel pattern (GEMINI-AUDIT-112).
//          Two concurrent signups with the same token: exactly one wins.
// [Inbound Trigger] Called by /api/auth/signup and /api/auth/complete-oauth-profile AFTER
//                   input validation passes but BEFORE account creation.
// [Downstream Impact] On success the token is burned. Callers MUST call revertInvite() if
//                     downstream account creation fails, so a transient failure does not
//                     strand the invitee with a dead link.
export async function consumeInvite(
  db: Firestore,
  token: string,
  accepted: { uid?: string; email: string }
): Promise<boolean> {
  const ref = db.collection('invites').doc(token);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('not_found');
      const invite = snap.data() as InviteDoc;
      if (invite.status !== 'pending') throw new Error('used');
      if (invite.expiresAt.toMillis() < Date.now()) throw new Error('expired');
      tx.update(ref, {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedUid: accepted.uid ?? null,
        acceptedEmail: accepted.email,
      });
    });
    return true;
  } catch {
    return false;
  }
}

// GUID: LIB_INVITES-005-v01
// [Intent] Roll an accepted invite back to pending when account creation fails after the
//          token was consumed (e.g. duplicate team name, Auth outage). Best-effort: a
//          failure here is logged by the caller but never blocks the error response.
// [Inbound Trigger] Called from the signup routes' failure paths after consumeInvite().
// [Downstream Impact] Restores the invitee's ability to retry with the same link.
export async function revertInvite(db: Firestore, token: string): Promise<void> {
  await db.collection('invites').doc(token).update({
    status: 'pending',
    acceptedAt: null,
    acceptedUid: null,
    acceptedEmail: null,
  });
}
