/**
 * claude-ping-check.js - PostToolUse hook for DHCP-style permit auto-renewal
 *
 * Runs after every tool use. Checks if 2 minutes have passed since the last
 * renewal and, if so, calls `node claude-sync.js renew --auto` (which renews
 * only when < 3.5 min remaining on the 5-min TTL permit, and re-acquires the
 * window's previous name if the permit expired while idle — wake recovery).
 *
 * This implements the DHCP "renewal at T/2" pattern:
 *   - Permit TTL = 5 min
 *   - Hook interval = 2 min (checked on every tool use)
 *   - renew --auto threshold = 3.5 min remaining
 *   - Result: permit renews at the first check after 1.5 min elapsed
 *
 * PER-WINDOW IDENTITY (v2.2): every Claude Code hook receives its window's
 * session_id in the stdin JSON. We pass it to claude-sync via the
 * CLAUDE_CODE_SESSION_ID env var, so claude-sync resolves THIS window's permit
 * from the session map — two windows can no longer cross-renew each other via
 * the shared .claude-session-key file. The renewal throttle file is also
 * per-window, so one window's throttle can't starve another's renewals
 * (that starvation is how Bill's permit silently expired on 2026-07-13).
 *
 * Fast path (< 2 min since last check): single file read. No Firestore hit.
 *
 * CONTEXT-SIZE NUDGE (v2.3, 2026-09-18 — adapted from ECC strategic-compact):
 * Auto-compaction fires mid-task and drops the identity/Golden-Rules context. On
 * every tool use we read the LAST assistant usage block from this window's
 * transcript (input + cache_read + cache_creation = current context size) and,
 * once it crosses a window-scaled threshold, print a one-line suggestion to run
 * /compact at the next logical boundary. Re-nudges every NUDGE_STEP tokens.
 * Cheap: reads only the tail of the transcript. Never blocks. Silent on any error.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHECK_INTERVAL_MS = 2 * 60 * 1000;  // Check every 2 minutes
const SYNC_SCRIPT = path.join(__dirname, 'claude-sync.js');

// Context window (tokens). Override with CLAUDE_CONTEXT_WINDOW; "[1m]" model ids
// are detected from the transcript's model string.
const DEFAULT_WINDOW = parseInt(process.env.CLAUDE_CONTEXT_WINDOW || '', 10) || 200000;
const NUDGE_FRACTION = 0.75;      // first nudge at 75% of window (150k on 200k)
const NUDGE_STEP = 25000;         // then every 25k tokens
const TAIL_BYTES = 256 * 1024;    // how much of the transcript tail to scan

// Ensure .claude directory exists
const dotClaudeDir = path.join(__dirname, '.claude');
if (!fs.existsSync(dotClaudeDir)) {
  fs.mkdirSync(dotClaudeDir, { recursive: true });
}

/** Read the hook's stdin JSON (Claude Code always provides it and closes the pipe). */
function readStdin(cb) {
  if (process.stdin.isTTY) return cb('');  // manual run — no hook payload
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => cb(input));
  // Safety net: never hang the agent if stdin misbehaves
  setTimeout(() => cb(input), 2000).unref();
}

/**
 * Current context size from the transcript: sum of input/cache tokens on the
 * most recent assistant message. Returns { tokens, window } or null.
 */
function readContextSize(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"usage"')) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      const msg = rec && rec.message;
      const u = msg && msg.usage;
      if (!u || msg.role !== 'assistant') continue;
      const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0)
        + (u.cache_creation_input_tokens || 0);
      let window = DEFAULT_WINDOW;
      if (/1m/i.test(String(msg.model || ''))) window = Math.max(window, 1000000);
      return { tokens, window };
    }
  } catch { /* silent — nudge is best-effort */ }
  return null;
}

/** Emit a /compact suggestion when context crosses the threshold (throttled by step). */
function maybeNudgeCompact(transcriptPath, windowId) {
  const ctx = readContextSize(transcriptPath);
  if (!ctx) return;
  const first = Math.floor(ctx.window * NUDGE_FRACTION);
  if (ctx.tokens < first) return;
  const nudgeFile = path.join(dotClaudeDir, windowId ? `.last-nudge-${windowId}` : '.last-nudge');
  let lastNudged = 0;
  try { lastNudged = parseInt(fs.readFileSync(nudgeFile, 'utf8').trim(), 10) || 0; } catch { /* first */ }
  if (lastNudged && ctx.tokens - lastNudged < NUDGE_STEP) return;
  try { fs.writeFileSync(nudgeFile, String(ctx.tokens), 'utf8'); } catch { /* ignore */ }
  const pct = Math.round((ctx.tokens / ctx.window) * 100);
  const k = Math.round(ctx.tokens / 1000);
  process.stdout.write(
    `[claude-sync] CONTEXT ${k}k tokens (${pct}% of ${Math.round(ctx.window / 1000)}k). `
    + `Auto-compaction is near and will drop identity + Golden Rules mid-task. `
    + `At the next logical boundary (task done, before a new task): write any in-flight plan `
    + `to a file or Vestige, then tell the user to run /compact. Do not run it mid-edit.\n`);
}

let done = false;
readStdin((input) => {
  if (done) return;
  done = true;

  // Window ID: prefer the hook payload, fall back to inherited env
  let windowId = process.env.CLAUDE_CODE_SESSION_ID || '';
  let transcriptPath = '';
  try {
    const data = JSON.parse(input);
    if (data.session_id) windowId = data.session_id;
    if (data.transcript_path) transcriptPath = data.transcript_path;
  } catch { /* no/invalid payload — env fallback stands */ }

  // Context-size nudge runs on EVERY tool use (cheap tail read), before the renew throttle
  maybeNudgeCompact(transcriptPath, windowId);

  // Per-window throttle file: a shared one would let window A's ping suppress
  // window B's renewals entirely.
  const pingFile = path.join(dotClaudeDir, windowId ? `.last-ping-${windowId}` : '.last-ping');

  let lastPingMs = 0;
  try {
    lastPingMs = parseInt(fs.readFileSync(pingFile, 'utf8').trim(), 10) || 0;
  } catch { /* first run */ }

  const nowMs = Date.now();
  if (nowMs - lastPingMs < CHECK_INTERVAL_MS) {
    process.exit(0);  // Fast path: not time yet
  }

  // Update timestamp FIRST to avoid retry spam on network errors
  fs.writeFileSync(pingFile, String(nowMs), 'utf8');

  try {
    const output = execSync(`node "${SYNC_SCRIPT}" renew --auto`, {
      encoding: 'utf8',
      timeout: 15000,
      cwd: __dirname,
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: windowId }
    });
    if (output.trim()) {
      // Wake-recovery notices (re-acquired name / IDENTITY CHANGED) surface here
      process.stdout.write(output);
    }
  } catch {
    // Network error or timeout — .last-ping already updated, avoid retry spam
  }
  process.exit(0);
});
