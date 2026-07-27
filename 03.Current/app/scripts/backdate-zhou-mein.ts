// One-off league-admin adjustment (Aaron, 2026-07-20): backdate Zhou-Mein's first (and only)
// submission to their 2026-02-25 signup so the carry-forward engine scores them for the season
// they were registered for. Captures the before/after standings and writes an audit_logs entry
// with the ORIGINAL timestamp so the change is fully reversible.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap, readStandingsAdjustments } from '@/lib/cumulative-standings';

const UID = 'w7lVUtGeTxbrRG6EfCXST0u3vDX2';
const DOC_ID = `${UID}_Belgian-Grand-Prix-GP`;
const NEW_TS = new Date('2026-02-25T16:30:46.753Z'); // their account createdAt

async function snapshot(db: any, label: string) {
  const [{ scores }, adjustments, names] = await Promise.all([
    computeRaceScores(db),
    readStandingsAdjustments(db),
    buildTeamNamesMap(db),
  ]);
  const standings = aggregateStandings([...scores, ...adjustments], names);
  console.log(`\n=== ${label} ===`);
  const zhou = standings.find((s: any) => s.teamName === 'Zhou-Mein');
  const bot = standings.find((s: any) => s.teamName === 'Billceleration');
  console.log('Zhou-Mein:', zhou ? `P${zhou.rank} — ${zhou.totalPoints} pts` : 'MISSING');
  console.log('Billceleration:', bot ? `P${bot.rank} — ${bot.totalPoints} pts` : 'MISSING');
  return standings;
}

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();
  const ref = db.collection('users').doc(UID).collection('predictions').doc(DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error('Prediction doc missing — aborting.'); process.exit(1); }
  const original = snap.data()!.submittedAt;
  console.log('Original submittedAt:', original?.toDate?.()?.toISOString?.());

  const before = await snapshot(db, 'BEFORE');

  await ref.update({ submittedAt: Timestamp.fromDate(NEW_TS) });
  await db.collection('audit_logs').add({
    action: 'ADMIN_BACKDATE_SUBMISSION',
    userId: UID,
    teamName: 'Zhou-Mein',
    predictionDocId: DOC_ID,
    originalSubmittedAt: original?.toDate?.()?.toISOString?.() || null,
    newSubmittedAt: NEW_TS.toISOString(),
    reason: 'League-admin decision (Aaron, 2026-07-20): player registered 2026-02-25 but first submitted 2026-07-18; backdated so carry-forward scores the full season. Reversible via originalSubmittedAt.',
    at: FieldValue.serverTimestamp(),
  });
  console.log('\nBackdated to', NEW_TS.toISOString(), '+ audit_logs entry written.');

  // computeRaceScores has no module cache — fresh read reflects the change immediately.
  const after = await snapshot(db, 'AFTER');

  console.log('\n=== FULL AFTER TABLE (rank. team — pts, Δ rank vs before) ===');
  const beforeRank = new Map(before.map((s: any) => [s.teamName, s.rank]));
  after.forEach((s: any) => {
    const was = beforeRank.get(s.teamName);
    const delta = was !== undefined ? was - s.rank : 0;
    const marker = s.teamName === 'Zhou-Mein' || s.teamName === 'Billceleration' ? '  ◄' : '';
    console.log(`${String(s.rank).padStart(2)}. ${s.teamName} — ${s.totalPoints}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}${marker}`);
  });
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
