// GUID: SCRIPT-ANALYZE-003-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Parse a browser HAR file and extract Firestore-related network requests for performance analysis.
// [Usage] node scripts/analyze-har.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');
const har = JSON.parse(fs.readFileSync('./perf-data/prixsix--studio-6033436327-281b1.europe-west4.hosted.app.har', 'utf8'));
const entries = har.log.entries;

console.log('='.repeat(70));
console.log('BREAKDOWN BY TYPE');
console.log('='.repeat(70));

const byType = {};
entries.forEach(e => {
  const url = e.request.url;
  const size = e.response.content.size || 0;
  let type = 'other';

  if (url.includes('_next/static/chunks')) type = 'Next.js Chunks';
  else if (url.includes('gtag') || url.includes('gtm') || url.includes('google-analytics') || url.includes('googletagmanager')) type = 'Google Analytics';
  else if (url.includes('firestore') || url.includes('googleapis.com/google.firestore')) type = 'Firestore';
  else if (url.includes('firebase') || url.includes('identitytoolkit')) type = 'Firebase Auth';
  else if (url.endsWith('.css') || url.includes('.css?')) type = 'CSS';
  else if (url.endsWith('.woff2') || url.endsWith('.woff') || url.includes('fonts')) type = 'Fonts';
  else if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.svg') || url.endsWith('.ico')) type = 'Images';
  else if (url.endsWith('.js') || url.includes('.js?')) type = 'Other JS';

  if (!byType[type]) byType[type] = { count: 0, size: 0 };
  byType[type].count++;
  byType[type].size += size;
});

Object.entries(byType)
  .sort((a, b) => b[1].size - a[1].size)
  .forEach(([type, data]) => {
    console.log(type.padEnd(20), '|', data.count.toString().padStart(3), 'reqs |', (data.size/1024).toFixed(1).padStart(8), 'KB');
  });

console.log('');
console.log('='.repeat(70));
console.log('NEXT.JS CHUNKS DETAIL (sorted by size)');
console.log('='.repeat(70));

entries
  .filter(e => e.request.url.includes('_next/static/chunks'))
  .sort((a, b) => (b.response.content.size || 0) - (a.response.content.size || 0))
  .forEach(e => {
    const url = e.request.url;
    const size = e.response.content.size || 0;
    const filename = url.split('/').pop().split('?')[0];
    console.log((size/1024).toFixed(1).padStart(8), 'KB |', filename);
  });

console.log('');
console.log('='.repeat(70));
console.log('FIRESTORE REQUESTS');
console.log('='.repeat(70));

const firestoreReqs = entries.filter(e =>
  e.request.url.includes('firestore') ||
  e.request.url.includes('googleapis.com/google.firestore')
);
console.log('Total Firestore requests:', firestoreReqs.length);
console.log('Total Firestore data:', (firestoreReqs.reduce((sum, e) => sum + (e.response.content.size || 0), 0) / 1024).toFixed(1), 'KB');
