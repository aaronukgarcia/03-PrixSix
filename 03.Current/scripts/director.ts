import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as readline from 'readline';

// Simple Auth: Relies on GOOGLE_APPLICATION_CREDENTIALS env var
if (!getApps().length) initializeApp();
const db = getFirestore();

const TOTAL_RACES = 24;
const SYSTEM_DOC = db.collection('system').doc('state');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

async function runDirector() {
  console.log('?? DIRECTOR: Connected.');
  await SYSTEM_DOC.set({ phase: 'IDLE', raceNumber: 0, message: 'Waiting to start' });

  await ask('\n[ENTER] to Open REGISTRATION for 2000 Users...');
  await SYSTEM_DOC.set({ phase: 'REGISTRATION', raceNumber: 0, message: 'Registration Open' });
  console.log('?? Signal sent: REGISTRATION OPEN.');

  for (let race = 1; race <= TOTAL_RACES; race++) {
    await ask('\n[ENTER] to Open Predictions for Race ' + race + '...');
    await SYSTEM_DOC.set({ phase: 'PREDICTIONS_OPEN', raceNumber: race, message: 'Predicting Race ' + race });
    console.log('?? PREDICTIONS OPEN: Race ' + race);

    await ask('\n[ENTER] to LOCK & RUN Race ' + race + '...');
    console.log('? Locking Grid...');
    await SYSTEM_DOC.set({ phase: 'LOCKED', raceNumber: race, message: 'Race in Progress' });
    
    console.log('???  Racing...');
    await new Promise(r => setTimeout(r, 1000)); 
    
    await SYSTEM_DOC.set({ phase: 'RACE_COMPLETE', raceNumber: race, message: 'Race ' + race + ' Finished' });
    console.log('?? Race ' + race + ' Complete.');
  }
  console.log('\n? SEASON COMPLETE.');
  process.exit(0);
}
runDirector();
