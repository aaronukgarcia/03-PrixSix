import * as admin from 'firebase-admin';
import * as path from 'path';
import { generateRaceId } from '../src/lib/normalize-race-id';
import { RaceSchedule } from '../src/lib/data';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();

async function debugStandings() {
  console.log('\n🔍 STANDINGS DEBUG\n');

  // Get actual race IDs from scores
  const scoresSnapshot = await db.collection('scores').get();
  const raceIdsInScores = new Set<string>();

  scoresSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.raceId) {
      raceIdsInScores.add(data.raceId);
    }
  });

  console.log(`📊 Found ${scoresSnapshot.size} scores with ${raceIdsInScores.size} unique race IDs\n`);
  console.log('Actual raceIds in scores:', Array.from(raceIdsInScores).sort().slice(0, 10), '...\n');

  // Check what standings page expects
  console.log('Expected race IDs from RaceSchedule:\n');

  let matchCount = 0;
  let mismatchCount = 0;

  RaceSchedule.forEach((race, index) => {
    const gpRaceId = generateRaceId(race.name, 'gp');
    const sprintRaceId = race.hasSprint ? generateRaceId(race.name, 'sprint') : null;

    const hasGpScores = raceIdsInScores.has(gpRaceId);
    const hasSprintScores = sprintRaceId ? raceIdsInScores.has(sprintRaceId) : null;

    if (hasGpScores) {
      matchCount++;
    } else {
      mismatchCount++;
      console.log(`  ❌ ${race.name}`);
      console.log(`     Expected GP: ${gpRaceId}`);
      console.log(`     Has scores: NO`);

      // Check if there's a similar raceId
      const similar = Array.from(raceIdsInScores).find(id =>
        id.toLowerCase().includes(race.name.toLowerCase().split(' ')[0])
      );
      if (similar) {
        console.log(`     Found similar: ${similar}\n`);
      }
    }
  });

  console.log(`\n📊 Summary:`);
  console.log(`  Matches: ${matchCount}`);
  console.log(`  Mismatches: ${mismatchCount}\n`);

  if (mismatchCount === 0) {
    console.log('✅ All race IDs match! Standings should work.\n');
  } else {
    console.log('⚠️  Race ID mismatch detected. This is why standings are empty.\n');
  }
}

debugStandings().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
