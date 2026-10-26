// GUID: LIB_CHEAT_CHECK-000-v01
// [Intent] Central integrity-checking library for suspicious player behaviour: predictions
//   submitted after the official deadline, and login IPs shared across multiple distinct
//   accounts (possible multi-accounting/collusion). Pure, read-only functions — no Firestore
//   writes, no network calls. Mirrors the shape of lib/consistency.ts (CheckResult pattern)
//   but for behavioural/timing signals rather than data-shape invariants.
// [Inbound Trigger] Called by /api/admin/cheat-check (Admin SDK data already fetched there).
// [Downstream Impact] Drives the admin "Cheat Check" panel (CheatCheckManager.tsx). Every
//   finding here is a SIGNAL to investigate, not a verdict — see each check's caveat text.

// GUID: LIB_CHEAT_CHECK-001-v01
// [Intent] The fixed, user-facing description of every check this module runs — shown in the
//   admin UI BEFORE a run (so the admin knows what they're about to trigger) and returned
//   alongside the results (so a screenshot of findings is self-documenting).
// [Inbound Trigger] Read by the admin panel and by the API route's summary response.
// [Downstream Impact] Adding a new check function below requires adding its entry here too.
export const CHEAT_CHECK_DEFINITIONS = [
  {
    id: 'late-submissions',
    label: 'Late submissions',
    description:
      "Compares every prediction's submission time against that race's official deadline " +
      '(qualifying or sprint-qualifying lock). System-generated carry-forward predictions are ' +
      'excluded — only predictions a player actually submitted are checked. A late submission ' +
      'that falls inside a logged admin pit-lane-reopen window is shown as explained, not flagged.',
  },
  {
    id: 'shared-login-ips',
    label: 'Shared login IPs',
    description:
      'Groups successful logins by IP address and flags any IP used by two or more distinct, ' +
      'non-admin accounts — a possible sign of one person running multiple teams. Note: this is ' +
      'a weak signal on its own (flatmates, family, or a shared office/campus connection produce ' +
      'the same pattern) and is not proof of anything by itself.',
  },
] as const;

export type CheatCheckId = (typeof CHEAT_CHECK_DEFINITIONS)[number]['id'];

// GUID: LIB_CHEAT_CHECK-002-v01
export type CheatSeverity = 'flag' | 'info';

export interface CheatFinding {
  checkId: CheatCheckId;
  severity: CheatSeverity;
  summary: string;
  detail: string;
}

export interface CheatCheckResult {
  checkId: CheatCheckId;
  label: string;
  description: string;
  flagCount: number;
  infoCount: number;
  findings: CheatFinding[];
}

export interface CheatCheckSummary {
  correlationId: string;
  timestamp: string;
  results: CheatCheckResult[];
  totalFlags: number;
  totalInfo: number;
}

// ─── Inputs (shaped from Firestore reads the API route performs) ───────────

export interface PredictionRow {
  path: string;
  teamName: string;
  userId: string;
  raceId: string; // as stored, e.g. "Chinese-Grand-Prix-GP" or "Chinese-Grand-Prix-Sprint"
  submittedAtMs: number | null;
  isCarryForward?: boolean;
}

export interface RaceDeadline {
  id: string; // race_schedule doc id, e.g. "chinese-grand-prix"
  qualifyingTimeMs: number | null;
  sprintTimeMs: number | null;
}

export interface PitLaneOverrideEvent {
  action: 'open' | 'close';
  atMs: number;
  adminEmail?: string;
}

export interface LoginEvent {
  email: string;
  ip: string;
}

export interface UserSummary {
  email: string;
  teamName: string;
  isAdmin: boolean;
}

// GUID: LIB_CHEAT_CHECK-003-v01
// [Intent] Reduce a flat list of pit-lane override audit events into open->close windows,
//   so a late submission that happened while the lane was deliberately reopened can be
//   distinguished from one that slipped through unexplained.
// [Inbound Trigger] checkLateSubmissions() before scanning predictions.
// [Downstream Impact] A window with no matching close is treated as open-ended (still open),
//   e.g. if the admin reopened it and this check runs before closing it again.
function buildOverrideWindows(events: PitLaneOverrideEvent[]): Array<{ startMs: number; endMs: number; adminEmail?: string }> {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const windows: Array<{ startMs: number; endMs: number; adminEmail?: string }> = [];
  let openAt: { atMs: number; adminEmail?: string } | null = null;
  for (const ev of sorted) {
    if (ev.action === 'open' && !openAt) {
      openAt = { atMs: ev.atMs, adminEmail: ev.adminEmail };
    } else if (ev.action === 'close' && openAt) {
      windows.push({ startMs: openAt.atMs, endMs: ev.atMs, adminEmail: openAt.adminEmail });
      openAt = null;
    }
  }
  if (openAt) {
    windows.push({ startMs: openAt.atMs, endMs: Date.now(), adminEmail: openAt.adminEmail });
  }
  return windows;
}

