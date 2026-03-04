
// GUID: FIREBASE_SERVER-000-v01
// [Intent] Initialises the Firebase client SDK for server-side use (Next.js SSR/API routes). Singleton pattern prevents re-init across module reloads.
// [Inbound Trigger] Imported by API routes and server components that need server-side Firestore access.
// [Downstream Impact] Exports app and firestore instances used by any server-side Firestore reads.
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

let app: FirebaseApp;
let firestore: Firestore;

// Initialize Firebase for server-side usage
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

firestore = getFirestore(app);

export { app, firestore };
