/**
 * claude-sync.js - Coordination script for multiple Claude Code sessions
 *
 * Commands:
 *   checkin                 - Register session and get assigned Bill, Bob, or Ben
 *   checkout                - End your own session
 *   checkout <Name>         - Force-end a specific session by name (e.g. checkout Bob)
 *   checkout --force        - Force-end all sessions on current branch
 *   read                    - Display current coordination state
 *   write "message"         - Log activity
 *   claim /path/            - Claim file ownership
 *   release /path/          - Release file ownership
 *   register "description"  - Register current branch
 *   ping                    - Send keepalive heartbeat + watchdog report
 *   watchdog                - Standalone sleep detection report (no ping)
 *   init                    - Initialise fresh state
 *   gc                      - Garbage collect stale sessions (auto-runs on checkin)
 *
 * Uses Firestore document at: coordination/claude-state
 *
 * IDENTITY RULES (INVIOLABLE):
 *   - Names are assigned in strict order: Bill (1st), Bob (2nd), Ben (3rd)
 *   - Maximum 3 concurrent sessions. No Guest-X names. Ever.
 *   - No duplicate names. If a collision is detected, the youngest session is evicted.
 *   - Dropped sessions do NOT reclaim their old name — they take the next available slot.
 *   - Every response MUST be prefixed with name> (e.g. bill>)
 *
 * STALE SESSION POLICY:
 *   Sessions inactive for 2+ hours are marked stale and auto-cleaned on next checkin.
 */

const admin = require('firebase-admin');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const PROJECT_ID = 'studio-6033436327-281b1';
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(__dirname, 'service-account.json');
const DOCUMENT_PATH = 'coordination/claude-state';
const PINGS_COLLECTION = 'session_pings';
const STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours - sessions inactive longer are stale
const SLEEP_THRESHOLD_MS = 5 * 60 * 1000;    // 5 minutes - peer considered sleeping
const DEEP_SLEEP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes - peer considered deeply sleeping
const SESSION_FILE = path.join(__dirname, '.claude-session-id'); // Persistent session ID storage

/**
 * Load session ID from local file (for same-process re-checkins)
 */
function loadSessionId() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, 'utf8').trim();
    }
  } catch (error) {
    // Ignore read errors
  }
  return null;
}

/**
 * Save session ID to local file (for same-process re-checkins)
 */
function saveSessionId(sessionId) {
  try {
    fs.writeFileSync(SESSION_FILE, sessionId, 'utf8');
  } catch (error) {
    // Ignore write errors (non-critical)
  }
}

/**
 * Delete session ID file (on checkout)
 */
function deleteSessionId() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (error) {
    // Ignore delete errors
  }
}

// Initialise Firebase Admin
let db;
try {
  admin.initializeApp({
    credential: admin.credential.cert(SERVICE_ACCOUNT_PATH),
    projectId: PROJECT_ID
  });
  db = admin.firestore();
} catch (error) {
  console.error('Failed to initialise Firebase Admin:', error.message);
  console.error('Ensure service-account.json exists or GOOGLE_APPLICATION_CREDENTIALS is set.');
  process.exit(1);
}

/**
 * Get current git branch name
 */
function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get the coordination document reference
 */
function getDocRef() {
  return db.doc(DOCUMENT_PATH);
}

/**
 * Get current state or empty default
 */
async function getState() {
  const doc = await getDocRef().get();
  if (!doc.exists) {
    return {
      sessions: {},
      claimedFiles: {},
      branches: {},
      activityLog: []
    };
  }
  return doc.data();
}

/**
 * Save state to Firestore
 */
async function saveState(state) {
  await getDocRef().set(state);
}

/**
 * Format timestamp for display
 */
