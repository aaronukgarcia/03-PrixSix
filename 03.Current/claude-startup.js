// claude-startup.js — SessionStart hook script
// Runs checkin, validates identity, writes identity file, outputs confirmation for Claude
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const identityPath = path.join(projectRoot, '.claude', '.identity');
const VALID_NAMES = ['bob', 'bill', 'ben'];

/** Run a checkin command, returning { output, error, stderr } */
function tryCheckin(cmd) {
  try {
    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { output, error: null, stderr: '' };
  } catch (err) {
    const stderr = (err.stderr || '') + (err.stdout || '');
    return { output: null, error: err, stderr };
  }
}

/** Parse the assigned name from successful checkin output */
function parseName(output) {
  const match = (output || '').match(/YOU ARE:\s*(\w[\w-]*)/i);
  const name = match ? match[1].toLowerCase() : null;
  return (name && VALID_NAMES.includes(name)) ? name : null;
}

/** True if stderr indicates all slots are occupied */
function isAllFull(stderr) {
  return stderr.includes('all-full')
    || stderr.includes('ALL SLOTS FULL')
    || stderr.includes('ALL PERMITS OCCUPIED');
}

/** True if stderr indicates a specific named slot is occupied */
function isNameOccupied(stderr) {
  return stderr.includes('SLOT IS OCCUPIED') || stderr.includes('name-occupied');
}

/**
 * Parse the maximum TTL (ms) from an all-full rejection stderr.
 * Matches patterns like "expires in 2m 19s" or "expires in 0m 45s".
 * Returns null if no TTL data found.
 */
