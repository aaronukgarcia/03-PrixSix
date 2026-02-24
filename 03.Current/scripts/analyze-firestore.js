// GUID: SCRIPT-ANALYZE-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Parse a HAR capture of Firestore API calls to map collection read/write patterns and detect unbounded queries.
// [Usage] node scripts/analyze-firestore.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');
const har = JSON.parse(fs.readFileSync('./perf-data/prixsix--studio-6033436327-281b1.europe-west4.hosted.app.har', 'utf8'));

const firestoreReqs = har.log.entries.filter(e =>
  e.request.url.includes('firestore') ||
  e.request.url.includes('google.firestore')
);

console.log('='.repeat(70));
console.log('FIRESTORE COLLECTIONS BEING QUERIED');
console.log('='.repeat(70));

const collections = {};

firestoreReqs.forEach((e, i) => {
  const size = e.response.content.size || 0;
  let foundCollections = [];

  // Check POST data
  if (e.request.postData && e.request.postData.text) {
    const text = e.request.postData.text;

    // Look for structuredQuery with from.collectionId
    const collectionMatches = text.match(/"collectionId"\s*:\s*"([^"]+)"/g);
    if (collectionMatches) {
      collectionMatches.forEach(m => {
        const name = m.match(/"collectionId"\s*:\s*"([^"]+)"/)[1];
        foundCollections.push(name);
      });
    }

    // Look for documents/collectionName pattern
    const docMatches = text.match(/documents\/([a-zA-Z_-]+)/g);
    if (docMatches) {
      docMatches.forEach(m => {
        const name = m.replace('documents/', '');
        if (!['v1', 'projects', 'databases'].includes(name)) {
          foundCollections.push(name);
        }
      });
    }
  }

  // Check response for collection hints
  if (e.response.content.text) {
    const respText = e.response.content.text;
    const respMatches = respText.match(/documents\/([a-zA-Z_-]+)\//g);
    if (respMatches) {
      respMatches.forEach(m => {
        const name = m.replace('documents/', '').replace('/', '');
        if (!['v1', 'projects', 'databases'].includes(name) && name.length > 2) {
          foundCollections.push(name);
        }
      });
    }
  }

  // Dedupe and add to totals
  [...new Set(foundCollections)].forEach(col => {
    if (!collections[col]) collections[col] = { count: 0, size: 0 };
    collections[col].count++;
    collections[col].size += size;
  });
});

console.log('');
console.log('Collection'.padEnd(30), '| Requests | Size');
console.log('-'.repeat(70));

Object.entries(collections)
  .sort((a, b) => b[1].size - a[1].size)
  .forEach(([col, data]) => {
    console.log(
      col.padEnd(30), '|',
      data.count.toString().padStart(5), '   |',
      (data.size/1024).toFixed(1).padStart(8), 'KB'
    );
  });

console.log('');
console.log('='.repeat(70));
console.log('LARGE RESPONSE SAMPLES');
console.log('='.repeat(70));

// Show sample of large responses
firestoreReqs
  .filter(e => (e.response.content.size || 0) > 100000)
  .slice(0, 5)
  .forEach((e, i) => {
    const size = e.response.content.size || 0;
    console.log('');
    console.log('Large response #' + (i+1) + ': ' + (size/1024).toFixed(1) + ' KB');

    if (e.response.content.text) {
      // Try to find what data is in there
      const text = e.response.content.text.substring(0, 2000);
      const docPaths = text.match(/documents\/[^"]+/g);
      if (docPaths) {
        const uniquePaths = [...new Set(docPaths.map(p => {
          const parts = p.split('/');
          return parts.slice(0, 4).join('/');
        }))];
        console.log('  Document paths:', uniquePaths.slice(0, 5).join(', '));
      }
    }
  });