function formatTime(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

/**
 * Valid session names in strict assignment order.
 * Bill is ALWAYS first. Bob is second. Ben is third. No exceptions.
 */
const VALID_NAMES = ['Bill', 'Bob', 'Ben'];

/**
 * Assign a name to a new session.
 * Returns the first available name from [Bill, Bob, Ben], or null if all 3 are occupied.
 * Excludes the caller's own sessionId from the "taken" set so re-checkins work.
 */
function assignName(sessions, mySessionId) {
  const takenNames = new Set(
    Object.entries(sessions || {})
      .filter(([id, s]) => s.status === 'active' && id !== mySessionId)
      .map(([id, s]) => s.name)
  );

  for (const name of VALID_NAMES) {
    if (!takenNames.has(name)) return name;
  }

  // All 3 slots occupied — caller must wait
  return null;
}

/**
 * Garbage collect stale sessions
 * Sessions inactive for STALE_TIMEOUT_MS are marked as stale and cleaned up
 * Returns: { cleaned: number, details: string[] }
 */
function garbageCollectSessions(state) {
  const now = Date.now();
  const cleaned = [];
  const releasedFiles = [];

  state.sessions = state.sessions || {};
  state.claimedFiles = state.claimedFiles || {};

  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if (session.status !== 'active') continue;

    const lastActivity = new Date(session.lastActivity || session.startedAt).getTime();
    const inactiveMs = now - lastActivity;

    if (inactiveMs > STALE_TIMEOUT_MS) {
      const inactiveHours = Math.round(inactiveMs / (60 * 60 * 1000) * 10) / 10;
      cleaned.push(`${session.name} (inactive ${inactiveHours}h)`);

      // Mark as stale
      state.sessions[sessionId].status = 'stale';
      state.sessions[sessionId].markedStaleAt = new Date().toISOString();

      // Release any files claimed by this session
      for (const [filePath, claim] of Object.entries(state.claimedFiles)) {
        if (claim.sessionId === sessionId || claim.name === session.name) {
          releasedFiles.push(filePath);
          delete state.claimedFiles[filePath];
        }
      }
    }
  }

  // Log cleanup if anything was cleaned
  if (cleaned.length > 0) {
    state.activityLog = state.activityLog || [];
    state.activityLog.push({
      sessionId: 'system',
      name: 'GC',
      branch: 'system',
      message: `Garbage collected ${cleaned.length} stale session(s): ${cleaned.join(', ')}`,
      timestamp: new Date().toISOString()
    });
  }

  return { cleaned: cleaned.length, details: cleaned, releasedFiles };
}

/**
 * COMMAND: gc - Garbage collect stale sessions
 */
