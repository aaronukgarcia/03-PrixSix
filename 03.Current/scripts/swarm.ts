import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Auth via Environment Variable
if (!getApps().length) initializeApp();
const db = getFirestore();

const START_ID = parseInt(process.argv[2] || '1');
const COUNT = parseInt(process.argv[3] || '100');
const END_ID = START_ID + COUNT - 1;

console.log('?? SWARM WORKER ALIVE: Users ' + START_ID + ' to ' + END_ID);

db.collection('system').doc('state').onSnapshot(async (snap) => {
  const state = snap.data();
  if (!state) return;

  console.log('\n?? SIGNAL: ' + state.phase + ' (Race ' + state.raceNumber + ')');

  if (state.phase === 'REGISTRATION') {
    await registerUsers();
  } 
  else if (state.phase === 'PREDICTIONS_OPEN') {
    await submitPredictions(state.raceNumber);
  }
});

async function registerUsers() {
  console.log('?? Registering batch...');
  const batch = db.batch();
  for (let i = START_ID; i <= END_ID; i++) {
    const uid = 'user_' + i.toString().padStart(4, '0');
    batch.set(db.collection('users').doc(uid), {
      email: uid + '@test.com',
      teamName: 'Team ' + uid,
      totalPoints: 0,
      audit: [] 
    });
  }
  await batch.commit();
  console.log('? Registered.');
}

async function submitPredictions(raceNum: any) {
  console.log('?? Predicting Race ' + raceNum + '...');
  const batch = db.batch();
  
  // Random delay 0-3s
  const delay = Math.floor(Math.random() * 3000);
  await new Promise(r => setTimeout(r, delay));

  for (let i = START_ID; i <= END_ID; i++) {
    const uid = 'user_' + i.toString().padStart(4, '0');
    const prediction = ['VER', 'NOR', 'LEC', 'PIA', 'HAM', 'RUS', 'SAI', 'ALO', 'PER', 'OCO']
                       .sort(() => Math.random() - 0.5).slice(0, 6);
    
    const predRef = db.collection('users').doc(uid).collection('predictions').doc('race_' + raceNum);
    batch.set(predRef, { picks: prediction, timestamp: Timestamp.now() });

    // Explicitly type this object as 'any' to stop the error
    const updateData: any = {};
    updateData['lastActive'] = Timestamp.now();
    updateData['audit_race_' + raceNum] = 'Submitted at ' + new Date().toISOString();
    
    const userRef = db.collection('users').doc(uid);
    batch.update(userRef, updateData);
  }
  await batch.commit();
  console.log('? Submitted.');
}

setInterval(() => {}, 1000);
