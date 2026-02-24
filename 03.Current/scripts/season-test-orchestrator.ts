// GUID: SCRIPT_SEASON_TEST-000-v01
// [Type] Utility Script — development/testing only, NOT part of production build
// [Category] Testing
// [Intent] Full end-to-end season test orchestrator. Creates 10 test accounts via the production
//          API, submits predictions for every race/sprint in the schedule, has the admin enter
//          results, verifies scoring, then optionally purges all test data.
//          All traffic goes through the live API (https://prix6.win) — no direct Firestore writes.
// [Usage]
//   Setup:   ADMIN_PIN=yourpin npx ts-node --project tsconfig.scripts.json scripts/season-test-orchestrator.ts
//   Purge:   ADMIN_PIN=yourpin npx ts-node --project tsconfig.scripts.json scripts/season-test-orchestrator.ts --purge
// [Preseason only] Run before any real qualifying deadline passes.
//          Purge after with --purge flag. Delete the 10 Firebase Auth accounts manually afterward.
// [Email]  Welcome emails will land in aaron.garcia.uk+01..+10@gmail.com (all same inbox).
//          DAILY_GLOBAL_LIMIT must be >= 300 in email-tracking.ts during this test.
// [Notes]  Sprint races use raceName = "X Grand Prix - Sprint".
//          CSRF: Origin header set to https://prix6.win on all auth calls.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://prix6.win';
const FIREBASE_API_KEY = 'AIzaSyA23isMS-Jt60amqI-0XZHoMZeQOawtsSk';
const ADMIN_EMAIL = 'aaron@garcia.ltd';
const ADMIN_PIN = process.env.ADMIN_PIN;
const IS_PURGE = process.argv.includes('--purge');
const DRY_RUN = process.argv.includes('--dry-run');
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../service-account.json');

if (!ADMIN_PIN) {
  console.error('ERROR: Set ADMIN_PIN env var before running (e.g. ADMIN_PIN=123456 npx ts-node ...)');
  process.exit(1);
}

// ─── FIREBASE ADMIN (read-only: fetch race schedule + purge) ─────────────────

if (!getApps().length) {
  initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
}
const db = getFirestore();

// ─── TEST ACCOUNTS ────────────────────────────────────────────────────────────
// All 10 land in the same Gmail inbox via + aliases.
// Team names use "test-" prefix — that's the only flag needed to identify them at purge time.

const TEST_PIN = '123456';

const TEST_ACCOUNTS = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    email: `aaron.garcia.uk+${n}@gmail.com`,
    pin: TEST_PIN,
    teamName: `test-team-${n}`,
  };
});

// ─── DRIVER POOL ──────────────────────────────────────────────────────────────
// Only these 10 drivers appear in any pick — keeps scoring realistic (top teams only).

const POOL = [
  'verstappen', 'norris', 'leclerc', 'hamilton', 'piastri',
  'russell', 'alonso', 'sainz', 'antonelli', 'hadjar',
];

// Each tester has a personality — their preferred ordering of the 10-driver pool.
// They pick their top-6 from this. After each race they may swap P5/P6 for variety.

const TESTER_PREFS: string[][] = [
  ['verstappen', 'norris',     'leclerc',   'hamilton',  'piastri',   'russell'  ], // T01 — The Consensus
  ['norris',     'verstappen', 'piastri',   'leclerc',   'russell',   'hamilton' ], // T02 — McLaren Backer
  ['leclerc',    'hamilton',   'norris',    'verstappen','alonso',    'sainz'    ], // T03 — Ferrari+Lewis
  ['hamilton',   'leclerc',    'verstappen','norris',    'piastri',   'alonso'   ], // T04 — Lewis Superfan
  ['piastri',    'norris',     'verstappen','russell',   'leclerc',   'antonelli'], // T05 — McLaren+Merc
  ['russell',    'antonelli',  'norris',    'verstappen','leclerc',   'hamilton' ], // T06 — Mercedes True
  ['alonso',     'verstappen', 'norris',    'hamilton',  'leclerc',   'sainz'    ], // T07 — Alonso Fan
  ['sainz',      'norris',     'verstappen','leclerc',   'hamilton',  'piastri'  ], // T08 — Williams Hope
  ['antonelli',  'russell',    'norris',    'verstappen','leclerc',   'hamilton' ], // T09 — Antonelli Watch
  ['hadjar',     'verstappen', 'norris',    'leclerc',   'hamilton',  'piastri'  ], // T10 — Hadjar Believer
];

