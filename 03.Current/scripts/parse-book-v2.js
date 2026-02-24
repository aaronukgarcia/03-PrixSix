// GUID: SCRIPT-BOW-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Updated version of parse-book.js — supports nested wave structure and outputs markdown-formatted BOW summary.
// [Usage] node scripts/parse-book-v2.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');

// Read the file as raw text first to handle potential JSON issues
const rawData = fs.readFileSync('./book-of-work.json', 'utf8');

let data;
try {
  // Try to parse as JSON
  data = JSON.parse(rawData);
} catch (e) {
  console.log('❌ JSON parse error:', e.message);
  console.log('\nFirst 500 chars of file:');
  console.log(rawData.substring(0, 500));
  process.exit(1);
}

console.log(`✅ Parsed ${data.length} items from book-of-work.json\n`);
console.log('='.repeat(70));

// Already completed audit IDs from this session
const completed = [
  'GEMINI-AUDIT-055', // Admin email
  'GEMINI-AUDIT-051', // Driver imageId
  'GEMINI-AUDIT-040', // Dismissal pattern
  'GEMINI-AUDIT-052'  // Race schedule
];

// Filter actionable items (exclude "File Not Found" informational items and already completed)
const actionable = data.filter(item => {
  // Skip informational "file not found" items
  if (item.title && item.title.includes('File Not Found')) return false;
  if (item.title && item.title.includes('Undocumented')) return false;

  // Skip already completed
  if (item.auditId && completed.includes(item.auditId)) return false;

  // Must have actual file to fix
  if (!item.fileName || !item.fileName.match(/\.(ts|tsx|js|jsx)$/)) return false;

  return true;
});

console.log(`\nActionable items: ${actionable.length}`);
console.log(`Already completed: ${completed.length}\n`);
console.log('='.repeat(70));

// Group by severity
const bySeverity = {
  Low: actionable.filter(i => i.severity === 'Low'),
  Medium: actionable.filter(i => i.severity === 'Medium'),
  High: actionable.filter(i => i.severity === 'High'),
  Critical: actionable.filter(i => i.severity === 'Critical')
};

console.log('\nBy Severity:');
console.log(`  Low: ${bySeverity.Low.length}`);
console.log(`  Medium: ${bySeverity.Medium.length}`);
console.log(`  High: ${bySeverity.High.length}`);
console.log(`  Critical: ${bySeverity.Critical.length}\n`);
console.log('='.repeat(70));

// Show next 10 items (prioritize by severity: Low → Medium → High → Critical)
console.log('\n📋 Next 10 Actionable Items (Low → Medium → High → Critical):\n');

const prioritized = [
  ...bySeverity.Low,
  ...bySeverity.Medium,
  ...bySeverity.High,
  ...bySeverity.Critical
];

prioritized.slice(0, 10).forEach((item, i) => {
  console.log(`${i+1}. [${item.severity}] ${item.auditId}`);
  console.log(`   ${item.title}`);
  console.log(`   File: ${item.fileName}`);
  console.log('');
});
