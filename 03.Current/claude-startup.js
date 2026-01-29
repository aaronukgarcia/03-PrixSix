// claude-startup.js — SessionStart hook script
// Runs checkin, writes identity file for statusline, outputs confirmation for Claude
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const identityPath = path.join(projectRoot, '.claude', '.identity');

try {
  const output = execSync('node claude-sync.js checkin', {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 10000,
  });

  // Parse name from checkin output (format: "YOU ARE: Bob")
  const nameMatch = output.match(/YOU ARE:\s*(\w+)/i);
  const name = nameMatch ? nameMatch[1].toLowerCase() : null;

  if (name) {
    // Write identity for statusline to read
    fs.writeFileSync(identityPath, name, 'utf-8');

    console.log(`IDENTITY: ${name}>`);
    console.log(`PREFIX EVERY RESPONSE with "${name}>". No exceptions.`);
    console.log(`HOOKS: ACTIVE.`);
    console.log(`VESTIGE: Confirm by running a recall query now. If it fails, memory is unavailable.`);
    console.log(`Read CLAUDE.md for Golden Rules. Run 'node claude-sync.js read' to check coordination.`);
  } else {
    console.log('WARNING: Could not parse name from checkin output.');
    console.log('Run manually: node claude-sync.js checkin');
    console.log('You MUST prefix responses with bob>, bill>, or ben>.');
  }
} catch (err) {
  console.log('WARNING: claude-sync.js checkin failed: ' + (err.message || err));
  console.log('You MUST still prefix responses with bob>, bill>, or ben>.');

  // Try to read existing identity
  try {
    const existing = fs.readFileSync(identityPath, 'utf-8').trim();
    if (existing) {
      console.log(`Last known identity: ${existing}>. Use this until checkin succeeds.`);
    }
  } catch {}
}
