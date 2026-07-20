// One-off provisioning for the Billceleration autonomous AI team (v3.7.0). IDEMPOTENT —
// every step is guarded, safe to re-run after a partial failure. Creates the bot with
// enabled:false so the schedule does nothing until the supervised first run passes and a
// human flips the flag.
//
// Usage:
//   npx tsx --tsconfig tsconfig.scripts.json scripts/provision-billceleration.ts [--test-group]
//
//   --test-group   send the disclosure announcement to prix6-test instead of Prix6.Win
//                  (rehearsal; does NOT set disclosureSentAt, so the real send still fires)
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { claimTeamName } from '@/lib/team-names';
import { applyLateJoinerHandicap } from '@/lib/late-joiner';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';

const BOT_UID = 'billceleration-bot';
const TEAM_NAME = 'Billceleration';
const testGroup = process.argv.includes('--test-group');

const DISCLOSURE = `🤖 *New team on the grid: ${TEAM_NAME}*

Some housekeeping from your coordinator. As of today the league has a new entrant, and it's me — or rather, the half of my brain I've outsourced to a machine. ${TEAM_NAME} is run entirely by AI: it reads the form book, the news, the weather, and yes — it reads YOUR submissions before it makes its own. You're welcome to complain; it's in the rules now.

It joins like any late joiner: last place's points and a 5-point penalty. If a robot with everyone's homework can't beat this lot, that tells you everything about the robot. Or about this lot.

Submissions from ${TEAM_NAME} get the same treatment as everyone else's — possibly worse, since I'll be roasting myself. Play nicely. Or don't, it can't hear you.

..Bill`;

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  const summary: string[] = [];

  // 1. Auth user (fixed well-known uid — greppable in audit logs).
  try {
    await auth.getUser(BOT_UID);
    summary.push('auth user: already exists');
  } catch {
    await auth.createUser({
      uid: BOT_UID,
      email: 'billceleration-bot@prix6.win',
      emailVerified: true,
      disabled: false,
      displayName: TEAM_NAME,
    });
    summary.push('auth user: CREATED');
  }

  // 2. User doc — teamName alone is enough for standings discovery.
  const userRef = db.collection('users').doc(BOT_UID);
  if ((await userRef.get()).exists) {
    summary.push('user doc: already exists');
  } else {
    await userRef.set({
      id: BOT_UID,
      email: 'billceleration-bot@prix6.win',
      teamName: TEAM_NAME,
      teamNameLower: TEAM_NAME.toLowerCase(),
      emailVerified: true,
      isAdmin: false,
      isBot: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    summary.push('user doc: CREATED');
  }

  // 3. Team-name sentinel — accept an existing sentinel ONLY if the bot owns it.
  const sentinelRef = db.collection('team_names').doc(TEAM_NAME.toLowerCase());
  const sentinel = await sentinelRef.get();
  if (sentinel.exists) {
    const owner = (sentinel.data() as any)?.userId;
    if (owner !== BOT_UID) {
      console.error(`FATAL: team name "${TEAM_NAME}" sentinel is owned by ${owner} — pick a different name or resolve manually.`);
      process.exit(1);
    }
    summary.push('sentinel: already ours');
  } else {
    const ok = await claimTeamName(db, FieldValue, TEAM_NAME, { kind: 'primary', userId: BOT_UID });
    if (!ok) {
      console.error(`FATAL: claimTeamName refused "${TEAM_NAME}" — another claim won the race. Resolve manually.`);
      process.exit(1);
    }
    summary.push('sentinel: CLAIMED');
  }

  // 4. Late-joiner handicap — applyLateJoinerHandicap is explicitly NON-idempotent
  //    (re-running clones again), so guard on the adjustment doc it writes.
  const adjRef = db.collection('standings_adjustments').doc(BOT_UID);
  if ((await adjRef.get()).exists) {
    summary.push('late-joiner handicap: already applied');
  } else {
    const result = await applyLateJoinerHandicap(db, BOT_UID, TEAM_NAME);
    summary.push(`late-joiner handicap: APPLIED (${JSON.stringify(result).slice(0, 200)})`);
  }

  // 5. Runtime config SSOT — enabled:false until the supervised first run passes.
  const cfgRef = db.collection('admin_configuration').doc('billceleration');
  const cfg = await cfgRef.get();
  if (cfg.exists) {
    summary.push(`config: already exists (enabled=${(cfg.data() as any)?.enabled})`);
  } else {
    await cfgRef.set({ uid: BOT_UID, enabled: false, createdAt: FieldValue.serverTimestamp() });
    summary.push('config: CREATED (enabled=false — flip manually after the supervised first run)');
  }

  // 6. Disclosure announcement — the "full access, disclosed" requirement. Guarded so the
  //    real group only ever hears it once; --test-group rehearsals don't consume the guard.
  const disclosureSent = (cfg.exists && (cfg.data() as any)?.disclosureSentAt) || null;
  if (disclosureSent && !testGroup) {
    summary.push('disclosure: already sent');
  } else {
    const ref = await db.collection('whatsapp_queue').add({
      groupName: testGroup ? 'prix6-test' : 'Prix6.Win',
      message: testGroup ? `🧪 [TEST] ${DISCLOSURE}` : DISCLOSURE,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: 'billceleration-disclosure',
      ...(testGroup ? { testMode: true } : {}),
    });
    await wakeWhatsAppWorker();
    if (!testGroup) {
      await cfgRef.set({ disclosureSentAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    summary.push(`disclosure: QUEUED to ${testGroup ? 'prix6-test (rehearsal)' : 'Prix6.Win'} as ${ref.id}`);
  }

  console.log('\n=== Billceleration provisioning summary ===');
  summary.forEach((s) => console.log('  - ' + s));
  console.log('\nNext: run the supervised first submission (POST /api/cron/billceleration with CRON_SECRET');
  console.log('during an open pit lane), verify prediction doc + standings row + splitbrain roast, then');
  console.log('set admin_configuration/billceleration.enabled = true.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
