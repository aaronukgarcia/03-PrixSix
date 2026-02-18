const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}

const db = admin.firestore();

async function checkBookOfWork() {
  try {
    console.log('Checking book_of_work collection...');
    const snapshot = await db.collection('book_of_work').limit(5).get();
    
    console.log(`\nFound ${snapshot.size} documents (showing first 5)`);
    console.log(`Empty collection: ${snapshot.empty}`);
    
    if (!snapshot.empty) {
      console.log('\nSample documents:');
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`- ${doc.id}: ${data.title || 'No title'} (status: ${data.status || 'unknown'})`);
        console.log(`  updatedAt: ${data.updatedAt ? data.updatedAt.toDate() : 'MISSING'}`);
      });
    }
    
    // Check total count
    const allDocs = await db.collection('book_of_work').count().get();
    console.log(`\nTotal documents in collection: ${allDocs.data().count}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
  
  process.exit(0);
}

checkBookOfWork();