async function cmdGc() {
  const state = await getState();
  const result = garbageCollectSessions(state);

  if (result.cleaned > 0) {
    await saveState(state);
    console.log('');
    console.log('='.repeat(60));
    console.log('GARBAGE COLLECTION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Cleaned ${result.cleaned} stale session(s):`);
    for (const detail of result.details) {
      console.log(`  - ${detail}`);
    }
    if (result.releasedFiles.length > 0) {
      console.log(`Released ${result.releasedFiles.length} file(s):`);
      for (const file of result.releasedFiles) {
        console.log(`  - ${file}`);
      }
    }
    console.log('='.repeat(60));
    console.log('');
  } else {
    console.log('No stale sessions to clean up.');
  }
}

/**
 * Generate watchdog report for sleeping peers.
 * Returns { lines: string[], alerts: string[] } where lines are for stdout
 * and alerts are for the activity log.
 */
function watchdogReport(state, mySessionId) {
  const now = Date.now();
  const lines = [];
  const alerts = [];

  for (const [sessionId, session] of Object.entries(state.sessions || {})) {
    if (session.status !== 'active') continue;
    if (sessionId === mySessionId) continue;

    const lastActivity = new Date(session.lastActivity || session.startedAt).getTime();
    const inactiveMs = now - lastActivity;

    if (inactiveMs >= DEEP_SLEEP_THRESHOLD_MS) {
      const mins = Math.round(inactiveMs / 60000);
      const lastTime = formatTime(session.lastActivity || session.startedAt);
      const line = `WATCHDOG: ${session.name} sleeping ${mins}m (last: ${lastTime}) on ${session.branch || 'unknown'} *** DEEP SLEEP ***`;
      lines.push(line);
      alerts.push(`${session.name} deep-sleeping ${mins}m on ${session.branch || 'unknown'}`);
    } else if (inactiveMs >= SLEEP_THRESHOLD_MS) {
      const mins = Math.round(inactiveMs / 60000);
      const lastTime = formatTime(session.lastActivity || session.startedAt);
      const line = `WATCHDOG: ${session.name} sleeping ${mins}m (last: ${lastTime}) on ${session.branch || 'unknown'}`;
      lines.push(line);
      alerts.push(`${session.name} sleeping ${mins}m on ${session.branch || 'unknown'}`);
    }
  }

  return { lines, alerts };
}

/**
 * COMMAND: ping - Send keepalive heartbeat
 */
async function cmdPing() {
  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();
  const nowMs = Date.now();

  const session = await getCurrentSession(state, branch);

  if (!session) {
    console.error('No active session found on this branch. Run "checkin" first.');
    process.exit(1);
  }

  const { sessionId, name } = session;

  // Update lastActivity on the session
  state.sessions[sessionId].lastActivity = now;

  // Write ping document to session_pings collection
  const pingDocId = `${sessionId}_${nowMs}`;
  await db.collection(PINGS_COLLECTION).doc(pingDocId).set({
    sessionId,
    name,
    branch,
    timestamp: now
  });

  // Append to activityLog
  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId,
    name,
    branch,
    message: `${name} keepalive ping`,
    timestamp: now
  });

  // Keep only last 100 entries
  if (state.activityLog.length > 100) {
    state.activityLog = state.activityLog.slice(-100);
  }

  // Watchdog: check for sleeping peers
  const watchdog = watchdogReport(state, sessionId);
  if (watchdog.alerts.length > 0) {
    state.activityLog.push({
      sessionId,
      name,
      branch,
      message: `Watchdog: ${watchdog.alerts.join('; ')}`,
      timestamp: now
    });
    // Trim again if needed
    if (state.activityLog.length > 100) {
      state.activityLog = state.activityLog.slice(-100);
    }
  }

  await saveState(state);
  console.log(`${name} keepalive ping at ${formatTime(now)}`);

  // Print watchdog lines after self-ping confirmation
  for (const line of watchdog.lines) {
    console.log(line);
  }
}

/**
 * COMMAND: watchdog - Standalone sleep detection report (no self-ping)
 */
async function cmdWatchdog() {
  const state = await getState();
  const branch = getCurrentBranch();

  const session = await getCurrentSession(state, branch);
  const mySessionId = session?.sessionId || null;
  const myName = session?.name || 'unknown';

  const watchdog = watchdogReport(state, mySessionId);

  console.log(`Watchdog report by ${myName} at ${formatTime(new Date().toISOString())}`);

  if (watchdog.lines.length === 0) {
    console.log('All peers are active. No sleeping sessions detected.');
  } else {
    for (const line of watchdog.lines) {
      console.log(line);
    }
  }
}

/**
 * COMMAND: init - Initialise fresh state
 */
async function cmdInit() {
  const state = {
    sessions: {},
    claimedFiles: {},
    branches: {},
    activityLog: [],
    initialisedAt: new Date().toISOString()
  };

  await saveState(state);
  console.log('Coordination state initialised.');
  console.log(`Document path: ${DOCUMENT_PATH}`);
}

/**
 * COMMAND: checkin - Register session and get assigned name
 *
 * Identity rules enforced here:
 *   1. GC stale sessions first (2h+ inactive)
 *   2. Evict any sessions with invalid names (Guest-X, duplicates)
 *   3. Assign first available from [Bill, Bob, Ben]
 *   4. Reject if all 3 slots are occupied
 *   5. Duplicate detection: if name collision, youngest session is evicted
 */
