// GUID: FIREBASE_CONFIG_WORKER-000-v04
// [v04] firebase-admin 14: legacy namespace API removed — migrated to modular entry points
//       (firebase-admin/app, /firestore, /storage). Behaviour unchanged.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore as adminGetFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage as adminGetStorage, Storage } from 'firebase-admin/storage';
import * as path from 'path';

// Initialize Firebase Admin
let initialized = false;

export function initializeFirebase(): void {
  if (initialized) return;

  // Option 1: Use service account file (local development)
  // Option 2: Use GOOGLE_APPLICATION_CREDENTIALS env var
  // Option 3: Use explicit credentials from env var

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Parse JSON from environment variable (for containerized deployment)
    // SECURITY: Validate service account JSON before use (WHATSAPP-004 fix)
    let serviceAccount: any;

    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (error: any) {
      // SECURITY: Don't expose the env var content in error message
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Check environment variable format.');
    }

    // Validate required fields exist
    const requiredFields = ['project_id', 'private_key', 'client_email'];
    const missingFields = requiredFields.filter(field => !serviceAccount[field]);

    if (missingFields.length > 0) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is missing required fields: ${missingFields.join(', ')}`);
    }

    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use default credentials
    initializeApp({
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    // Local development - use service account file
    // Use process.cwd() for reliable path resolution with ts-node
    const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
    console.log(`📁 Loading service account from: ${serviceAccountPath}`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
    });
  }

  initialized = true;
  console.log('✅ Firebase Admin initialized');
}

export const getFirestore = (): Firestore => adminGetFirestore();
export const getStorage = (): Storage => adminGetStorage();
