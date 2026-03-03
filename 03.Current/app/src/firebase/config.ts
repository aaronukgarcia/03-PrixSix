// GUID: FIREBASE_CONFIG-000-v01
// [Intent] Exports the Firebase client configuration object assembled from NEXT_PUBLIC_ env vars.
// [Inbound Trigger] Imported by firebase/index.ts (client) and firebase/server.ts (server) at module init.
// [Downstream Impact] All Firebase SDK initialisation — auth, Firestore, storage, functions depend on this object.
export const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
};
