/**
 * Count teams in the database
 * Run:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = ".\service-account.json"
 *   npx ts-node --project tsconfig.scripts.json scripts/count-teams.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin using GOOGLE_APPLICATION_CREDENTIALS
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS not set');
  console.error('Run: $env:GOOGLE_APPLICATION_CREDENTIALS = ".\\service-account.json"');
  process.exit(1);
}

const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function countTeams() {
  const usersSnapshot = await db.collection('users').get();

  console.log('=== Team Count ===');
  console.log('Total teams:', usersSnapshot.size);
  console.log('');

  let admins = 0;
  let regular = 0;
  const teams: { teamName: string; email: string; isAdmin: boolean }[] = [];

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.isAdmin) {
      admins++;
    } else {
      regular++;
    }
    teams.push({
      teamName: data.teamName || 'Unknown',
      email: data.email,
      isAdmin: data.isAdmin || false,
    });
  });

  console.log('Admins:', admins);
  console.log('Regular users:', regular);
  console.log('');
  console.log('=== Team List ===');

  // Sort by team name
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName));

  teams.forEach(team => {
    const adminFlag = team.isAdmin ? ' [ADMIN]' : '';
    console.log(`- ${team.teamName}${adminFlag} (${team.email})`);
  });
}

countTeams()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
