// Quick test script to queue a WhatsApp message
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase
const serviceAccountPath = path.join(__dirname, 'service-account.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function queueMessage() {
  const docRef = await db.collection('whatsapp_queue').add({
    groupName: 'F1 chat',
    message: 'Test Msg - Thanks Wil - prix-six bot is active',
    status: 'PENDING',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    retryCount: 0,
  });

  console.log('Message queued with ID:', docRef.id);
  process.exit(0);
}

queueMessage().catch(console.error);
