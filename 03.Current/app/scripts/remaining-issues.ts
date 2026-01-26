import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function remainingIssues() {
  console.log('========================================');
  console.log('REMAINING UNRESOLVED ERRORS');
  console.log('========================================\n');

  const errorsSnapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .get();

  const unresolvedErrors = errorsSnapshot.docs.filter(d => !d.data().resolved);

  console.log(`Unresolved errors: ${unresolvedErrors.length}\n`);

  // Group by error type
  const errorGroups: Record<string, any[]> = {};
  unresolvedErrors.forEach(doc => {
    const data = doc.data();
    const errorKey = data.error?.substring(0, 80) || 'Unknown';
    if (!errorGroups[errorKey]) errorGroups[errorKey] = [];
    errorGroups[errorKey].push({ id: doc.id, ...data });
  });

  Object.entries(errorGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([errorType, errors], i) => {
      console.log(`[${i + 1}] "${errorType}..." (${errors.length}x)`);
      console.log(`    Routes: ${[...new Set(errors.map(e => e.context?.route))].filter(Boolean).join(', ') || 'N/A'}`);
      console.log(`    Actions: ${[...new Set(errors.map(e => e.context?.action))].filter(Boolean).join(', ') || 'N/A'}`);
      console.log(`    IDs: ${errors.map(e => e.id).join(', ')}`);
      if (errors[0].context) {
        console.log(`    Context sample: ${JSON.stringify(errors[0].context).substring(0, 200)}`);
      }
      console.log('');
    });

  console.log('========================================');
  console.log('REMAINING UNRESOLVED FEEDBACK');
  console.log('========================================\n');

  const feedbackSnapshot = await db.collection('feedback')
    .orderBy('createdAt', 'desc')
    .get();

  const unresolvedFeedback = feedbackSnapshot.docs.filter(d => {
    const status = d.data().status || 'new';
    return status === 'new' || status === 'reviewed';
  });

  console.log(`Unresolved feedback items: ${unresolvedFeedback.length}\n`);

  // Categorize
  const bugs: any[] = [];
  const features: any[] = [];

  unresolvedFeedback.forEach(doc => {
    const data = doc.data();
    const item = {
      id: doc.id,
      type: data.type,
      text: data.text?.substring(0, 150),
      from: `${data.teamName} (${data.userEmail})`,
      date: data.createdAt?.toDate?.()?.toISOString()?.split('T')[0]
    };
    if (data.type === 'bug') bugs.push(item);
    else features.push(item);
  });

  console.log(`BUGS (${bugs.length}):\n`);
  bugs.forEach((b, i) => {
    console.log(`${i + 1}. [${b.id}] ${b.from} (${b.date})`);
    console.log(`   "${b.text}..."`);
    console.log('');
  });

  console.log(`\nFEATURE REQUESTS (${features.length}):\n`);
  features.forEach((f, i) => {
    console.log(`${i + 1}. [${f.id}] ${f.from} (${f.date})`);
    console.log(`   "${f.text}..."`);
    console.log('');
  });
}

remainingIssues().catch(console.error);