// ─── PRE-SET RACE RESULTS ─────────────────────────────────────────────────────
// 24 GP results + up to 6 Sprint results. All picks from POOL only.
// Realistic variation: Verstappen wins ~8, Norris ~6, Leclerc ~4, Hamilton ~3, others ~1-2.
// Sprint results tend to mirror the corresponding GP but with some shuffle.

const GP_RESULTS: string[][] = [
  ['verstappen', 'norris',    'leclerc',   'hamilton',  'piastri',   'russell'  ], // R01 Australia
  ['norris',     'verstappen','piastri',   'leclerc',   'russell',   'alonso'   ], // R02 China
  ['verstappen', 'leclerc',   'hamilton',  'norris',    'alonso',    'sainz'    ], // R03 Japan
  ['norris',     'piastri',   'verstappen','russell',   'leclerc',   'hamilton' ], // R04 Bahrain
  ['verstappen', 'hamilton',  'leclerc',   'norris',    'alonso',    'antonelli'], // R05 Saudi
  ['norris',     'piastri',   'verstappen','leclerc',   'hamilton',  'russell'  ], // R06 Miami
  ['verstappen', 'norris',    'hamilton',  'leclerc',   'piastri',   'alonso'   ], // R07 Canada
  ['leclerc',    'hamilton',  'norris',    'verstappen','alonso',    'sainz'    ], // R08 Monaco
  ['norris',     'verstappen','piastri',   'russell',   'leclerc',   'antonelli'], // R09 Spain
  ['verstappen', 'leclerc',   'norris',    'hamilton',  'piastri',   'russell'  ], // R10 Austria
  ['norris',     'piastri',   'verstappen','russell',   'leclerc',   'antonelli'], // R11 Britain
  ['verstappen', 'norris',    'leclerc',   'hamilton',  'alonso',    'sainz'    ], // R12 Belgium
  ['hamilton',   'leclerc',   'norris',    'verstappen','piastri',   'alonso'   ], // R13 Hungary
  ['verstappen', 'norris',    'piastri',   'leclerc',   'russell',   'hamilton' ], // R14 Netherlands
  ['leclerc',    'hamilton',  'norris',    'verstappen','piastri',   'alonso'   ], // R15 Italy
  ['norris',     'verstappen','leclerc',   'piastri',   'hamilton',  'sainz'    ], // R16 Spain II
  ['verstappen', 'norris',    'hamilton',  'leclerc',   'russell',   'antonelli'], // R17 Azerbaijan
  ['hamilton',   'leclerc',   'norris',    'alonso',    'sainz',     'verstappen'], // R18 Singapore
  ['verstappen', 'hamilton',  'norris',    'piastri',   'leclerc',   'alonso'   ], // R19 USA
  ['verstappen', 'norris',    'leclerc',   'hamilton',  'piastri',   'sainz'    ], // R20 Mexico
  ['hamilton',   'leclerc',   'verstappen','norris',    'piastri',   'alonso'   ], // R21 Brazil
  ['verstappen', 'norris',    'leclerc',   'piastri',   'hamilton',  'russell'  ], // R22 Las Vegas
  ['norris',     'verstappen','leclerc',   'hamilton',  'piastri',   'russell'  ], // R23 Qatar
  ['verstappen', 'norris',    'hamilton',  'leclerc',   'piastri',   'russell'  ], // R24 Abu Dhabi
];

