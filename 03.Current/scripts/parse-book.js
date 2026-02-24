// GUID: SCRIPT-BOW-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Parse book-of-work.json and print a structured summary of all work items by wave and priority.
// [Usage] node scripts/parse-book.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const data = require('./book-of-work.json');

// Filter for actionable items (not just "File Not Found")
const actionable = data.filter(item => {
  return item.severity !== 'Informational' &&
         item.fileName &&
         item.fileName.match(/\.tsx?$/);
});

console.log(`Total actionable items: ${actionable.length}\n`);
console.log('='.repeat(60));

// Group by severity
const bySeverity = {
  Low: actionable.filter(i => i.severity === 'Low'),
  Medium: actionable.filter(i => i.severity === 'Medium'),
  High: actionable.filter(i => i.severity === 'High'),
  Critical: actionable.filter(i => i.severity === 'Critical')
};

console.log(`\nLow: ${bySeverity.Low.length}`);
console.log(`Medium: ${bySeverity.Medium.length}`);
console.log(`High: ${bySeverity.High.length}`);
console.log(`Critical: ${bySeverity.Critical.length}\n`);
console.log('='.repeat(60));

// Show first 10 actionable items (any severity)
console.log('\nNext 10 Actionable Items:\n');
actionable.slice(0, 10).forEach((item, i) => {
  console.log(`${i+1}. [${item.severity}] ${item.auditId}`);
  console.log(`   ${item.title}`);
  console.log(`   File: ${item.fileName}`);
  console.log('');
});
