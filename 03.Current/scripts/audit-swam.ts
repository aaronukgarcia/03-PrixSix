import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Auth via Environment Variable
if (!getApps().length) initializeApp();
const db = getFirestore();

async function auditSwarm() {
  console.log('🕵️‍♂️ STARTING RANDOM AUDIT of 2000 USERS...');
  
  // Pick 5 random IDs between 1 and 2000
  const randomIds = Array.from({length: 5}, () => Math.floor(Math.random() * 2000) + 1);

  for (const id of randomIds) {
    const uid = `user_${id.toString().padStart(4, '0')}`;
    console.log(`\n--- Auditing ${uid} ---`);
    
    // 1. Check User Profile & Audit Trail
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      console.error(`❌ CRITICAL: User ${uid} is MISSING!`);
      continue;
    }
    
    const userData = userSnap.data();
    const auditKeys = Object.keys(userData || {}).filter(k => k.startsWith('audit_'));
    console.log(`✅ Profile Exists. Audit Trail Length: ${auditKeys.length} entries.`);
    
    if (auditKeys.length < 24) console.warn(`⚠️  WARNING: Audit trail incomplete (Expected 24, got ${auditKeys.length})`);

    // 2. Check Predictions Count
    const predsSnap = await db.collection('users').doc(uid).collection('predictions').get();
    console.log(`✅ Predictions Found: ${predsSnap.size} / 24`);
    
    if (predsSnap.size === 24) {
      console.log(`🎉 ${uid} is HEALTHY.`);
    } else {
      console.error(`❌ ${uid} has missing data!`);
    }
  }
  console.log('\nAudit Complete.');
}

auditSwarm().catch(console.error);