// Sprint results keyed by GP name (only for hasSprint races).
// 6 sprints in 2026 (China, Miami, Britain, Netherlands, USA, Qatar per schedule).
const SPRINT_RESULTS: Record<string, string[]> = {
  'Chinese Grand Prix':    ['norris', 'verstappen', 'piastri',   'leclerc',  'hamilton',  'russell'  ],
  'Miami Grand Prix':      ['piastri','norris',     'verstappen','hamilton', 'leclerc',   'russell'  ],
  'British Grand Prix':    ['norris', 'piastri',    'verstappen','russell',  'leclerc',   'antonelli'],
  'Dutch Grand Prix':      ['verstappen','norris',  'piastri',   'leclerc',  'hamilton',  'russell'  ],
  'United States Grand Prix': ['verstappen','norris','hamilton', 'piastri',  'leclerc',   'alonso'   ],
  'Qatar Grand Prix':      ['norris', 'verstappen', 'leclerc',   'hamilton', 'piastri',   'russell'  ],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function sep() { console.log('─'.repeat(70)); }

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Exchange a Firebase customToken for an idToken via REST API */
async function exchangeCustomToken(customToken: string): Promise<string> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data: any = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/** POST to an API endpoint with Bearer token */
async function apiPost(path: string, body: object, idToken?: string): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': BASE_URL,  // Required for CSRF check on auth endpoints
  };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Pick 6 drivers for a tester for a given race round.
 *  Base = their preference. Swap P5/P6 based on round parity for mild variation. */
function pickDrivers(testerIndex: number, round: number): string[] {
  const base = [...TESTER_PREFS[testerIndex]]; // 6 picks
  // Every 3 rounds, rotate the last pick within the pool
  if (round % 3 === 0) {
    const poolExcludes = new Set(base.slice(0, 5));
    const alternate = POOL.find(d => !poolExcludes.has(d));
    if (alternate) base[5] = alternate;
  }
  return base;
}

// ─── STATE (populated at runtime) ────────────────────────────────────────────

interface Tester {
  email: string;
  teamName: string;
  uid: string;
  idToken: string;
}

// ─── PHASE 1: CREATE TEST ACCOUNTS ───────────────────────────────────────────

async function createTestAccounts(): Promise<Tester[]> {
  sep();
  log('PHASE 1 — Creating 10 test accounts (sequential)');
  sep();

  const testers: Tester[] = [];

  for (let i = 0; i < TEST_ACCOUNTS.length; i++) {
    const acct = TEST_ACCOUNTS[i];
    log(`  Signing up ${acct.teamName} (${acct.email})...`);

    if (DRY_RUN) {
      log('  [DRY RUN] skipped');
      testers.push({ email: acct.email, teamName: acct.teamName, uid: `dry-uid-${i}`, idToken: 'dry-token' });
      continue;
    }

    const res = await apiPost('/api/auth/signup', {
      email: acct.email,
      pin: acct.pin,
      teamName: acct.teamName,
    });

    if (!res.success) {
      log(`  ERROR: ${JSON.stringify(res)}`);
      throw new Error(`Signup failed for ${acct.teamName}`);
    }

    const idToken = await exchangeCustomToken(res.customToken);
    testers.push({ email: acct.email, teamName: acct.teamName, uid: res.uid, idToken });
    log(`  ✓ ${acct.teamName} uid=${res.uid}`);

    await sleep(1200); // Pace signups — sentinel guard
  }

  return testers;
}

// ─── PHASE 2: ADMIN LOGIN ─────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  sep();
  log('PHASE 2 — Authenticating admin');
  sep();

  if (DRY_RUN) { log('  [DRY RUN] skipped'); return 'dry-admin-token'; }

  const res = await apiPost('/api/auth/login', { email: ADMIN_EMAIL, pin: ADMIN_PIN });
  if (!res.success) throw new Error(`Admin login failed: ${JSON.stringify(res)}`);
  const idToken = await exchangeCustomToken(res.customToken);
  log(`  ✓ Admin logged in (uid=${res.uid})`);
  return idToken;
}

// ─── PHASE 3: SEASON LOOP ─────────────────────────────────────────────────────

