import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();
const db = getFirestore();

// ARGS: npx ts-node scripts/swarm.ts [START_ID] [COUNT]
const START_ID = parseInt(process.argv[2] || '1');
const COUNT = parseInt(process.argv[3] || '100');
const END_ID = START_ID + COUNT - 1;

console.log(`🐝 SWARM WORKER ALIVE: Managing Users ${START_ID} to ${END_ID}`);

// Listen to the Director
db.collection('system').doc('state').onSnapshot(async (snap) => {
  const state = snap.data();
  if (!state) return;

  console.log(`\n🔔 SIGNAL RECEIVED: ${state.phase} (Race ${state.raceNumber})`);

  if (state.phase === 'REGISTRATION') {
    await registerUsers();
  } 
  else if (state.phase === 'PREDICTIONS_OPEN') {
    await submitPredictions(state.raceNumber);
  }
});

// ACTIONS
async function registerUsers() {
  console.log('📝 Registering my batch...');
  const batch = db.batch();
  for (let i = START_ID; i <= END_ID; i++) {
    const uid = `user_${i.toString().padStart(4, '0')}`;
    batch.set(db.collection('users').doc(uid), {
      email: `${uid}@test.com`,
      teamName: `Team ${uid}`,
      totalPoints: 0,
      audit: [] // The Audit Trail
    });
  }
  await batch.commit();
  console.log(`✅ ${COUNT} Users Registered.`);
}

async function submitPredictions(raceNum: number) {
  console.log(`🔮 Submitting predictions for Race ${raceNum}...`);
  const batch = db.batch();
  
  // Random "Human" Delay (0-5 seconds) to prevent artificial perfect syncing
  const delay = Math.floor(Math.random() * 5000);
  await new Promise(r => setTimeout(r, delay));

  for (let i = START_ID; i <= END_ID; i++) {
    const uid = `user_${i.toString().padStart(4, '0')}`;
    // Dynamic prediction: Teams change their minds every race!
    const prediction = shuffle(['VER', 'NOR', 'LEC', 'PIA', 'HAM', 'RUS', 'SAI', 'ALO', 'PER', 'OCO']).slice(0, 6);
    
    // Write Prediction
    const predRef = db.collection('users').doc(uid).collection('predictions').doc(`race_${raceNum}`);
    batch.set(predRef, { picks: prediction, timestamp: Timestamp.now() });

    // Update Audit Trail (Grow the document size)
    const userRef = db.collection('users').doc(uid);
    // Note: In real app, use arrayUnion, but for load testing, we simulate the data growth
    batch.update(userRef, { 
      lastActive: Timestamp.now(),
      [`audit_race_${raceNum}`]: `Submitted at ${new Date().toISOString()}`
    });
  }
  await batch.commit();
  console.log(`✅ ${COUNT} Predictions Submitted.`);
}

function shuffle(array: string[]) {
  return array.sort(() => Math.random() - 0.5);
}

// Keep process alive
setInterval(() => {}, 1000);