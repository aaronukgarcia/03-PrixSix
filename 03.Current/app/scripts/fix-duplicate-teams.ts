/**
 * Script to find and fix duplicate team names
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/fix-duplicate-teams.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

// Automotive-themed names for duplicates
const automotiveNames = [
  "Turbo Torque",
  "Apex Predator",
  "Slipstream Kings",
  "Downforce Dynasty",
  "Carbon Fiber Crew",
  "Pit Stop Pros",
  "DRS Demons",
  "Undercut United",
  "Tire Whisperers",
  "Chicane Chasers",
  "Pole Position Posse",
  "Brake Late Brigade",
  "Aero Aces",
  "Fuel Strategy FC",
  "Grid Penalty Gang",
  "Soft Compound Squad",
  "Blue Flag Bandits",
  "Safety Car Survivors",
  "Virtual Safety Crew",
  "Track Limits Legends",
];

async function main() {
  // Initialize Firebase Admin
  const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
    });
  }

  const db = admin.firestore();

  console.log('🔍 Scanning for duplicate team names...\n');

  // Fetch all users
  const usersSnapshot = await db.collection('users').get();
  const users: { id: string; teamName: string; email: string }[] = [];

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    users.push({
      id: doc.id,
      teamName: data.teamName || '',
      email: data.email || '',
    });
  });

  console.log(`Found ${users.length} total users\n`);

  // Find duplicates (case-insensitive)
  const teamNameMap = new Map<string, typeof users>();

  for (const user of users) {
    const normalizedName = user.teamName.toLowerCase().trim();
    if (!teamNameMap.has(normalizedName)) {
      teamNameMap.set(normalizedName, []);
    }
    teamNameMap.get(normalizedName)!.push(user);
  }

  // Filter to only duplicates
  const duplicates: [string, typeof users][] = [];
  teamNameMap.forEach((usersWithName, name) => {
    if (usersWithName.length > 1) {
      duplicates.push([name, usersWithName]);
    }
  });

  if (duplicates.length === 0) {
    console.log('✅ No duplicate team names found!');
    process.exit(0);
  }

  console.log(`⚠️  Found ${duplicates.length} duplicate team name(s):\n`);

  let autoNameIndex = 0;
  const updates: { id: string; oldName: string; newName: string; email: string }[] = [];

  for (const [normalizedName, usersWithName] of duplicates) {
    console.log(`Team name "${usersWithName[0].teamName}" has ${usersWithName.length} users:`);

    // Keep the first one, rename the rest
    for (let i = 0; i < usersWithName.length; i++) {
      const user = usersWithName[i];
      if (i === 0) {
        console.log(`  ✓ ${user.email} - KEEP as "${user.teamName}"`);
      } else {
        const newName = automotiveNames[autoNameIndex % automotiveNames.length];
        autoNameIndex++;
        updates.push({
          id: user.id,
          oldName: user.teamName,
          newName,
          email: user.email,
        });
        console.log(`  → ${user.email} - RENAME to "${newName}"`);
      }
    }
    console.log('');
  }

  if (updates.length === 0) {
    console.log('No updates needed.');
    process.exit(0);
  }

  // Prompt for confirmation (in non-interactive mode, just proceed)
  console.log(`\n📝 About to rename ${updates.length} team(s)...\n`);

  // Apply updates
  const batch = db.batch();

  for (const update of updates) {
    const userRef = db.collection('users').doc(update.id);
    batch.update(userRef, { teamName: update.newName });
    console.log(`  Updating ${update.email}: "${update.oldName}" → "${update.newName}"`);
  }

  await batch.commit();

  console.log('\n✅ All duplicates have been renamed!');
  console.log('\nSummary of changes:');
  for (const update of updates) {
    console.log(`  - ${update.email}: "${update.oldName}" → "${update.newName}"`);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