async function runSeason(testers: Tester[], adminToken: string) {
  sep();
  log('PHASE 3 — Fetching race schedule from Firestore');
  sep();

  const scheduleSnap = await db.collection('race_schedule').orderBy('round').get();
  if (scheduleSnap.empty) throw new Error('race_schedule collection is empty — seed it first');

  const races = scheduleSnap.docs.map(d => d.data() as {
    name: string; round: number; hasSprint: boolean;
  });

  log(`  Found ${races.length} races in schedule`);
  sep();

  const scoreboard: Record<string, number> = {};
  testers.forEach(t => { scoreboard[t.teamName] = 0; });

  for (let ri = 0; ri < races.length; ri++) {
    const race = races[ri];
    const round = race.round; // 1-based
    const gpResultIndex = ri; // parallel array

    // Events for this race weekend
    const events: Array<{ raceName: string; result: string[] }> = [];
    if (race.hasSprint && SPRINT_RESULTS[race.name]) {
      events.push({ raceName: `${race.name} - Sprint`, result: SPRINT_RESULTS[race.name] });
    }
    const gpResult = GP_RESULTS[gpResultIndex] || GP_RESULTS[GP_RESULTS.length - 1];
    events.push({ raceName: race.name, result: gpResult });

    for (const event of events) {
      const isSprint = event.raceName.includes('Sprint');
      sep();
      log(`ROUND ${round}${isSprint ? ' (SPRINT)' : ''}: ${event.raceName}`);
      log(`  Actual result: ${event.result.join(', ')}`);
      sep();

      // ── STEP A: All testers submit predictions ──────────────────────────────
      log('  → Testers submitting predictions...');
      for (let ti = 0; ti < testers.length; ti++) {
        const tester = testers[ti];
        const picks = pickDrivers(ti, round);
        log(`    ${tester.teamName}: ${picks.join(', ')}`);

        if (DRY_RUN) continue;

        const predRes = await apiPost('/api/submit-prediction', {
          userId: tester.uid,
          teamId: tester.uid,
          teamName: tester.teamName,
          raceId: event.raceName.replace(/\s+/g, '-'),
          raceName: event.raceName,
          predictions: picks,
        }, tester.idToken);

        if (!predRes.success) {
          log(`    ⚠ Prediction failed for ${tester.teamName}: ${JSON.stringify(predRes)}`);
        } else {
          process.stdout.write('.');
        }
        await sleep(300);
      }
      if (!DRY_RUN) console.log(); // newline after dots

      await sleep(500);

      // ── STEP B: Admin enters race result ───────────────────────────────────
      log(`  → Admin entering result for "${event.raceName}"...`);
      const [d1, d2, d3, d4, d5, d6] = event.result;
      const raceId = event.raceName.replace(/\s+/g, '-');

      if (!DRY_RUN) {
        const scoreRes = await apiPost('/api/calculate-scores', {
          raceId,
          raceName: event.raceName,
          driver1: d1, driver2: d2, driver3: d3,
          driver4: d4, driver5: d5, driver6: d6,
        }, adminToken);

        if (!scoreRes.success) {
          log(`  ⚠ Scoring failed: ${JSON.stringify(scoreRes)}`);
        } else {
          log(`  ✓ Scored. ${scoreRes.scores?.length ?? 0} team scores calculated.`);
          // Update local scoreboard
          if (Array.isArray(scoreRes.scores)) {
            scoreRes.scores.forEach((s: any) => {
              if (s.teamName in scoreboard) scoreboard[s.teamName] += (s.points || 0);
            });
          }
        }
      } else {
        log('  [DRY RUN] scoring skipped');
      }

      await sleep(1000);
    }

    // ── STEP C: Standings snapshot after this round ─────────────────────────
    const ranked = Object.entries(scoreboard).sort(([,a],[,b]) => b - a);
    log(`  Standings after R${round}:`);
    ranked.forEach(([team, pts], i) => log(`    ${i+1}. ${team}: ${pts}pts`));
  }

  sep();
  log('SEASON COMPLETE — Final standings:');
  Object.entries(scoreboard).sort(([,a],[,b]) => b - a)
    .forEach(([team, pts], i) => log(`  ${i+1}. ${team} — ${pts} pts`));
  sep();
}

