// GUID: SCRIPT-BOW-006-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Find and print the next MEDIUM-priority book-of-work item ready for assignment.
// [Usage] node scripts/find-next-medium.js (run from project root)
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

// Check low priority first (all items, not just those with files)
const lowAll = data.criticalIssues.filter(i =>
  i.severity === 'Low' &&
  !completed.includes(i.auditId)
);

console.log(`\n📊 Low priority items: ${lowAll.length} total (${lowAll.filter(i => i.fileName && i.fileName.match(/\.(ts|tsx|js|jsx)$/)).length} with actionable files)\n`);

if (lowAll.length > 0 && lowAll.length <= 10) {
  console.log('All remaining low priority items:');
  lowAll.forEach((item, i) => {
    console.log(`${i+1}. [${item.auditId}] ${item.title}`);
    console.log(`   File: ${item.fileName || 'N/A'}`);
    console.log('');
  });
}

// Now check medium priority
const medium = data.criticalIssues.filter(i =>
  i.severity === 'Medium' &&
  i.fileName &&
  i.fileName.match(/\.(ts|tsx|js|jsx)$/)
);

console.log('='.repeat(70));
console.log(`\n📋 Medium priority items: ${medium.length} total (with actionable files)\n`);
console.log('Next 4 Medium Priority Items (bottom-up approach):\n');

medium.slice(0, 4).forEach((item, i) => {
  console.log(`${i+1}. [${item.severity}] ${item.auditId}`);
  console.log(`   ${item.title}`);
  console.log(`   File: ${item.fileName}`);
  console.log(`   Category: ${item.category}`);
  console.log('');
});
