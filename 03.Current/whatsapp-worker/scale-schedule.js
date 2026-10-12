#!/usr/bin/env node
// GUID: WORKER_SCALE_SCHEDULE-000-v01
// [Intent] COST-CONTAINER-001 (Aaron, 2026-10-12): the WhatsApp worker container must run ONLY
//          around race weekends — from 00:00 UTC three days before race day until 00:00 UTC two
//          days after it (covers the Monday results post) — and sit at ZERO replicas otherwise.
//          Azure Container Apps does this natively with KEDA "cron" scale rules: one rule per race,
//          desiredReplicas 1 inside its window; with minReplicas 0 and NO http rule the app is off
//          between windows (£28/month always-on → a few pounds).
//          GGR30: the windows are DERIVED from the race calendar in app/src/lib/data.ts, never typed
//          by hand. Cron has no year field, so the rules are re-generated whenever the calendar
//          changes and at the start of every season (deploy-container-app.ps1 runs this each deploy).
// [Inbound Trigger] node scale-schedule.js [--json | --patch] [--days-before 3] [--days-after 2]
//                   --json  : print the rules array
//                   --patch : print the full ARM merge-patch body for the container app
//                   default : human-readable table
// [Downstream Impact] Output is applied with `az rest --method patch` by deploy-container-app.ps1.
//                     Between windows every call to the worker (health probe, wake, process-queue)
//                     fails fast — that is by design; QUEUE_PROCESSOR-000-v06 expires stale backlog.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const DAYS_BEFORE = Number(flag('--days-before', 3));
const DAYS_AFTER = Number(flag('--days-after', 2));
if (!Number.isInteger(DAYS_BEFORE) || !Number.isInteger(DAYS_AFTER) || DAYS_BEFORE < 0 || DAYS_AFTER < 1) {
  console.error('scale-schedule: --days-before must be an integer >= 0 and --days-after an integer >= 1');
  process.exit(2);
}

const DATA_TS = path.resolve(__dirname, '..', 'app', 'src', 'lib', 'data.ts');
let src;
try {
  src = fs.readFileSync(DATA_TS, 'utf8');
} catch (err) {
  console.error(`scale-schedule: cannot read race calendar ${DATA_TS}: ${err.message}`);
  process.exit(2);
}

// One race per line in data.ts: { name: "Austin ...", ..., raceTime: "2026-10-25T20:00:00Z", ... }
const RACE_RE = /name:\s*"([^"]+)"[^\n]*?raceTime:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)"/g;
const races = [];
let m;
while ((m = RACE_RE.exec(src)) !== null) {
  const raceTime = new Date(m[2]);
  if (Number.isNaN(raceTime.getTime())) {
    console.error(`scale-schedule: unparseable raceTime "${m[2]}" for ${m[1]}`);
    process.exit(2);
  }
  races.push({ name: m[1], raceTime });
}
if (races.length === 0) {
  console.error('scale-schedule: no races found in data.ts — regex drift? Refusing to emit an empty schedule.');
  process.exit(2);
}

const DAY_MS = 86400000;
const utcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const cronAt = (d) => `0 0 ${d.getUTCDate()} ${d.getUTCMonth() + 1} *`; // minute hour dom month dow
const slug = (name) =>
  'race-' + name.toLowerCase().replace(/grand prix/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const now = Date.now();
const windows = races
  .map((r) => {
    const raceDay = utcMidnight(r.raceTime);
    const start = new Date(raceDay.getTime() - DAYS_BEFORE * DAY_MS);
    const end = new Date(raceDay.getTime() + DAYS_AFTER * DAY_MS);
    return { ...r, start, end };
  })
  // Only windows that have not finished yet. A past window's cron would otherwise fire again next
  // year on the wrong dates, so the schedule must be regenerated when the new calendar lands.
  .filter((w) => w.end.getTime() > now)
  .sort((a, b) => a.start - b.start);

if (windows.length === 0) {
  console.error('scale-schedule: every race window in data.ts is in the past — update the calendar first.');
  process.exit(2);
}
if (windows.length > 10) {
  // Container Apps allows at most 10 scale rules per revision.
  console.error(`scale-schedule: ${windows.length} windows but Container Apps allows 10 rules — narrow the calendar.`);
  process.exit(2);
}

const rules = windows.map((w) => ({
  name: slug(w.name),
  custom: {
    type: 'cron',
    metadata: {
      timezone: 'Etc/UTC',
      start: cronAt(w.start),
      end: cronAt(w.end),
      desiredReplicas: '1',
    },
  },
}));

const names = new Set(rules.map((r) => r.name));
if (names.size !== rules.length) {
  console.error('scale-schedule: duplicate rule names — two races slug to the same name.');
  process.exit(2);
}

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(rules, null, 2) + '\n');
} else if (args.includes('--patch')) {
  const body = { properties: { template: { scale: { minReplicas: 0, maxReplicas: 1, rules } } } };
  process.stdout.write(JSON.stringify(body) + '\n');
} else {
  const fmt = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  console.log(`Worker race windows (${DAYS_BEFORE}d before → ${DAYS_AFTER}d after race day, UTC), from ${DATA_TS}`);
  for (const w of windows) {
    const live = now >= w.start.getTime() && now < w.end.getTime() ? '  ← LIVE NOW' : '';
    console.log(`  ${slug(w.name).padEnd(24)} ${fmt(w.start)} → ${fmt(w.end)}   race ${fmt(w.raceTime)}${live}`);
  }
  const inWindow = windows.some((w) => now >= w.start.getTime() && now < w.end.getTime());
  console.log(`Right now the worker should be: ${inWindow ? 'RUNNING (1 replica)' : 'OFF (0 replicas)'}`);
}