// ─── PHASE 4: PURGE ───────────────────────────────────────────────────────────

async function purge(adminToken: string) {
  sep();
  log('PHASE 4 — PURGE MODE');
  sep();

  // 4a. Delete scores for all races + sprints
  const scheduleSnap = await db.collection('race_schedule').orderBy('round').get();
  const races = scheduleSnap.docs.map(d => d.data() as { name: string; hasSprint: boolean });

  for (const race of races) {
    // GP
    const gpRaceId = race.name.replace(/\s+/g, '-') + '-GP';
    log(`  Deleting scores: ${gpRaceId}`);
    if (!DRY_RUN) {
      const r = await apiPost('/api/delete-scores', { raceId: gpRaceId, raceName: race.name }, adminToken);
      log(`    → scores=${r.scoresDeleted ?? '?'} predictions=${r.predictionsDeleted ?? '?'}`);
      await sleep(400);
    }

    // Sprint (if applicable)
    if (race.hasSprint && SPRINT_RESULTS[race.name]) {
      const sprintRaceId = race.name.replace(/\s+/g, '-') + '-Sprint';
      const sprintRaceName = `${race.name} - Sprint`;
      log(`  Deleting scores: ${sprintRaceId}`);
      if (!DRY_RUN) {
        const r = await apiPost('/api/delete-scores', { raceId: sprintRaceId, raceName: sprintRaceName }, adminToken);
        log(`    → scores=${r.scoresDeleted ?? '?'} predictions=${r.predictionsDeleted ?? '?'}`);
        await sleep(400);
      }
    }
  }

  // 4b. Delete test users via Admin SDK (direct Firestore + note about Auth)
  log('  Deleting test user Firestore docs...');
  const usersSnap = await db.collection('users')
    .where('teamName', '>=', 'test-team-')
    .where('teamName', '<=', 'test-team-\uffff')
    .get();

  log(`  Found ${usersSnap.size} test user docs`);
  const batch = db.batch();
  const deletedUids: string[] = [];
  usersSnap.forEach(doc => {
    deletedUids.push(doc.id);
    batch.delete(doc.ref);
  });
  if (!DRY_RUN && !usersSnap.empty) {
    await batch.commit();
    log(`  ✓ Deleted ${deletedUids.length} Firestore user docs`);
  }

  // 4c. Remove from global league
  if (deletedUids.length > 0) {
    log('  Removing test users from global league...');
    const { FieldValue } = await import('firebase-admin/firestore');
    const leagueRef = db.collection('leagues').doc('global');
    if (!DRY_RUN) {
      await leagueRef.update({ memberUserIds: FieldValue.arrayRemove(...deletedUids) });
      log('  ✓ Removed from global league');
    }
  }

  sep();
  log('PURGE COMPLETE');
  log('⚠  MANUAL STEP REQUIRED: Delete these Firebase Auth accounts from the Firebase Console:');
  log('   https://console.firebase.google.com/project/studio-6033436327-281b1/authentication/users');
  deletedUids.forEach(uid => log(`   uid: ${uid}`));
  sep();
}

// ─── ENTRYPOINT ───────────────────────────────────────────────────────────────

async function main() {
  sep();
  log('Prix Six — Season Test Orchestrator v1');
  log(`Mode: ${IS_PURGE ? 'PURGE' : DRY_RUN ? 'DRY RUN' : 'FULL SEASON TEST'}`);
  log(`Target: ${BASE_URL}`);
  sep();

  const adminToken = await getAdminToken();

  if (IS_PURGE) {
    await purge(adminToken);
    return;
  }

  const testers = await createTestAccounts();
  await runSeason(testers, adminToken);

  log('');
  log('Run with --purge when ready to clean up test data.');
  log('Then manually delete the 10 Firebase Auth accounts from the console.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
