// GUID: SCRIPT-CODEJSON-003-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] CodeJson
// [Intent] Update GUID version suffixes across all source files after a batch consistency check identifies stale versions.
// [Usage] node scripts/update-consistency-guids.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Update ADMIN_CONSISTENCY GUIDs from v03 to v04
const fs = require('fs');
const path = require('path');

const codeJsonPath = path.join(__dirname, 'code.json');

// Read code.json
const rawData = fs.readFileSync(codeJsonPath, 'utf8');
const codeJson = JSON.parse(rawData);

const GUIDS_TO_UPDATE = [
  'ADMIN_CONSISTENCY-000',
  'ADMIN_CONSISTENCY-008',
  'ADMIN_CONSISTENCY-010'
];

let updated = 0;

codeJson.guids.forEach(entry => {
  if (GUIDS_TO_UPDATE.includes(entry.guid)) {
    if (entry.version === 3) {
      console.log(`✓ Updated ${entry.guid}: v${entry.version} → v4`);
      entry.version = 4;
      updated++;
    } else {
      console.log(`⚠️  ${entry.guid} is already at v${entry.version}`);
    }
  }
});

// Write back to code.json
fs.writeFileSync(codeJsonPath, JSON.stringify(codeJson, null, 2), 'utf8');

console.log(`\n✅ Updated ${updated} GUID versions in code.json`);
