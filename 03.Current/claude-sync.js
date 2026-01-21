/**
 * claude-sync.js - Coordination script for multiple Claude Code sessions
 *
 * Commands:
 *   checkin                 - Register session and get assigned Bob or Bill
 *   checkout                - End session
 *   read                    - Display current coordination state
 *   write "message"         - Log activity
 *   claim /path/            - Claim file ownership
 *   release /path/          - Release file ownership
 *   register "description"  - Register current branch
 *   init                    - Initialise fresh state
 *
 * Uses Firestore document at: coordination/claude-state
 */

const admin = require('firebase-admin');
const { execSync } = require('child_process');
const path = require('path');

// Configuration
const PROJECT_ID = 'studio-6033436327-281b1';
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(__dirname, 'service-account.json');
const DOCUMENT_PATH = 'coordination/claude-state';

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
 * Determine Bob or Bill based on active sessions
 * Bob = oldest active session, Bill = second
 */
function assignName(sessions, mySessionId) {
  const activeSessions = Object.entries(sessions || {})
    .filter(([id, s]) => s.status === 'active')
    .sort((a, b) => new Date(a[1].startedAt) - new Date(b[1].startedAt));

  const myIndex = activeSessions.findIndex(([id]) => id === mySessionId);

  if (myIndex === 0) return 'Bob';
  if (myIndex === 1) return 'Bill';
  if (myIndex > 1) return `Guest-${myIndex + 1}`;

  // Not found yet - will be assigned based on count
  if (activeSessions.length === 0) return 'Bob';
  if (activeSessions.length === 1) return 'Bill';
  return `Guest-${activeSessions.length + 1}`;
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
 */
async function cmdCheckin() {
  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  // Generate a unique session ID based on timestamp only (allows multiple on same branch)
  const sessionId = `session-${Date.now()}`;

  state.sessions = state.sessions || {};

  // Assign name based on global active session count (Bob = first, Bill = second)
  const name = assignName(state.sessions, sessionId);

  // Register the session
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
  console.log(`Prefix all your responses with: ${name.toLowerCase()}>`);
  console.log('');
  console.log('Remember to poll the shared memory regularly!');
  console.log('='.repeat(60));
  console.log('');
}

/**
 * COMMAND: checkout - End session
 */
async function cmdCheckout(force = false) {
  const state = await getState();
  const branch = getCurrentBranch();
  const now = new Date().toISOString();

  state.sessions = state.sessions || {};

  // Find active session on this branch
  const sessionEntry = Object.entries(state.sessions)
    .find(([id, s]) => s.branch === branch && s.status === 'active');

  if (!sessionEntry && !force) {
    console.log('No active session found on this branch.');
    return;
  }

  if (sessionEntry) {
    const [sessionId, session] = sessionEntry;
    const name = session.name || 'Unknown';

    // Mark as inactive
    state.sessions[sessionId].status = 'ended';
    state.sessions[sessionId].endedAt = now;

    // Release any files claimed by this session
    state.claimedFiles = state.claimedFiles || {};
    const releasedFiles = [];
    for (const [filePath, claim] of Object.entries(state.claimedFiles)) {
      if (claim.claimedBy === sessionId || claim.name === name) {
        releasedFiles.push(filePath);
        delete state.claimedFiles[filePath];
      }
    }

    // Log the checkout
    state.activityLog = state.activityLog || [];
    state.activityLog.push({
      sessionId,
      name,
      branch,
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
    // Force clear all sessions on this branch
    for (const [sessionId, session] of Object.entries(state.sessions)) {
      if (session.branch === branch) {
        state.sessions[sessionId].status = 'force-ended';
        state.sessions[sessionId].endedAt = now;
      }
    }
    await saveState(state);
    console.log('Force-cleared all sessions on this branch.');
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
        await cmdCheckout(param === '--force');
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
      default:
        console.log('claude-sync.js - Claude Code session coordination');
        console.log('');
        console.log('Commands:');
        console.log('  checkin                 - Register and get assigned Bob or Bill');
        console.log('  checkout                - End your session');
        console.log('  checkout --force        - Force end all sessions on branch');
        console.log('  init                    - Initialise fresh state');
        console.log('  read                    - Display current coordination state');
        console.log('  write "message"         - Log activity');
        console.log('  claim /path/            - Claim file ownership');
        console.log('  release /path/          - Release file ownership');
        console.log('  register "description"  - Register current branch');
        console.log('');
        console.log('Examples:');
        console.log('  node claude-sync.js checkin');
        console.log('  node claude-sync.js read');
        console.log('  node claude-sync.js write "Fixed login bug"');
        console.log('  node claude-sync.js claim /src/auth/login.js');
        console.log('  node claude-sync.js checkout');
        break;
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

main();
