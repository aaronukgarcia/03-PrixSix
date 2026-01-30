// claude-startup.js — SessionStart hook script
// Runs checkin, validates identity, writes identity file, outputs confirmation for Claude
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const identityPath = path.join(projectRoot, '.claude', '.identity');
const VALID_NAMES = ['bob', 'bill', 'ben'];

try {
  const output = execSync('node claude-sync.js checkin', {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 10000,
  });

  // Parse name from checkin output (format: "YOU ARE: Bob")
  const nameMatch = output.match(/YOU ARE:\s*(\w[\w-]*)/i);
  const name = nameMatch ? nameMatch[1].toLowerCase() : null;

  if (name && VALID_NAMES.includes(name)) {
    // Valid name — write identity and confirm
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
  } else if (name) {
    // Got a guest/unknown assignment — warn strongly but still enforce rules
    fs.writeFileSync(identityPath, name, 'utf-8');

    console.log(`WARNING: You were assigned "${name}" which is NOT a recognised instance name.`);
    console.log(`Valid names are: bob, bill, ben. This means too many instances are running.`);
    console.log(`TELL THE USER IMMEDIATELY: "I was assigned ${name} instead of bob/bill/ben. There may be too many instances running. Please check and close stale sessions."`);
    console.log(`STILL PREFIX EVERY RESPONSE with "${name}>".`);
    console.log(``);
    console.log(`MANDATORY STARTUP SEQUENCE — DO ALL OF THESE BEFORE YOUR FIRST RESPONSE:`);
    console.log(`1. Use the mcp__vestige__recall tool NOW with query "who am I, identity, session startup" to load memory.`);
    console.log(`2. Read CLAUDE.md for full Golden Rules.`);
    console.log(`3. Run 'node claude-sync.js read' to check who else is active.`);
    console.log(`4. Your first response must confirm: identity, hooks status, Vestige status, and warn about the guest assignment.`);
    console.log(`DO NOT skip step 1. Memory recall is not optional.`);
  } else {
    console.log('WARNING: Could not parse name from checkin output.');
    console.log('Run manually: node claude-sync.js checkin');
    console.log('You MUST prefix responses with bob>, bill>, or ben>.');
    console.log('Read CLAUDE.md for full Golden Rules.');
  }
} catch (err) {
  console.log('WARNING: claude-sync.js checkin failed: ' + (err.message || err));
  console.log('You MUST still prefix responses with bob>, bill>, or ben>.');
  console.log('Read CLAUDE.md for full Golden Rules.');

  // Try to read existing identity
  try {
    const existing = fs.readFileSync(identityPath, 'utf-8').trim();
    if (existing) {
      console.log(`Last known identity: ${existing}>. Use this until checkin succeeds.`);
    }
  } catch {}
}
