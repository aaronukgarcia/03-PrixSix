#!/usr/bin/env tsx
/**
 * Add PERF-001 Firebase Performance / Tailwind CSS class noise issue to book_of_work
 * Source: error_logs PX-9002 entries observed 2026-02-20 → 2026-02-23
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(process.cwd(), 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
const now = admin.firestore.FieldValue.serverTimestamp();

async function run() {
  await db.collection('book_of_work').doc('PERF-001').set({
    title: 'Firebase Performance SDK Logs Tailwind CSS Class Strings as Invalid Attribute Values',
    description: 'Firebase Performance SDK\'s auto-instrumentation (createOobTrace / addWebVitalMetric) captures the nearest button element\'s full className string when recording Web Vitals (LCP, FID, CLS). It then calls putAttribute() with the Tailwind CSS class string as the attribute value. Tailwind classes contain characters forbidden by Firebase Performance ([ ] & > : / .) causing a FirebaseError on every page load for every user. These are being logged as PX-9002 and flooding the error panel with noise, hiding real errors.',
    technicalDetails: `**Error pattern:** PX-9002
**Routes affected:** /admin, /predictions, /about/dev (and likely all pages with shadcn/ui buttons)
**Frequency:** Every page load per user — actively growing

**Stack trace (all occurrences identical):**
  putAttribute @ 5217-c7346ee0c6704d1c.js:1:32436
  addWebVitalMetric @ ...js:1:33945
  createOobTrace @ ...js:1:33771

**Root cause:** Firebase Performance SDK automatically instruments elements for Web Vitals. When it finds the LCP element (typically a button), it passes element.className to putAttribute(). Tailwind classes like:
  [&_svg]:pointer-events-none.[&>span]:line-clamp-1.[&_svg]:size-4
contain characters [ ] & > : / . which are all invalid Firebase Performance attribute values (max 100 chars, alphanumeric + underscore + hyphen only).

**Fix options (pick one):**

Option A — Filter at global error handler (quickest, stops logging noise immediately):
  In the global window.onerror / error boundary, check if the message contains
  "performance/invalid attribute value" and skip logging to error_logs.
  Downside: errors still occur in browser console, just not logged.

Option B — Sanitize in Firebase Performance wrapper (recommended):
  Find where Firebase Performance is initialised and wrap addWebVitalMetric /
  createOobTrace to sanitize the className before putAttribute() is called.
  Replace invalid chars with '_' and truncate to 100 chars.

Option C — Disable Firebase Performance web vitals auto-instrumentation:
  import { getPerformance } from 'firebase/performance';
  const perf = getPerformance(app);
  perf.instrumentationEnabled = false; // disables auto Web Vitals capture
  Keep dataCollectionEnabled = true to retain manual traces.
  Downside: loses automatic Web Vitals data (LCP, FID, CLS) in Firebase console.

Option D — Add data-disable-touchstart-prevent attribute to buttons (per Firebase docs):
  Prevents Firebase Performance from auto-instrumenting specific elements.
  Impractical for shadcn/ui components which generate dozens of buttons.

**Recommendation:** Option A immediately (1-line fix to suppress logging),
then Option C to stop the errors occurring at all.`,
    notes: `Created: 2026-02-23 by Bill (Claude Code)
Source: 5 PX-9002 error_logs entries deleted 2026-02-23 (IDs: CXz3GEhuVpZo2meedcIv, ZYylfrS9CY5NEDTvZ7YA, bPHTSCKo0vPHI59qIcB8, jdTmrVsvPGlD87q0A1wM, yzxOXVrndRhglWQmmm0S)
Date range of deleted errors: 2026-02-20 → 2026-02-23
All errors were identical root cause — Firebase SDK bug with Tailwind CSS classes.
Will recur on every page load until fixed.`,
    category: 'infrastructure',
    severity: 'medium',
    status: 'tbd',
    priority: 2,
    source: 'error-log-cleanup-2026-02-23',
    package: 'infrastructure',
    sourceData: {
      errorCode: 'PX-9002',
      deletedErrorCount: 5,
      deletedErrorIds: [
        'CXz3GEhuVpZo2meedcIv',
        'ZYylfrS9CY5NEDTvZ7YA',
        'bPHTSCKo0vPHI59qIcB8',
        'jdTmrVsvPGlD87q0A1wM',
        'yzxOXVrndRhglWQmmm0S',
      ],
      firstSeen: '2026-02-20',
      lastSeen: '2026-02-23',
      routesAffected: ['/admin', '/predictions', '/about/dev'],
    },
    versionReported: '1.58.58',
    module: 'Firebase Performance',
    file: 'app/src/firebase.ts (or wherever Firebase Performance is initialised)',
    guid: 'N/A - Firebase SDK internals',
    referenceId: 'PERF-001',
    createdBy: 'Bill (Claude Code)',
    createdAt: now,
    updatedAt: now,
  });

  console.log('✅ PERF-001 added to book_of_work');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