// GUID: LIB_CHEAT_CHECK-004-v01
// [Intent] Flag genuinely late predictions (submitted after the race's deadline), excluding
//   carry-forward docs (system-written, not a player action) and auto-explaining any late
//   submission that falls inside a logged admin pit-lane-reopen window.
// [Inbound Trigger] cheat-check API route, after fetching predictions + race_schedule + the
//   pit_lane_force_opened/closed audit_logs slice.
// [Downstream Impact] A 'flag' finding here means a prediction was accepted after the server's
//   own deadline check should have rejected it — worth checking for a bug, not just a cheat.
export function checkLateSubmissions(
  predictions: PredictionRow[],
  schedule: Record<string, RaceDeadline>,
  overrideEvents: PitLaneOverrideEvent[]
): CheatFinding[] {
  const windows = buildOverrideWindows(overrideEvents);
  const findings: CheatFinding[] = [];

  for (const p of predictions) {
    if (p.isCarryForward) continue;
    if (p.submittedAtMs === null) continue;

    const raceIdLower = p.raceId.toLowerCase();
    const isSprint = raceIdLower.includes('sprint');
    const base = raceIdLower.replace(/-gp$/, '').replace(/-sprint$/, '');
    const sched = schedule[base];
    if (!sched) continue; // unknown race id — not this check's job to flag

    const deadlineMs = isSprint && sched.sprintTimeMs ? sched.sprintTimeMs : sched.qualifyingTimeMs;
    if (deadlineMs === null || p.submittedAtMs <= deadlineMs) continue;

    const lateByMin = Math.round((p.submittedAtMs - deadlineMs) / 60000);
    const explainedBy = windows.find(w => p.submittedAtMs! >= w.startMs && p.submittedAtMs! <= w.endMs);

    if (explainedBy) {
      findings.push({
        checkId: 'late-submissions',
        severity: 'info',
        summary: `${p.teamName} — ${p.raceId} submitted ${lateByMin}m late (admin-authorised window)`,
        detail: `Submitted at ${new Date(p.submittedAtMs).toISOString()}, ${lateByMin} minute(s) after the ` +
          `official deadline, but inside a pit-lane-reopen window opened by ${explainedBy.adminEmail ?? 'an admin'} ` +
          `(${new Date(explainedBy.startMs).toISOString()} → ${new Date(explainedBy.endMs).toISOString()}). Not a concern.`,
      });
    } else {
      findings.push({
        checkId: 'late-submissions',
        severity: 'flag',
        summary: `${p.teamName} — ${p.raceId} submitted ${lateByMin}m after deadline (unexplained)`,
        detail: `Submitted at ${new Date(p.submittedAtMs).toISOString()}, ${lateByMin} minute(s) after the ` +
          `official deadline (${new Date(deadlineMs).toISOString()}), with no matching admin pit-lane-reopen ` +
          `window on record. The server-side deadline check should have rejected this — worth checking ` +
          `whether it's a lockout bug (e.g. clock skew) or a genuinely late accepted submission. Doc: ${p.path}`,
      });
    }
  }

  return findings;
}

// GUID: LIB_CHEAT_CHECK-005-v01
// [Intent] Flag IP addresses used to successfully log in to 2+ distinct accounts, excluding
//   groups where any member account is an admin (admins routinely test from multiple seed
//   accounts on their own connection — a known, benign pattern, not a signal).
// [Inbound Trigger] cheat-check API route, after fetching login_success audit_logs + users.
// [Downstream Impact] A 'flag' finding here is a lead, not a verdict — always read the caveat.
export function checkSharedLoginIPs(
  events: LoginEvent[],
  usersByEmail: Record<string, UserSummary>
): CheatFinding[] {
  const ipToEmails = new Map<string, Set<string>>();
  for (const ev of events) {
    if (!ev.ip || !ev.email) continue;
    if (!ipToEmails.has(ev.ip)) ipToEmails.set(ev.ip, new Set());
    ipToEmails.get(ev.ip)!.add(ev.email);
  }

  const findings: CheatFinding[] = [];
  for (const [ip, emailSet] of ipToEmails) {
    if (emailSet.size < 2) continue;
    const emails = [...emailSet];
    const members = emails.map(e => usersByEmail[e]).filter(Boolean) as UserSummary[];
    const anyAdmin = members.some(m => m.isAdmin);

    const teamNames = members.length ? members.map(m => m.teamName).join(', ') : emails.join(', ');

    findings.push({
      checkId: 'shared-login-ips',
      severity: anyAdmin ? 'info' : 'flag',
      summary: anyAdmin
        ? `IP shared by ${emailSet.size} accounts including an admin — likely dev/test, not flagged`
        : `IP shared by ${emailSet.size} distinct accounts: ${teamNames}`,
      detail: anyAdmin
        ? `${ip} was used to log in to ${emailSet.size} accounts (${emails.join(', ')}), one of which is an ` +
          `admin account. Admins routinely sign in to test/seed accounts from their own connection — treated ` +
          `as benign and not flagged.`
        : `${ip} was used to log in to ${emailSet.size} distinct player accounts (${emails.join(', ')}). This ` +
          `could be flatmates/family on the same home connection, a shared office/campus network, or one ` +
          `person running more than one team. Worth a quick human look, not an automatic verdict.`,
    });
  }

  return findings;
}

// GUID: LIB_CHEAT_CHECK-006-v01
// [Intent] Combine every check's findings into the one summary object the API route returns
//   and the admin panel renders.
// [Inbound Trigger] cheat-check API route, after running both check functions above.
// [Downstream Impact] CheatCheckManager.tsx renders this shape directly.
export function generateCheatCheckSummary(correlationId: string, findingsByCheck: Record<CheatCheckId, CheatFinding[]>): CheatCheckSummary {
  const results: CheatCheckResult[] = CHEAT_CHECK_DEFINITIONS.map(def => {
    const findings = findingsByCheck[def.id] ?? [];
    return {
      checkId: def.id,
      label: def.label,
      description: def.description,
      flagCount: findings.filter(f => f.severity === 'flag').length,
      infoCount: findings.filter(f => f.severity === 'info').length,
      findings,
    };
  });

  return {
    correlationId,
    timestamp: new Date().toISOString(),
    results,
    totalFlags: results.reduce((sum, r) => sum + r.flagCount, 0),
    totalInfo: results.reduce((sum, r) => sum + r.infoCount, 0),
  };
}