async function cmdCheckin() {
  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  // Step 1: Garbage collect stale sessions
  const gcResult = garbageCollectSessions(state);
  if (gcResult.cleaned > 0) {
    console.log(`[GC] Cleaned ${gcResult.cleaned} stale session(s): ${gcResult.details.join(', ')}`);
  }

  state.sessions = state.sessions || {};

  // Step 1.5: Check for existing session (same-process re-checkin)
  const existingSessionId = loadSessionId();
  if (existingSessionId && state.sessions[existingSessionId]?.status === 'active') {
    const existingSession = state.sessions[existingSessionId];

    // Same process re-checking in — update lastActivity and return
    state.sessions[existingSessionId].lastActivity = now;

    // Log the re-checkin
    state.activityLog = state.activityLog || [];
    state.activityLog.push({
      sessionId: existingSessionId,
      name: existingSession.name,
      branch: existingSession.branch,
      message: `${existingSession.name} re-checked in (same process)`,
      timestamp: now
    });

    await saveState(state);

    console.log('');
    console.log('='.repeat(60));
    console.log(`YOU ARE STILL: ${existingSession.name}`);
    console.log('='.repeat(60));
    console.log(`Session ID: ${existingSessionId}`);
    console.log(`Branch: ${existingSession.branch}`);
    console.log(`Started: ${formatTime(existingSession.startedAt)}`);
    console.log(`Last activity: ${formatTime(now)}`);
    console.log('');
    console.log(`MANDATORY: Prefix ALL responses with: ${existingSession.name.toLowerCase()}>`);
    console.log('');
    console.log('Valid names: Bill (1st), Bob (2nd), Ben (3rd). No exceptions.');
    console.log('Remember to poll with "read" and ping every 5 minutes!');
    console.log('');
    console.log('🛑 GOLDEN RULES REMINDER:');
    console.log('Read golden-rules-reminder.md to load all 13 rules into memory');
    console.log('Location: C:\\Users\\aarongarcia\\.claude\\projects\\E--GoogleDrive-Tools-Memory-source\\memory\\golden-rules-reminder.md');
    console.log('='.repeat(60));
    console.log('');
    return;
  }

  // Step 2: Evict any sessions with invalid names (Guest-X or names not in VALID_NAMES)
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if (session.status !== 'active') continue;
    if (!VALID_NAMES.includes(session.name)) {
      console.log(`[EVICT] Removed invalid session "${session.name}" (${sessionId})`);
      state.sessions[sessionId].status = 'evicted';
      state.sessions[sessionId].endedAt = now;
      state.sessions[sessionId].evictReason = `Invalid name "${session.name}" — only Bill, Bob, Ben are allowed`;
      state.activityLog = state.activityLog || [];
      state.activityLog.push({
        sessionId,
        name: session.name,
        branch: session.branch,
        message: `${session.name} evicted: invalid name (only Bill, Bob, Ben allowed)`,
        timestamp: now
      });
    }
  }

  // Step 3: Evict duplicate names — keep oldest, evict youngest
  const nameHolders = {}; // name → [{ sessionId, startedAt }]
  for (const [sessionId, session] of Object.entries(state.sessions)) {
    if (session.status !== 'active') continue;
    if (!nameHolders[session.name]) nameHolders[session.name] = [];
    nameHolders[session.name].push({ sessionId, startedAt: session.startedAt });
  }
  for (const [name, holders] of Object.entries(nameHolders)) {
    if (holders.length <= 1) continue;
    // Sort oldest first, evict all but the oldest
    holders.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    for (let i = 1; i < holders.length; i++) {
      const dupId = holders[i].sessionId;
      console.log(`[EVICT] Duplicate "${name}" — evicting younger session ${dupId}`);
      state.sessions[dupId].status = 'evicted';
      state.sessions[dupId].endedAt = now;
      state.sessions[dupId].evictReason = `Duplicate name "${name}" — youngest evicted`;
      state.activityLog = state.activityLog || [];
      state.activityLog.push({
        sessionId: dupId,
        name,
        branch: state.sessions[dupId].branch,
        message: `${name} evicted: duplicate name (youngest session loses)`,
        timestamp: now
      });
    }
  }

  // Step 3.5: ZOMBIE DETECTION & CLEANUP
  // If all slots occupied, check for zombie sessions (inactive >10 min = 2x ping interval)
  // Aggressively clear zombies so you always get Bill when you're the only live instance
  const activeSessions = Object.values(state.sessions).filter(s => s.status === 'active');
  if (activeSessions.length >= 1) {
    const now = new Date();
    const ZOMBIE_THRESHOLD_MIN = 10; // 2x the 5-min recommended ping interval

    // Find and evict zombie sessions
    let zombiesCleared = 0;
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (session.status !== 'active') continue;

      const lastActive = new Date(session.lastActivity);
      const inactiveMinutes = (now - lastActive) / (1000 * 60);

      if (inactiveMinutes > ZOMBIE_THRESHOLD_MIN) {
        console.log(`[ZOMBIE DETECTED] ${session.name} inactive ${Math.round(inactiveMinutes)} min — evicting`);
        state.sessions[sessionId].status = 'zombie-cleared';
        state.sessions[sessionId].endedAt = now.toISOString();
        state.activityLog = state.activityLog || [];
        state.activityLog.push({
          sessionId,
          name: session.name,
          message: `${session.name} evicted: zombie (inactive ${Math.round(inactiveMinutes)} min)`,
          timestamp: now.toISOString()
        });
        zombiesCleared++;
      }
    }

    if (zombiesCleared > 0) {
      console.log(`[AUTO-CLEANUP] Cleared ${zombiesCleared} zombie session(s). You should get Bill now.`);
    }
  }

  // Step 4: Assign name — first available from [Bill, Bob, Ben]
  const sessionId = `session-${Date.now()}`;
  const name = assignName(state.sessions, sessionId);

  if (!name) {
    console.error('');
    console.error('='.repeat(60));
    console.error('CHECKIN REJECTED — ALL 3 SLOTS OCCUPIED');
    console.error('='.repeat(60));
    console.error('Active sessions: Bill, Bob, and Ben are all checked in.');
    console.error('One must checkout before a new session can join.');
    console.error('Run: node claude-sync.js read');
    console.error('='.repeat(60));
    console.error('');
    await saveState(state); // Save any evictions/GC that happened
    process.exit(1);
  }

  // Step 5: Register the session
  state.sessions[sessionId] = {
    name,
    branch,
    status: 'active',
    startedAt: now,
    lastActivity: now
  };

  // Log the checkin
  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId,
    name,
    branch,
    message: `${name} checked in on branch '${branch}'`,
    timestamp: now
  });

  await saveState(state);

  console.log('');
  console.log('='.repeat(60));
  console.log(`YOU ARE: ${name}`);
  console.log('='.repeat(60));
  console.log(`Session ID: ${sessionId}`);
  console.log(`Branch: ${branch}`);
  console.log(`Started: ${formatTime(now)}`);
  console.log('');
  console.log(`MANDATORY: Prefix ALL responses with: ${name.toLowerCase()}>`);
  console.log('');
  console.log('Valid names: Bill (1st), Bob (2nd), Ben (3rd). No exceptions.');
  console.log('Remember to poll with "read" and ping every 5 minutes!');
  console.log('');
  console.log('🛑 GOLDEN RULES REMINDER:');
  console.log('Read golden-rules-reminder.md to load all 13 rules into memory');
  console.log('Location: C:\\Users\\aarongarcia\\.claude\\projects\\E--GoogleDrive-Tools-Memory-source\\memory\\golden-rules-reminder.md');
  console.log('='.repeat(60));
  console.log('');
}