function parseMaxTTLMs(stderr) {
  const matches = [...stderr.matchAll(/expires in (\d+)m (\d+)s/g)];
  if (!matches.length) return null;
  return Math.max(...matches.map(m => (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000));
}

/**
 * Format a TTL in ms as "Xm Ys".
 */
function fmtMs(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Emit the mandatory startup instructions for a successfully-claimed identity */
function emitSuccess(name) {
  fs.writeFileSync(identityPath, name, 'utf-8');
  console.log(`IDENTITY: ${name}>`);
  console.log(`PREFIX EVERY RESPONSE with "${name}>". No exceptions.`);
  console.log(`HOOKS: ACTIVE.`);
  console.log(``);
  console.log(`MANDATORY STARTUP SEQUENCE — DO ALL OF THESE BEFORE YOUR FIRST RESPONSE:`);
  console.log(`1. Use the mcp__vestige__recall tool NOW with query "who am I, identity, session startup" to load memory.`);
  console.log(`2. Read CLAUDE.md for full Golden Rules.`);
  console.log(`3. Run 'node claude-sync.js read' to check coordination state.`);
  console.log(`4. Your first response to the user must confirm: identity, hooks status, Vestige status, and current version.`);
  console.log(`DO NOT skip step 1. Memory recall is not optional. If Vestige tools are unavailable, state that explicitly.`);
}

/**
 * Emit deferred-checkin instructions when all slots are occupied but expiring shortly.
 * Claude should run checkin as its first action in the conversation.
 */
function emitDeferredCheckin(maxTTLMs, stderrSnippet) {
  const waitSec = Math.ceil(maxTTLMs / 1000) + 5;
  console.log(`CHECKIN DEFERRED — All permits occupied but expire within ${fmtMs(maxTTLMs)}.`);
  console.log(stderrSnippet.trim());
  console.log(``);
  console.log(`YOU HAVE NO IDENTITY YET. Do not prefix responses until checkin succeeds.`);
  console.log(``);
  console.log(`ACTION: As your VERY FIRST action, run this command (slots will have expired by then):`);
  console.log(`  node claude-sync.js checkin`);
  console.log(``);
  console.log(`IF that still fails (race condition), you may force-evict with user authorisation:`);
  console.log(`  node claude-sync.js checkin --name Bob --force --human-ok`);
  console.log(`  AUTHORIZATION: User saying "yes", "go ahead", "proceed", selecting an option, or any`);
  console.log(`  explicit confirmation in the conversation counts as human-ok authorization.`);
  console.log(`  You DO NOT need to ask the user to type the command themselves.`);
  console.log(``);
  console.log(`Tell the user: "All slots just expired — running checkin now..." then run it immediately.`);
}

/** Emit the hard-blocked message when all slots are full with long TTLs */
function emitAllFull() {
  console.log(`ERROR: ALL PERMIT SLOTS ARE FULL (Bill, Bob, Ben all occupied, TTLs > 3 min).`);
  console.log(`YOU HAVE NO IDENTITY. DO NOT PREFIX RESPONSES WITH ANY NAME.`);
  console.log(`TELL THE USER IMMEDIATELY: "All three Claude slots are occupied. I cannot check in."`);
  console.log(`Ask the user to run: node claude-sync.js read  — to see who is active.`);
  console.log(`Do NOT proceed with any work until you have a valid permit.`);
}

/** Emit the hard-blocked message when checkin fails for a non-recoverable technical reason */
function emitTechnicalFailure(errMsg) {
  console.log(`ERROR: claude-sync.js checkin failed with a technical error.`);
  console.log(`Error: ${errMsg}`);
  console.log(`YOU HAVE NO CONFIRMED IDENTITY.`);
  console.log(`DO NOT use any previous identity — it may be stale or wrong.`);
  console.log(`TELL THE USER: "Session checkin failed: ${errMsg}. Please run: node claude-sync.js checkin manually."`);
  console.log(`You MUST still prefix responses with bob>, bill>, or ben> once you have checked in successfully.`);
  console.log(`Read CLAUDE.md for full Golden Rules.`);
}

/**
 * Handle an all-full result: if TTLs are short, emit deferred-checkin;
 * otherwise emit hard-blocked all-full.
 */
function handleAllFull(stderr) {
  const maxTTL = parseMaxTTLMs(stderr);
  if (maxTTL !== null && maxTTL <= 3 * 60 * 1000) {
    // All slots expire within 3 minutes — defer checkin to first conversation turn
    emitDeferredCheckin(maxTTL, stderr);
  } else {
    // Long TTLs — hard block
    emitAllFull();
  }
}

// ─── Main Logic ───────────────────────────────────────────────────────────────

const requestedIdentity = process.env.CLAUDE_IDENTITY || null;

if (requestedIdentity) {
  // Step 1: Try to claim the specifically-requested identity
  const first = tryCheckin(`node claude-sync.js checkin --name ${requestedIdentity}`);

  if (first.output && parseName(first.output)) {
    // Got the requested slot — perfect
    emitSuccess(parseName(first.output));

  } else if (isNameOccupied(first.stderr)) {
    // Requested slot is taken — fall back to any available slot
    console.log(`WARNING: ${requestedIdentity} slot is OCCUPIED by another live session.`);
    console.log(`Falling back to next available slot (Bob or Ben)...`);

    const second = tryCheckin('node claude-sync.js checkin');

    if (second.output && parseName(second.output)) {
      const assigned = parseName(second.output);
      console.log(`NOTE: You requested "${requestedIdentity}" but that slot was taken.`);
      console.log(`You have been assigned "${assigned}" instead.`);
      emitSuccess(assigned);

    } else if (isAllFull(second.stderr)) {
      handleAllFull(second.stderr);

    } else {
      emitTechnicalFailure((second.error && second.error.message) || 'Unknown error on fallback checkin');
    }

  } else if (first.stderr && first.stderr.includes('FORCE-EVICT BLOCKED')) {
    console.log(`ERROR: Force-evict was blocked. Human authorisation required.`);
    console.log(`DO NOT USE "${requestedIdentity}>" prefix — you do not hold that permit.`);
    console.log(`TELL THE USER: "${requestedIdentity} slot is occupied and force-evict requires human authorisation."`);
    console.log(`The user must confirm ("yes", "go ahead", etc.) and then you may run:`);
    console.log(`  node claude-sync.js checkin --name ${requestedIdentity} --force --human-ok`);

  } else if (isAllFull(first.stderr)) {
    handleAllFull(first.stderr);

  } else {
    emitTechnicalFailure((first.error && first.error.message) || 'Unknown error');
  }

} else {
  // No identity preference — first-come, first-served
  const result = tryCheckin('node claude-sync.js checkin');

  if (result.output && parseName(result.output)) {
    emitSuccess(parseName(result.output));

  } else if (isAllFull(result.stderr)) {
    handleAllFull(result.stderr);

  } else {
    emitTechnicalFailure((result.error && result.error.message) || 'Unknown error');
  }
}
