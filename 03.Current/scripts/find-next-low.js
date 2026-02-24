// GUID: SCRIPT-BOW-005-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Find and print the next LOW-priority book-of-work item ready for assignment.
// [Usage] node scripts/find-next-low.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./book-of-work.json', 'utf8'));

const completed = [
  'GEMINI-AUDIT-055', // Admin email
  'GEMINI-AUDIT-051', // Driver imageId
  'GEMINI-AUDIT-040', // Dismissal pattern
  'GEMINI-AUDIT-052'  // Race schedule
];

// Check ALL low items first
const lowAll = data.criticalIssues.filter(i =>
  i.severity === 'Low' &&
  !completed.includes(i.auditId || i.issueId)
);

console.log(`\n📊 All remaining low priority items: ${lowAll.length}\n`);
console.log('='.repeat(70));

lowAll.forEach((item, i) => {
  console.log(`${i+1}. [${item.auditId || item.issueId}] ${item.title}`);
  console.log(`   File: ${item.fileName || 'N/A'}`);
  console.log(`   Category: ${item.category || 'N/A'}`);
  console.log('');
});

// Now filter for actionable (with files)
const lowActionable = lowAll.filter(i =>
  i.fileName &&
  i.fileName.match(/\.(ts|tsx|js|jsx)$/)
);

console.log('='.repeat(70));
console.log(`\n📋 Actionable low priority items (with code files): ${lowActionable.length}\n`);

if (lowActionable.length > 0) {
  console.log('Next 4 actionable items:\n');
  lowActionable.slice(0, 4).forEach((item, i) => {
    console.log(`${i+1}. [${item.severity}] ${item.auditId || item.issueId}`);
    console.log(`   ${item.title}`);
    console.log(`   File: ${item.fileName}`);
    console.log(`   Category: ${item.category || 'N/A'}`);
    console.log('');
  });
} else {
  console.log('✅ All low-priority actionable items completed!\n');
  console.log('Moving to Medium priority...\n');

  const medium = data.criticalIssues.filter(i =>
    i.severity === 'Medium' &&
    i.fileName &&
    i.fileName.match(/\.(ts|tsx|js|jsx)$/)
  );

  console.log(`📋 Medium priority actionable items: ${medium.length}\n`);
  console.log('Next 4 medium priority items:\n');

  medium.slice(0, 4).forEach((item, i) => {
    console.log(`${i+1}. [${item.severity}] ${item.auditId || item.issueId}`);
    console.log(`   ${item.title}`);
    console.log(`   File: ${item.fileName}`);
    console.log(`   Category: ${item.category || 'N/A'}`);
    console.log('');
  });
}
