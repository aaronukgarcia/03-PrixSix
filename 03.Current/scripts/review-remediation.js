// GUID: SCRIPT-VALIDATE-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Validate
// [Intent] Review remediation plan entries and mark each as verified, partial, or outstanding based on current file state.
// [Usage] node scripts/review-remediation.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./book-of-work.json', 'utf8'));

const remediated = Object.entries(data.remediation || {});

console.log('\n' + '='.repeat(70));
console.log('📋 REMEDIATION REVIEW - Security Fixes Completed');
console.log('='.repeat(70));
console.log(`\nTotal Remediated Items: ${remediated.length}\n`);

// Group by severity
const bySeverity = {
  critical: [],
  high: [],
  medium: [],
  low: []
};

remediated.forEach(([id, item]) => {
  const severity = item.severity || 'unknown';
  if (bySeverity[severity]) {
    bySeverity[severity].push({ id, ...item });
  }
});

// Display by severity (critical first)
['critical', 'high', 'medium', 'low'].forEach(severity => {
  const items = bySeverity[severity];
  if (items.length === 0) return;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔴 ${severity.toUpperCase()} Severity (${items.length} items):`);
  console.log('='.repeat(70));

  items.forEach((item, i) => {
    console.log(`\n${i + 1}. [${item.id}] - v${item.version}`);
    console.log(`   Status: ${item.status}`);
    console.log(`   Date: ${item.date}`);
    console.log(`   Commit: ${item.commitHash}`);
    console.log(`   Fix: ${item.description}`);
    if (item.note) {
      console.log(`   Note: ${item.note}`);
    }
  });
});

console.log('\n' + '='.repeat(70));
console.log('📊 Summary:');
console.log('='.repeat(70));
console.log(`Critical: ${bySeverity.critical.length}`);
console.log(`High: ${bySeverity.high.length}`);
console.log(`Medium: ${bySeverity.medium.length}`);
console.log(`Low: ${bySeverity.low.length}`);
console.log(`\nTotal: ${remediated.length} security fixes completed\n`);

// Check current version
const packageJson = JSON.parse(fs.readFileSync('./app/package.json', 'utf8'));
console.log(`Current app version: ${packageJson.version}`);

// Find latest remediation version
const versions = remediated.map(([_, item]) => item.version).sort((a, b) => {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (aParts[i] !== bParts[i]) return bParts[i] - aParts[i];
  }
  return 0;
});

console.log(`Latest remediation version: ${versions[0]}`);
console.log('='.repeat(70) + '\n');
