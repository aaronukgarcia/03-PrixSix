// GUID: SCRIPT_BACKFILL_TEAM_SENTINELS-000-v01
// [Intent] SEC-SIGNUP-003 one-shot migration: make the team_names sentinel ledger complete.
//          Before 2026-07-13 only email signups wrote sentinels — OAuth joiners, secondary
//          teams, and admin renames were missing, and secondaryTeamNameLower was never
//          written by anything (so the signup routes' secondary-uniqueness queries silently
//          matched nothing). For every users doc this script:
//            1. ensures team_names/{teamNameLower} exists (kind primary, userId)
//            2. ensures team_names/{secondaryTeamNameLower} exists (kind secondary) if set
//            3. repairs stale/missing teamNameLower + secondaryTeamNameLower fields
//          Never overwrites a sentinel owned by a DIFFERENT user — collisions are reported
//          for manual review instead.
// [Inbound Trigger] Run manually: node scripts/backfill-team-name-sentinels.js (from 03.Current).
// [Downstream Impact] Creates team_names docs + repairs users derived fields. Idempotent —
//                     safe to re-run; second run should report 0 changes.

const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '..', 'service-account.json'))),
});
const db = admin.firestore();

const normalize = (name) => name.toLowerCase().trim();

(async () => {
  const users = await db.collection('users').get();
  console.log(`Scanning ${users.size} user docs...`);
  let sentinelsCreated = 0;
  let sentinelsOk = 0;
  let fieldsRepaired = 0;
  const collisions = [];

  for (const doc of users.docs) {
    const u = doc.data();
    const jobs = [];
    if (u.teamName) jobs.push({ name: u.teamName, kind: 'primary', lowerField: 'teamNameLower' });
    if (u.secondaryTeamName) jobs.push({ name: u.secondaryTeamName, kind: 'secondary', lowerField: 'secondaryTeamNameLower' });

    const repairs = {};
    for (const job of jobs) {
      const lower = normalize(job.name);

      // 1/2. Sentinel
      const ref = db.collection('team_names').doc(lower);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          reserved: true,
          reservedAt: admin.firestore.FieldValue.serverTimestamp(),
          userId: doc.id,
          kind: job.kind,
          backfilled: true,
        });
        sentinelsCreated++;
        console.log(`  + sentinel "${lower}" (${job.kind}, ${u.email})`);
      } else {
        const owner = snap.data().userId;
        if (owner && owner !== doc.id) {
          collisions.push(`"${lower}": sentinel owned by ${owner}, but also ${job.kind} name of ${doc.id} (${u.email})`);
        } else {
          if (!owner) await ref.update({ userId: doc.id, kind: job.kind }).catch(() => {});
          sentinelsOk++;
        }
      }

      // 3. Derived lower field repair
      if (u[job.lowerField] !== lower) {
        repairs[job.lowerField] = lower;
      }
    }

    if (Object.keys(repairs).length > 0) {
      await doc.ref.update(repairs);
      fieldsRepaired++;
      console.log(`  ~ repaired ${Object.keys(repairs).join(', ')} for ${u.email}`);
    }
  }

  const finalCount = (await db.collection('team_names').get()).size;
  console.log('\n=== SUMMARY ===');
  console.log(`Sentinels created:   ${sentinelsCreated}`);
  console.log(`Sentinels already ok: ${sentinelsOk}`);
  console.log(`User docs repaired:  ${fieldsRepaired}`);
  console.log(`team_names total:    ${finalCount}`);
  if (collisions.length) {
    console.log('\n⚠️ COLLISIONS (manual review needed):');
    collisions.forEach((c) => console.log('  ' + c));
    process.exit(2);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
