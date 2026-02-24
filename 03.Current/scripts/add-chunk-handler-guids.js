// GUID: SCRIPT-CODEJSON-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] CodeJson
// [Intent] Scan chunk handler files and insert missing GUID comment blocks for any handler without a valid GUID header.
// [Usage] node scripts/add-chunk-handler-guids.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Add ChunkErrorHandler GUIDs to code.json
const fs = require('fs');
const path = require('path');

const codeJsonPath = path.join(__dirname, 'code.json');

// Read code.json
const rawData = fs.readFileSync(codeJsonPath, 'utf8');
const codeJson = JSON.parse(rawData);

const NEW_GUIDS = [
  {
    "guid": "COMPONENT_CHUNK_ERROR_HANDLER-000",
    "version": 1,
    "logic_category": "ERROR_HANDLING",
    "description": "Client-side chunk load error detector that auto-refreshes the page when Next.js fails to load a webpack chunk (typically due to stale build after deployment).",
    "dependencies": [],
    "location": {
      "filePath": "app/src/components/ChunkErrorHandler.tsx"
    },
    "callChain": {
      "calledBy": ["Root layout"],
      "calls": ["useToast", "window.location.reload"]
    }
  },
  {
    "guid": "COMPONENT_CHUNK_ERROR_HANDLER-001",
    "version": 1,
    "logic_category": "VALIDATION",
    "description": "Detects if an error is a webpack chunk loading failure by checking error message and error type.",
    "dependencies": [],
    "location": {
      "filePath": "app/src/components/ChunkErrorHandler.tsx"
    },
    "callChain": {
      "calledBy": ["ChunkErrorHandler error listener"],
      "calls": []
    }
  },
  {
    "guid": "COMPONENT_CHUNK_ERROR_HANDLER-002",
    "version": 1,
    "logic_category": "ORCHESTRATION",
    "description": "Main component that sets up global error listener on mount, detects chunk errors, shows user-friendly toast, and auto-refreshes after 1.5s delay.",
    "dependencies": ["useToast"],
    "location": {
      "filePath": "app/src/components/ChunkErrorHandler.tsx"
    },
    "callChain": {
      "calledBy": ["Root layout"],
      "calls": ["isChunkLoadError", "toast", "window.location.reload"]
    }
  }
];

// Add new GUIDs to the array
codeJson.guids.push(...NEW_GUIDS);
codeJson.total_guids = codeJson.guids.length;
codeJson.generated = new Date().toISOString().split('T')[0];

// Write back to code.json
fs.writeFileSync(codeJsonPath, JSON.stringify(codeJson, null, 2), 'utf8');

console.log(`✅ Added ${NEW_GUIDS.length} new GUIDs to code.json`);
console.log(`   Total GUIDs: ${codeJson.total_guids}`);
NEW_GUIDS.forEach(g => console.log(`   - ${g.guid} (v${g.version})`));