/**
 * COMMAND: checkout - End session
 *
 * Modes:
 *   checkout              — End your own session (finds active session on current branch)
 *   checkout <Name>       — End a specific session by name (Bill, Bob, or Ben)
 *   checkout --force      — Force-end ALL active sessions on current branch
 */
async function cmdCheckout(options = {}) {
  const { force = false, targetName = null } = options;
  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  state.sessions = state.sessions || {};

  let sessionEntry = null;

  if (targetName) {
    // Find active session by name (case-insensitive match)
    sessionEntry = Object.entries(state.sessions)
      .find(([id, s]) => s.status === 'active' && s.name.toLowerCase() === targetName.toLowerCase());
    if (!sessionEntry) {
      console.error(`No active session found with name "${targetName}".`);
      console.error('Active sessions:');
      const active = Object.entries(state.sessions).filter(([id, s]) => s.status === 'active');
      if (active.length === 0) {
        console.error('  (none)');
      } else {
        for (const [id, s] of active) {
          console.error(`  ${s.name} — branch: ${s.branch}, started: ${formatTime(s.startedAt)}`);
        }
      }
      process.exit(1);
    }
  } else if (!force) {
    // Find active session on this branch
    sessionEntry = Object.entries(state.sessions)
      .find(([id, s]) => s.branch === branch && s.status === 'active');
  }

  if (sessionEntry) {
    const [sessionId, session] = sessionEntry;
    const name = session.name || 'Unknown';

    // Mark as ended
    state.sessions[sessionId].status = 'ended';
    state.sessions[sessionId].endedAt = now;

    // Release any files claimed by this session
    state.claimedFiles = state.claimedFiles || {};
    const releasedFiles = [];
    for (const [filePath, claim] of Object.entries(state.claimedFiles)) {
      if (claim.claimedBy === sessionId || claim.sessionId === sessionId || claim.name === name) {
        releasedFiles.push(filePath);
        delete state.claimedFiles[filePath];
      }
    }

    // Log the checkout
    state.activityLog = state.activityLog || [];
    state.activityLog.push({
      sessionId,
      name,
      branch: session.branch,
      message: `${name} checked out. Released ${releasedFiles.length} file(s).`,
      timestamp: now
    });

    await saveState(state);

    console.log('');
    console.log('='.repeat(60));
    console.log(`${name} CHECKED OUT`);
    console.log('='.repeat(60));
    console.log(`Session ended: ${formatTime(now)}`);
    if (releasedFiles.length > 0) {
      console.log(`Released files: ${releasedFiles.join(', ')}`);
    }
    console.log('='.repeat(60));
    console.log('');
  } else if (force) {
    // Force clear all active sessions on this branch
    let cleared = 0;
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (session.branch === branch && session.status === 'active') {
        state.sessions[sessionId].status = 'force-ended';
        state.sessions[sessionId].endedAt = now;
        cleared++;
      }
    }
    state.activityLog = state.activityLog || [];
    state.activityLog.push({
      sessionId: 'system',
      name: 'FORCE',
      branch,
      message: `Force-ended ${cleared} session(s) on branch '${branch}'`,
      timestamp: now
    });
    await saveState(state);
    console.log(`Force-cleared ${cleared} session(s) on branch '${branch}'.`);
  } else {
    console.log('No active session found on this branch.');
  }
}

