/**
 * Seed Race Schedule to Firestore
 *
 * @SECURITY_FIX: GEMINI-AUDIT-052 - Move hardcoded race timing data to Firestore.
 *   Creates a trusted server-side source of truth for race schedule that cannot be
 *   tampered with by clients. Admin-only writable collection prevents unauthorized modifications.
 *
 * This script migrates the hardcoded RaceSchedule from app/src/lib/data.ts to Firestore
 * collection `race_schedule`. Each race becomes a document with fields:
 * - name: Race name (e.g., "Australian Grand Prix")
 * - location: Circuit location
 * - qualifyingTime: UTC ISO string when predictions lock
 * - raceTime: UTC ISO string for main GP
 * - sprintTime?: UTC ISO string for sprint (sprint weekends only)
 * - hasSprint: boolean flag
 * - round: Race number (1-24) based on chronological order
 *
 * Document IDs use normalized race names (e.g., "australian-grand-prix").
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/seed-race-schedule.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { RaceSchedule } from '../src/lib/data';

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Helper to normalize race name to document ID (lowercase, hyphenated)
function normalizeRaceName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

async function seedRaceSchedule() {
  console.log('\n🏁 Seeding race_schedule collection from RaceSchedule...\n');
  console.log('═'.repeat(70));

  const collectionRef = db.collection('race_schedule');

  // Check if collection already has data
  const existingDocs = await collectionRef.limit(1).get();
  if (!existingDocs.empty) {
    console.log('\n⚠️  WARNING: race_schedule collection already contains data!');
    console.log('   This will OVERWRITE existing race schedule documents.\n');

    // Could add confirmation prompt here if needed
  }

  console.log(`\nSource: RaceSchedule from app/src/lib/data.ts`);
  console.log(`Total races to seed: ${RaceSchedule.length}\n`);
  console.log('─'.repeat(70));

  const batch = db.batch();
  let seededCount = 0;

  RaceSchedule.forEach((race, index) => {
    const docId = normalizeRaceName(race.name);
    const docRef = collectionRef.doc(docId);

    // Prepare document data (exclude 'results' field - not part of schedule)
    const scheduleData: any = {
      name: race.name,
      location: race.location,
      qualifyingTime: race.qualifyingTime,
      raceTime: race.raceTime,
      hasSprint: race.hasSprint,
      round: index + 1, // Race number (1-24) in chronological order
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add sprintTime only for sprint weekends
    if (race.sprintTime) {
      scheduleData.sprintTime = race.sprintTime;
    }

    batch.set(docRef, scheduleData);
    seededCount++;

    console.log(`  ✓ R${index + 1}: ${race.name} (${docId})`);
    if (race.hasSprint) {
      console.log(`     └─ Sprint weekend`);
    }
  });

  // Commit batch
  await batch.commit();

  console.log('\n' + '═'.repeat(70));
  console.log(`✅ Successfully seeded ${seededCount} races to race_schedule collection`);
  console.log('\n📊 Collection: race_schedule');
  console.log('   Admin-only writable (Firestore rules)');
  console.log('   Server-side source of truth for race timing');
  console.log('\n🔒 Security: GEMINI-AUDIT-052 resolved');
  console.log('   - Client cannot tamper with displayed deadlines');
  console.log('   - Server validates against trusted Firestore source');
  console.log('   - Admin can update schedule without code deploy');
  console.log('═'.repeat(70) + '\n');
}

// Run the script
seedRaceSchedule()
  .then(() => {
    console.log('Script finished successfully.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed with error:', error);
    process.exit(1);
  });
