const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// GUID: SCRIPT_SYNC_COMMIT_HISTORY-000-v01
// [Intent] Automatically sync and resolve commit-history.json using local git log.
//          Preserves all old historical commits while prepending new ones and resolving "PENDING" hashes.
// [Inbound Trigger] Triggered during the Next.js 'build' script.
// [Downstream Impact] Rewrites app/src/lib/commit-history.json dynamically so /about/dev is always up to date.

try {
  console.log('[sync-commit-history] Pre-build git sync starting...');
  const targetPath = path.join(__dirname, '../app/src/lib/commit-history.json');
  
  if (!fs.existsSync(targetPath)) {
    console.warn(`[sync-commit-history] Warning: Target file ${targetPath} not found.`);
    process.exit(0);
  }

  // Read existing history
  const historyData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const existingCommits = historyData.commits || [];
  
  // Get the last 30 commits from the active git branch
  const logOutput = execSync('git log --pretty=format:"%h|%ad|%an|%s" --date=short -n 30').toString().trim();
  const lines = logOutput.split('\n');
  const gitCommits = [];

  for (const line of lines) {
    if (!line) continue;
    const [hash, date, author, message] = line.split('|');
    
    // Parse version number from commit message if present
    const versionMatch = message.match(/\(v?(\d+\.\d+\.\d+[^)]*)\)/) || message.match(/v(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : "3.4.x";
    
    const major = message.startsWith('feat:') || message.startsWith('major:');
    
    gitCommits.push({
      id: hash,
      date,
      version,
      author: author.toLowerCase(),
      message,
      major
    });
  }

  let addedCount = 0;
  let resolvedCount = 0;

  // Process git commits in reverse order (oldest to newest of the batch) to prepend correctly
  for (let i = gitCommits.length - 1; i >= 0; i--) {
    const gitCommit = gitCommits[i];
    
    // 1. Check if we have an entry with "PENDING" that has the same commit message
    const pendingIndex = existingCommits.findIndex(
      c => c.id === 'PENDING' && c.message.trim() === gitCommit.message.trim()
    );

    if (pendingIndex !== -1) {
      // Resolve the PENDING ID to its actual git commit hash!
      existingCommits[pendingIndex].id = gitCommit.id;
      existingCommits[pendingIndex].date = gitCommit.date;
      resolvedCount++;
      continue;
    }

    // 2. Check if this commit already exists in history (by hash or message)
    const exists = existingCommits.some(
      c => c.id === gitCommit.id || c.message.trim() === gitCommit.message.trim()
    );

    if (!exists) {
      // Prepend the new commit to our history list
      existingCommits.unshift(gitCommit);
      addedCount++;
    }
  }

  // Update lastUpdated timestamp
  historyData.lastUpdated = new Date().toISOString().split('T')[0];
  historyData.commits = existingCommits;

  fs.writeFileSync(targetPath, JSON.stringify(historyData, null, 2));
  console.log(`[sync-commit-history] Successfully updated commit-history.json. Resolved: ${resolvedCount}, Added: ${addedCount}`);
} catch (err) {
  // Fail graceful — if git commands are not supported or checkout has no history, do not fail the build
  console.warn('[sync-commit-history] Warning: Failed to automatically sync git history:', err.message);
}
