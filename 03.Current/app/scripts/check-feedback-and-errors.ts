import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function checkFeedbackAndErrors() {
  console.log('========================================');
  console.log('FEEDBACK ITEMS');
  console.log('========================================\n');

  // Get all feedback
  const feedbackSnapshot = await db.collection('feedback')
    .orderBy('createdAt', 'desc')
    .get();

  if (feedbackSnapshot.empty) {
    console.log('No feedback found');
  } else {
    console.log(`Total feedback items: ${feedbackSnapshot.size}\n`);

    const statusCounts: Record<string, number> = {};

    feedbackSnapshot.docs.forEach((doc, i) => {
      const data = doc.data();
      const status = data.status || 'new';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      console.log(`[${i + 1}] ${data.type?.toUpperCase() || 'UNKNOWN'} - ${status}`);
      console.log(`    ID: ${doc.id}`);
      console.log(`    From: ${data.teamName} (${data.userEmail})`);
      console.log(`    Date: ${data.createdAt?.toDate?.()?.toISOString() || 'unknown'}`);
      console.log(`    Text: ${data.text?.substring(0, 200)}${data.text?.length > 200 ? '...' : ''}`);
      console.log('');
    });

    console.log('Status breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  }

  console.log('\n========================================');
  console.log('UNRESOLVED ERROR LOGS');
  console.log('========================================\n');

  // Get unresolved errors
  const errorsSnapshot = await db.collection('error_logs')
    .where('resolved', '!=', true)
    .orderBy('resolved')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  // Firestore workaround - also get errors without resolved field
  const errorsNoField = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  const unresolvedErrors = errorsNoField.docs.filter(d => !d.data().resolved);

  console.log(`Unresolved errors: ${unresolvedErrors.length}\n`);

  // Group by error type
  const errorGroups: Record<string, any[]> = {};
  unresolvedErrors.forEach(doc => {
    const data = doc.data();
    const errorKey = data.error?.substring(0, 60) || 'Unknown';
    if (!errorGroups[errorKey]) errorGroups[errorKey] = [];
    errorGroups[errorKey].push({ id: doc.id, ...data });
  });

  Object.entries(errorGroups).forEach(([errorType, errors], i) => {
    console.log(`[${i + 1}] "${errorType}..." (${errors.length}x)`);
    console.log(`    Routes: ${[...new Set(errors.map(e => e.context?.route))].filter(Boolean).join(', ') || 'N/A'}`);
    console.log(`    IDs: ${errors.slice(0, 3).map(e => e.id).join(', ')}${errors.length > 3 ? '...' : ''}`);
    console.log('');
  });
}

checkFeedbackAndErrors().catch(console.error);
