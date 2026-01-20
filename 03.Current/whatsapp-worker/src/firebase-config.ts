import * as admin from 'firebase-admin';
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
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Use default credentials
    admin.initializeApp({
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    // Local development - use service account file
    const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
    });
  }

  initialized = true;
  console.log('✅ Firebase Admin initialized');
}

export const getFirestore = () => admin.firestore();
export const getStorage = () => admin.storage();
