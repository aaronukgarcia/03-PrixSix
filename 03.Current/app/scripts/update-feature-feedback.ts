import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function updateFeatureFeedback() {
  console.log('========================================');
  console.log('UPDATING FEATURE REQUEST STATUS');
  console.log('========================================\n');

  // Features that ARE implemented - mark as resolved
  const implementedFeatures = [
    {
      id: 'H04orm9IqOuXrY7WXd69',
      note: 'IMPLEMENTED: Prediction fallback logic exists in /api/calculate-scores/route.ts (lines 127-226). Creates carry-forward predictions automatically for teams without current predictions.'
    },
    {
      id: '695vCzSAo5FluZaqgiad',
      note: 'IMPLEMENTED: Secondary email feature exists in profile page (lines 631-702) with full verification support. Add a secondary email to receive communications at both addresses.'
    },
    {
      id: 'SedTq56EtyHhUo3sdD4O',
      note: 'IMPLEMENTED: Mobile responsive design uses Tailwind CSS responsive classes throughout (sm:, md:, lg:, xl: breakpoints). App is fully mobile responsive.'
    }
  ];

  console.log('Marking implemented features as RESOLVED...');
  for (const feat of implementedFeatures) {
    try {
      await db.collection('feedback').doc(feat.id).update({
        status: 'resolved',
        resolutionNote: feat.note,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'claude-code'
      });
      console.log(`  ✓ ${feat.id}: Already implemented`);
    } catch (err) {
      console.log(`  ✗ ${feat.id}: ${err}`);
    }
  }

  // Features that are NOT implemented or PARTIAL - mark as reviewed
  const notImplementedFeatures = [
    {
      id: 'sPSq1EIBPdkFauic6kBC',
      note: 'NOT IMPLEMENTED: Drivers are currently sorted by team, not alphabetically. Feature request noted for future development.'
    },
    {
      id: 'cCM6mEpDW66itRcP3tbb',
      note: 'PARTIAL: Currently only URL-based photo selection and preset avatars available. Direct file upload not implemented. Feature request noted.'
    },
    {
      id: 'vAUF0ES6JwitoiLExkuP',
      note: 'NOT IMPLEMENTED: Leagues currently have basic structure (name, members, owner). Custom scoring rules, jokers, and league customizations not yet implemented. Feature request noted for future development.'
    }
  ];

  console.log('\nMarking non-implemented features as REVIEWED...');
  for (const feat of notImplementedFeatures) {
    try {
      await db.collection('feedback').doc(feat.id).update({
        status: 'reviewed',
        reviewNote: feat.note,
        reviewedAt: new Date().toISOString()
      });
      console.log(`  ✓ ${feat.id}: Marked as reviewed`);
    } catch (err) {
      console.log(`  ✗ ${feat.id}: ${err}`);
    }
  }

  // Also resolve related bug reports about predictions not carrying over
  const relatedBugs = [
    {
      id: 'FwkyHSfJ71aqsdtVwcO9',
      note: 'IMPLEMENTED: Prediction fallback logic exists. If user has no predictions for current race, the system carries forward their last prediction automatically. Check if user had predictions submitted for Race 1.'
    },
    {
      id: 'HD8ei1XEJBUsbcAQ0i1V',
      note: 'IMPLEMENTED: Prediction carry-over is automatic when results are calculated, not displayed in admin panel. The fallback happens during score calculation, not in the predictions display.'
    }
  ];

  console.log('\nResolving related bugs about prediction carry-over...');
  for (const bug of relatedBugs) {
    try {
      await db.collection('feedback').doc(bug.id).update({
        status: 'resolved',
        resolutionNote: bug.note,
        resolvedAt: new Date().toISOString(),
        resolvedBy: 'claude-code'
      });
      console.log(`  ✓ ${bug.id}: Feature already implemented`);
    } catch (err) {
      console.log(`  ✗ ${bug.id}: ${err}`);
    }
  }

  console.log('\n✅ Feature feedback updated!');
}

updateFeatureFeedback().catch(console.error);
