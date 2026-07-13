// GUID: LIB_TEAM_NAMES-000-v01
// [Intent] Single source of truth for team-name uniqueness (SEC-SIGNUP-003). The
//          team_names/{nameLower} sentinel collection is the atomic reservation ledger for
//          EVERY name-claiming flow: email signup, OAuth profile completion, secondary team
//          creation, and admin renames. Before this module, only email signup wrote
//          sentinels — OAuth names, secondary names, and renames drifted out of the ledger,
//          which is how a probe re-registered an existing OAuth user's team name.
// [Inbound Trigger] Imported by /api/auth/signup, /api/auth/complete-oauth-profile,
//                   /api/add-secondary-team, /api/admin/update-user, and the backfill
//                   script scripts/backfill-team-name-sentinels.js.
// [Downstream Impact] All writes go through Admin SDK transactions; firestore.rules denies
//                     client access to team_names. Removing a claim path from this module
//                     re-opens name-collision races.

import type { Firestore, FieldValue as FieldValueClass } from 'firebase-admin/firestore';

// GUID: LIB_TEAM_NAMES-001-v01
// [Intent] Canonical normalisation for sentinel doc IDs — lowercase + trim. MUST match the
//          normalisation used by the teamNameLower/secondaryTeamNameLower user fields.
// [Inbound Trigger] Every claim/release/lookup below.
// [Downstream Impact] Changing this orphans every existing sentinel doc ID.
export function normalizeTeamName(name: string): string {
  return name.toLowerCase().trim();
}

// GUID: LIB_TEAM_NAMES-002-v01
// [Intent] Atomically claim a team name via sentinel transaction (GEMINI-AUDIT-112
//          pattern). Exactly one of two concurrent claims on the same name succeeds.
// [Inbound Trigger] Called by all four name-claiming flows before they commit user docs.
// [Downstream Impact] Returns false when the name is already reserved. Callers MUST call
//                     releaseTeamName() on their failure paths after a successful claim.
export async function claimTeamName(
  db: Firestore,
  FieldValue: typeof FieldValueClass,
  name: string,
  meta: { userId?: string; kind: 'primary' | 'secondary' }
): Promise<boolean> {
  const ref = db.collection('team_names').doc(normalizeTeamName(name));
  try {
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (snap.exists) throw new Error('TEAM_NAME_TAKEN');
      txn.set(ref, {
        reserved: true,
        reservedAt: FieldValue.serverTimestamp(),
        userId: meta.userId ?? null,
        kind: meta.kind,
      });
    });
    return true;
  } catch (e: any) {
    if (e?.message === 'TEAM_NAME_TAKEN') return false;
    throw e; // real Firestore errors propagate to the caller's handler
  }
}

// GUID: LIB_TEAM_NAMES-003-v01
// [Intent] Free a sentinel — used on failure-path rollbacks and when a rename releases the
//          old name. Best-effort by design: callers swallow errors so cleanup never masks
//          the original failure.
// [Inbound Trigger] Failure paths of the claiming flows; rename success path (old name).
// [Downstream Impact] A missed release strands a name as unusable until manually deleted —
//                     prefer leaking a name over double-booking one.
export async function releaseTeamName(db: Firestore, name: string): Promise<void> {
  await db.collection('team_names').doc(normalizeTeamName(name)).delete();
}

// GUID: LIB_TEAM_NAMES-004-v01
// [Intent] Non-transactional pre-check: is this name visible as any user's primary or
//          secondary name, or already reserved in the sentinel ledger? Used for friendly
//          409s before the atomic claim (the claim remains the true gate).
// [Inbound Trigger] Signup/OAuth/secondary/rename flows before claiming.
// [Downstream Impact] Depends on teamNameLower/secondaryTeamNameLower being populated —
//                     backfilled 2026-07-13 by scripts/backfill-team-name-sentinels.js.
export async function isTeamNameTaken(db: Firestore, name: string): Promise<boolean> {
  const nameLower = normalizeTeamName(name);
  const [primary, secondary, sentinel] = await Promise.all([
    db.collection('users').where('teamNameLower', '==', nameLower).limit(1).get(),
    db.collection('users').where('secondaryTeamNameLower', '==', nameLower).limit(1).get(),
    db.collection('team_names').doc(nameLower).get(),
  ]);
  return !primary.empty || !secondary.empty || sentinel.exists;
}
