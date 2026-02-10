import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// FIX: Use getApps() for correct module check
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

// --- CONFIGURATION ---
const SEASON_START_DATE = new Date('2025-03-15T12:00:00Z');
const USERS_COLLECTION = 'users';
const RACES_COLLECTION = 'races';
const PREDICTIONS_COLLECTION = 'predictions'; 

// --- DATASETS ---
const RACE_NAMES = [
  'Bahrain', 'Saudi Arabia', 'Australia', 'Japan', 'China', 'Miami', 'Imola', 'Monaco', 
  'Canada', 'Spain', 'Austria', 'UK', 'Hungary', 'Belgium', 'Netherlands', 'Italy', 
  'Azerbaijan', 'Singapore', 'USA', 'Mexico', 'Brazil', 'Las Vegas', 'Qatar', 'Abu Dhabi'
];

// --- ARCHETYPES ---
const ARCHETYPES = {
  DOMINATORS: { start: 1, end: 3 },    
  MIDFIELD:   { start: 4, end: 10 },   
  QUITTERS:   { start: 11, end: 15 },  
  LATE_JOIN:  { start: 16, end: 18 },  
  CLONES:     { start: 19, end: 20 }   
};

// --- HELPERS ---
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateUserId(num: number): string { 
  return 'user_' + num.toString().padStart(2, '0'); 
}

function getWinningResult(): string[] { 
  return ['VER', 'NOR', 'LEC', 'PIA', 'HAM', 'RUS', 'SAI', 'ALO', 'PER', 'OCO']; 
}

// --- MAIN SCRIPT ---
async function seedBigShakedown() {
  console.log(' STARTING BIG SHAKEDOWN SEED...');
  const batch = db.batch();
  
  // 1. CREATE USERS
  console.log('Creating 20 Users...');
  for (let i = 1; i <= 20; i++) {
    const userId = generateUserId(i);
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    
    let teamName = 'Team ' + i;
    if (i <= 3) teamName = 'Dominator ' + i;
    else if (i <= 10) teamName = 'Midfield ' + i;
    else if (i <= 15) teamName = 'Quitter ' + i;
    else if (i <= 18) teamName = 'Late Joiner ' + i;
    else teamName = 'Clone ' + i;

    batch.set(userRef, {
      email: userId + '@test.com',
      teamName: teamName,
      totalPoints: 0,
      rank: 20 
    });
  }

  // 2. CREATE RACES
  console.log('Creating 24 Races...');
  const races: any[] = [];
  for (let i = 0; i < 24; i++) {
    const raceId = 'race_' + (i + 1).toString().padStart(2, '0');
    const raceDate = addDays(SEASON_START_DATE, i * 7); 
    
    const raceData = {
      id: raceId,
      name: RACE_NAMES[i] + ' GP',
      qualifyingTime: raceDate.toISOString(), 
      status: 'COMPLETED',
      result: getWinningResult() 
    };
    
    races.push(raceData);
    const raceRef = db.collection(RACES_COLLECTION).doc(raceId);
    batch.set(raceRef, raceData);
  }

  await batch.commit();
  console.log(' Users and Races Created.');

  // 3. GENERATE PREDICTIONS & CALCULATE SCORES LOOP
  console.log(' Simulating Season (Predictions & Scoring)...');
  
  // Explicit Type Definition
  const userScores: Record<string, number> = {};
  for(let i=1; i<=20; i++) userScores[generateUserId(i)] = 0;

  for (let r = 0; r < 24; r++) {
    const race = races[r];
    const raceNum = r + 1;
    const winningResult = race.result;
    const raceBatch = db.batch(); 

    for (let u = 1; u <= 20; u++) {
      const userId = generateUserId(u);
      let prediction: string[] | null = null;

      // ARCHETYPE LOGIC
      if (u >= ARCHETYPES.DOMINATORS.start && u <= ARCHETYPES.DOMINATORS.end) {
        prediction = winningResult.slice(0, 6); 
      }
      else if (u >= ARCHETYPES.MIDFIELD.start && u <= ARCHETYPES.MIDFIELD.end) {
        if (raceNum % 2 !== 0) {
           prediction = winningResult.slice(0, 6); 
        } else {
           prediction = ['VER', 'TSU', 'ALB', 'GAS', 'HUL', 'MAG']; 
        }
      }
      else if (u >= ARCHETYPES.QUITTERS.start && u <= ARCHETYPES.QUITTERS.end) {
        if (raceNum <= 5) {
          prediction = winningResult.slice(0, 6); 
        } else {
          prediction = null; 
        }
      }
      else if (u >= ARCHETYPES.LATE_JOIN.start && u <= ARCHETYPES.LATE_JOIN.end) {
        if (raceNum >= 10) {
          prediction = winningResult.slice(0, 6); 
        } else {
          prediction = null; 
        }
      }
      else if (u >= ARCHETYPES.CLONES.start && u <= ARCHETYPES.CLONES.end) {
        prediction = ['VER', 'NOR', 'LEC', 'PIA', 'TSU', 'ALB'];
      }

      if (prediction) {
        const predRef = db.collection(USERS_COLLECTION).doc(userId)
                          .collection(PREDICTIONS_COLLECTION).doc(race.id);
        raceBatch.set(predRef, {
          predictions: prediction,
          timestamp: Timestamp.now()
        });

        let raceScore = 0;
        let correctCount = 0;
        
        prediction.forEach((driver: string) => {
          if (winningResult.includes(driver)) {
            raceScore += 1;
            correctCount++;
          }
        });

        if (correctCount === 5) raceScore += 3;
        if (correctCount === 6) raceScore += 5;

        userScores[userId] += raceScore;
      }
    }

    for (let u = 1; u <= 20; u++) {
      const userId = generateUserId(u);
      const userRef = db.collection(USERS_COLLECTION).doc(userId);
      raceBatch.update(userRef, { totalPoints: userScores[userId] });
    }

    await batch.commit(); // Use global batch or raceBatch correctly? 
    // Using raceBatch here for updates
    await raceBatch.commit();
    
    if (raceNum === 5 || raceNum === 12 || raceNum === 24) {
      console.log('\n STANDINGS AFTER RACE ' + raceNum + ':');
      const sorted = Object.entries(userScores).sort(([,a], [,b]) => (b as number) - (a as number));
      sorted.forEach(([uid, score], idx) => {
        if (idx < 5 || uid.includes('19') || uid.includes('20')) {
          console.log('#' + (idx+1) + ' ' + uid + ': ' + score + ' pts');
        }
      });
    }
  }
  console.log('\n BIG SHAKEDOWN SEEDING COMPLETE.');
}

seedBigShakedown().catch(console.error);