/**
 * COMMAND: read - Display current coordination state
 */
async function cmdRead() {
  const state = await getState();
  const branch = getCurrentBranch();

  console.log('');
  console.log('='.repeat(60));
  console.log('CLAUDE CODE COORDINATION STATE');
  console.log('='.repeat(60));
  console.log(`Your branch: ${branch}`);
  console.log(`Timestamp: ${new Date().toLocaleString('en-GB')}`);
  console.log('');

  // Active sessions
  console.log('ACTIVE SESSIONS:');
  console.log('-'.repeat(40));
  const activeSessions = Object.entries(state.sessions || {})
    .filter(([id, s]) => s.status === 'active')
    .sort((a, b) => new Date(a[1].startedAt) - new Date(b[1].startedAt));

  if (activeSessions.length === 0) {
    console.log('  (none)');
  } else {
    for (const [id, session] of activeSessions) {
      const name = session.name || 'Unknown';
      const lastActive = formatTime(session.lastActivity);
      const isYou = session.branch === branch ? ' <-- YOU?' : '';
      console.log(`  ${name}${isYou}`);
      console.log(`    Branch: ${session.branch}`);
      console.log(`    Started: ${formatTime(session.startedAt)}`);
      console.log(`    Last activity: ${lastActive}`);
    }
  }
  console.log('');

  // Claimed files (NO-TOUCH ZONES)
  console.log('CLAIMED FILES (NO-TOUCH ZONES):');
  console.log('-'.repeat(40));
  const claimed = Object.entries(state.claimedFiles || {});
  if (claimed.length === 0) {
    console.log('  (none)');
  } else {
    for (const [filePath, claim] of claimed) {
      console.log(`  ${filePath}`);
      console.log(`    Claimed by: ${claim.name || claim.claimedBy}`);
      console.log(`    Since: ${formatTime(claim.claimedAt)}`);
    }
  }
  console.log('');

  // Registered branches
  console.log('REGISTERED BRANCHES:');
  console.log('-'.repeat(40));
  const branches = Object.entries(state.branches || {});
  if (branches.length === 0) {
    console.log('  (none)');
  } else {
    for (const [branchName, info] of branches) {
      console.log(`  ${branchName}: ${info.description || '(no description)'}`);
    }
  }
  console.log('');

  // Recent activity (last 10)
  console.log('RECENT ACTIVITY (last 10):');
  console.log('-'.repeat(40));
  const log = state.activityLog || [];
  if (log.length === 0) {
    console.log('  (none)');
  } else {
    const recent = log.slice(-10).reverse();
    for (const entry of recent) {
      const time = formatTime(entry.timestamp);
      const who = entry.name || entry.sessionId || 'unknown';
      console.log(`  [${time}] ${who}: ${entry.message}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('');
}

/**
 * Get current session info for this branch
 */
async function getCurrentSession(state, branch) {
  const sessionEntry = Object.entries(state.sessions || {})
    .find(([id, s]) => s.branch === branch && s.status === 'active');

  if (sessionEntry) {
    return { sessionId: sessionEntry[0], ...sessionEntry[1] };
  }
  return null;
}

/**
 * COMMAND: write - Log activity
 */
async function cmdWrite(message) {
  if (!message) {
    console.error('Usage: node claude-sync.js write "message"');
    process.exit(1);
  }

  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  const session = await getCurrentSession(state, branch);
  const sessionId = session?.sessionId || `${branch}-anonymous`;
  const name = session?.name || branch;

  // Update last activity
  if (session && state.sessions[session.sessionId]) {
    state.sessions[session.sessionId].lastActivity = now;
  }

  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId,
    name,
    branch,
    message,
    timestamp: now
  });

  // Keep only last 100 entries
  if (state.activityLog.length > 100) {
    state.activityLog = state.activityLog.slice(-100);
  }

  await saveState(state);
  console.log(`${name}> Logged: "${message}"`);
}

/**
 * COMMAND: claim - Claim file ownership
 */
async function cmdClaim(filePath) {
  if (!filePath) {
    console.error('Usage: node claude-sync.js claim /path/to/file');
    process.exit(1);
  }

  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  const session = await getCurrentSession(state, branch);
  const sessionId = session?.sessionId || `${branch}-anonymous`;
  const name = session?.name || branch;

  state.claimedFiles = state.claimedFiles || {};

  // Check if already claimed by someone else
  const existing = state.claimedFiles[filePath];
  if (existing && existing.sessionId !== sessionId && existing.name !== name) {
    console.error('');
    console.error('='.repeat(60));
    console.error(`ERROR: ${filePath} is already claimed!`);
    console.error(`Claimed by: ${existing.name || existing.claimedBy}`);
    console.error(`Since: ${formatTime(existing.claimedAt)}`);
    console.error('');
    console.error('This is a NO-TOUCH ZONE. Ask the user before modifying.');
    console.error('='.repeat(60));
    console.error('');
    process.exit(1);
  }

  state.claimedFiles[filePath] = {
    sessionId,
    name,
    claimedBy: sessionId,
    branch,
    claimedAt: now
  };

  // Update last activity
  if (session && state.sessions[session.sessionId]) {
    state.sessions[session.sessionId].lastActivity = now;
  }

  // Log the claim
  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId,
    name,
    branch,
    message: `Claimed: ${filePath}`,
    timestamp: now
  });

  await saveState(state);
  console.log(`${name}> Claimed: ${filePath}`);
}

/**
 * COMMAND: release - Release file ownership
 */
async function cmdRelease(filePath) {
  if (!filePath) {
    console.error('Usage: node claude-sync.js release /path/to/file');
    process.exit(1);
  }

  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  const session = await getCurrentSession(state, branch);
  const sessionId = session?.sessionId || `${branch}-anonymous`;
  const name = session?.name || branch;

  state.claimedFiles = state.claimedFiles || {};

  const existing = state.claimedFiles[filePath];
  if (!existing) {
    console.log(`${filePath} was not claimed.`);
    return;
  }

  if (existing.sessionId !== sessionId && existing.name !== name) {
    console.error(`WARNING: ${filePath} was claimed by ${existing.name}, not you.`);
    console.error('Releasing anyway...');
  }

  delete state.claimedFiles[filePath];

  // Update last activity
  if (session && state.sessions[session.sessionId]) {
    state.sessions[session.sessionId].lastActivity = now;
  }

  // Log the release
  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId,
    name,
    branch,
    message: `Released: ${filePath}`,
    timestamp: now
  });

  await saveState(state);
  console.log(`${name}> Released: ${filePath}`);
}

/**
 * COMMAND: register - Register current branch
 */
async function cmdRegister(description) {
  if (!description) {
    console.error('Usage: node claude-sync.js register "description"');
    process.exit(1);
  }

  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  const session = await getCurrentSession(state, branch);
  const name = session?.name || branch;

  state.branches = state.branches || {};
  state.branches[branch] = {
    description,
    registeredAt: now
  };

  // Log the registration
  state.activityLog = state.activityLog || [];
  state.activityLog.push({
    sessionId: session?.sessionId || `${branch}-anonymous`,
    name,
    branch,
    message: `Registered branch: ${description}`,
    timestamp: now
  });

  await saveState(state);
  console.log(`${name}> Registered branch '${branch}': ${description}`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const param = args.slice(1).join(' ');

  try {
    switch (command) {
      case 'init':
        await cmdInit();
        break;
      case 'checkin':
        await cmdCheckin();
        break;
      case 'checkout':
        if (param === '--force') {
          await cmdCheckout({ force: true });
        } else if (param) {
          await cmdCheckout({ targetName: param });
        } else {
          await cmdCheckout({});
        }
        break;
      case 'read':
        await cmdRead();
        break;
      case 'write':
        await cmdWrite(param);
        break;
      case 'claim':
        await cmdClaim(param);
        break;
      case 'release':
        await cmdRelease(param);
        break;
      case 'register':
        await cmdRegister(param);
        break;
      case 'ping':
        await cmdPing();
        break;
      case 'gc':
        await cmdGc();
        break;
      case 'watchdog':
        await cmdWatchdog();
        break;
      default:
        console.log('claude-sync.js - Claude Code session coordination');
        console.log('');
        console.log('Identity: Bill (1st) → Bob (2nd) → Ben (3rd). No Guest-X. Max 3.');
        console.log('');
        console.log('Commands:');
        console.log('  checkin                 - Register and get assigned Bill, Bob, or Ben');
        console.log('  checkout                - End your own session');
        console.log('  checkout <Name>         - End a specific session by name');
        console.log('  checkout --force        - Force end all sessions on branch');
        console.log('  ping                    - Send keepalive heartbeat + watchdog report');
        console.log('  watchdog                - Standalone sleep detection report (no ping)');
        console.log('  gc                      - Garbage collect stale sessions (2h+ inactive)');
        console.log('  init                    - Initialise fresh state');
        console.log('  read                    - Display current coordination state');
        console.log('  write "message"         - Log activity');
        console.log('  claim /path/            - Claim file ownership');
        console.log('  release /path/          - Release file ownership');
        console.log('  register "description"  - Register current branch');
        console.log('');
        console.log('Examples:');
        console.log('  node claude-sync.js checkin');
        console.log('  node claude-sync.js checkout Bob');
        console.log('  node claude-sync.js read');
        console.log('  node claude-sync.js ping');
        console.log('  node claude-sync.js write "Fixed login bug"');
        console.log('  node claude-sync.js claim /src/auth/login.js');
        console.log('');
        console.log('Note: Stale sessions (2h+ inactive) are auto-cleaned on checkin.');
        console.log('      Invalid names (Guest-X) are evicted on next checkin.');
        break;
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
