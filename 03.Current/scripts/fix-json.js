// GUID: SCRIPT-CODEJSON-005-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] CodeJson
// [Intent] Attempt to parse and repair malformed JSON in code.json — used after partial writes leave invalid syntax.
// [Usage] node scripts/fix-json.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');

// Read the corrupted file
let data = fs.readFileSync('book-of-work.json', 'utf8');
console.log('Original length:', data.length);

// Fix literal \n sequences -> actual newlines
data = data.replace(/\\n/g, '\n');

// Fix escaped quotes
data = data.replace(/\\"/g, '"');

// Fix double-escaped backslashes
data = data.replace(/\\\\/g, '\\');

console.log('Fixed length:', data.length);

// Validate
try {
  const json = JSON.parse(data);
  console.log('✅ VALID JSON - Array length:', json.length);
  console.log('First entry:', json[0].auditId);

  // Write fixed version
  fs.writeFileSync('book-of-work.json', data);
  console.log('✅ Saved fixed version to book-of-work.json');
} catch(e) {
  console.log('❌ Still invalid:', e.message);
  console.log('First 500 chars:', data.substring(0, 500));
}
