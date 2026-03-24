/**
 * PreToolUse hook — Golden Rule #2 enforcement.
 * Blocks any `git commit` command unless BOTH package.json and version.ts
 * are staged (git added) in the current commit.
 *
 * Why: On 2026-03-24, 10 consecutive commits were pushed to main under the
 * same version number (2.5.6) because raw git commands bypassed the /commit
 * skill. This hook makes it impossible to commit without a version bump,
 * regardless of whether /commit is used or git is called directly.
 *
 * Receives JSON on stdin: { tool: "Bash", tool_input: { command: "..." } }
 * Returns JSON to block: { hookSpecificOutput: { permissionDecision: "deny" } }
 * Returns nothing to allow.
 */

const { execSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data?.tool_input?.command ?? '';

    // Only intercept git commit commands
    if (!command.includes('git commit') && !command.includes('git -C') ) {
      process.exit(0);
    }

    // Refine: must actually be a commit (not git log, git status, etc.)
    if (!command.includes('commit')) {
      process.exit(0);
    }

    // Skip: amend, merge commits, or if this IS the version bump commit
    if (command.includes('--amend')) {
      process.exit(0);
    }

    // Check what's staged
    let staged = '';
    try {
      staged = execSync('git -C "E:\\GoogleDrive\\Papers\\03-PrixSix" diff --cached --name-only', {
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch {
      // If git fails, don't block — might be outside repo
      process.exit(0);
    }

    const hasPackageJson = staged.includes('package.json');
    const hasVersionTs = staged.includes('version.ts');

    if (hasPackageJson && hasVersionTs) {
      // Both version files staged — allow
      process.exit(0);
    }

    // Build a clear message about what's missing
    const missing = [];
    if (!hasPackageJson) missing.push('package.json');
    if (!hasVersionTs) missing.push('src/lib/version.ts');

    const reason = `🛑 GOLDEN RULE #2 VIOLATION: Version bump required.\n` +
      `Missing from staged files: ${missing.join(' + ')}\n` +
      `Run /bump first, then commit. Every commit to main must bump the version.`;

    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    });

    process.stdout.write(output);
    process.exit(0);

  } catch (err) {
    // Parse error or unexpected input — don't block
    process.exit(0);
  }
});
