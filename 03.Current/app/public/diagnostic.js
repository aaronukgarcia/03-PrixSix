// Book of Work Diagnostic Script
// Run this in the browser console to check authentication and Firestore access

async function diagnoseBookOfWork() {
  console.log('=== Book of Work Diagnostic ===\n');
  
  try {
    // Check 1: Firebase Auth
    const auth = window.firebase?.auth?.();
    if (!auth) {
      console.error('❌ Firebase Auth not initialized');
      return;
    }
    
    const user = auth.currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      console.log('👉 Please log in and try again');
      return;
    }
    
    console.log('✅ User logged in:', user.email);
    console.log('   UID:', user.uid);
    
    // Check 2: Firestore instance
    const firestore = window.firebase?.firestore?.();
    if (!firestore) {
      console.error('❌ Firestore not initialized');
      return;
    }
    
    console.log('✅ Firestore initialized');
    
    // Check 3: User document and admin status
    console.log('\nChecking admin status...');
    const userDoc = await firestore.collection('users').doc(user.uid).get();
    
    if (!userDoc.exists) {
      console.error('❌ User document not found in Firestore');
      return;
    }
    
    const userData = userDoc.data();
    const isAdmin = userData?.isAdmin === true;
    
    if (!isAdmin) {
      console.error('❌ User is NOT an admin');
      console.log('   isAdmin:', userData?.isAdmin);
      console.log('👉 You need admin privileges to access Book of Work');
      return;
    }
    
    console.log('✅ User is an admin');
    
    // Check 4: Try to query book_of_work
    console.log('\nAttempting to query book_of_work collection...');
    const snapshot = await firestore
      .collection('book_of_work')
      .orderBy('updatedAt', 'desc')
      .limit(5)
      .get();
    
    console.log(`✅ Query successful! Found ${snapshot.size} documents`);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`   - ${data.title || 'Untitled'}`);
    });
    
    console.log('\n=== All checks passed! Book of Work should work. ===');
    console.log('If it\'s still not loading, try refreshing the page.');
    
  } catch (error) {
    console.error('❌ Error during diagnostic:', error.message);
    console.error('Full error:', error);
    
    if (error.code === 'permission-denied') {
      console.log('\n👉 Permission denied - you may not have admin access');
    } else if (error.code === 'failed-precondition') {
      console.log('\n👉 Missing Firestore index - check Firebase console');
    }
  }
}

diagnoseBookOfWork();
