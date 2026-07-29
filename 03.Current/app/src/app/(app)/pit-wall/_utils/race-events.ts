// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing (pure functions over caller-supplied snapshots)
// Writes:      nothing
// Errors:      none — every export is total; malformed input yields no events
// Idempotent:  yes (same prev/next pair always yields the same events)
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: PW_RACE_EVENTS-000-v01
// [Intent] FEAT-PW-020 (Battle Engine) — turn consecutive Pit Wall data snapshots into EVENTS:
//          overtakes (with corner attribution), battles forming/ending, pit entries/exits and
//          fastest laps. The premise: OpenF1 lands seconds behind the track while TV streams run
//          30-60s behind, and the TV director shows ONE event at a time — this layer watches all
//          of them and tells the fan where to look. Pure functions so detection is testable and
//          runs identically over live, delayed (TV-sync) and replay streams.
// [Inbound Trigger] useRaceEvents, once per data tick.
// [Downstream Impact] Events drive the RaceEventTicker, the tower's ▲/▼ arrows (via the
//          positionChange diff this module computes) and the click-to-follow camera.
//
// GR#15: corner positions are DERIVED from the accumulated circuit path geometry (curvature
// analysis), not from a hardcoded per-circuit table — a brand-new circuit gets numbered corners
// the moment its outline is traced. Numbering is sequential from the start/finish line and may
// differ from the FIA's official numbering where a chicane is one corner rather than two; it is
// consistent within a session, which is what a "T4" label needs.

import type { DriverRaceState, CircuitPoint } from '../_types/pit-wall.types';

export type RaceEventKind =
  | 'overtake'
  | 'battle_forming'
  | 'battle_over'
  | 'pit_in'
  | 'pit_out'
  | 'fastest_lap';

export interface RaceEvent {
  id: string;
  kind: RaceEventKind;
  /** Wall-clock ms when detected (data-stream time, so a delayed stream yields delayed events). */
  at: number;
  /** Primary driver — the one the camera should fly to. */
  driverNumber: number;
  driverCode: string;
  teamColour: string;
  /** Secondary driver (the car overtaken / the other half of a battle). */
  otherDriverNumber?: number;
  otherDriverCode?: string;
  /** Human line, e.g. "VER passed LEC into T4" — built here so every surface says the same thing. */
  message: string;
  lap: number | null;
  corner: number | null;
}

export interface Corner {
  /** 1-based, numbered along the lap from the start/finish line. */
  number: number;
  x: number;
  y: number;
}

// ── Corner derivation ─────────────────────────────────────────────

// GUID: PW_RACE_EVENTS-001-v01
// [Intent] Derive numbered corners from the traced circuit outline by curvature analysis:
//          resample the path to even spacing, measure heading change over a sliding window,
//          and cluster contiguous high-curvature spans into single corners (apex = max bend).
//          Numbering starts at the point nearest the S/F line when known, else the path start.
// [Inbound Trigger] useRaceEvents memo, when the circuit path or S/F line changes.
// [Downstream Impact] Corner attribution in overtake messages. Returns [] for short paths —
//          callers must tolerate corner: null.
// SCALE-FREE by design: OpenF1's projected x/y units are unspecified (and differ per circuit),
// so nothing here may assume metres. The lap is resampled to a fixed COUNT of points and the
// heading window/threshold are expressed in samples — the same geometry falls out whatever the
// units. Verified against replayed race 11342, where metre-assuming thresholds found 0 corners.
const RESAMPLE_TARGET = 220;       // samples per lap, units-independent
const HEADING_WINDOW = 4;          // samples each side (~1/27 lap) for heading measurement
const CORNER_THRESHOLD_RAD = 0.35; // ~20° of heading change across the window = corner territory
const MIN_CORNER_GAP_PTS = 3;      // clusters closer than this merge into one corner

export function deriveCorners(path: CircuitPoint[], sfX: number | null, sfY: number | null): Corner[] {
  if (path.length < 40) return [];

  // Total lap length in whatever units the path uses, skipping discovery-gap jumps
  // (any segment > 20x the median is a data gap, not track).
  const segLens: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const L = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (isFinite(L) && L > 0) segLens.push(L);
  }
  if (segLens.length < 20) return [];
  const median = [...segLens].sort((a, b) => a - b)[Math.floor(segLens.length / 2)];
  const gapCutoff = median * 20;
  const totalLen = segLens.reduce((s, L) => s + (L < gapCutoff ? L : 0), 0);
  if (totalLen <= 0) return [];
  const step = totalLen / RESAMPLE_TARGET;

  // Resample to even arc-length spacing so curvature is comparable everywhere.
  const pts: CircuitPoint[] = [path[0]];
  let carried = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    const segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (!isFinite(segLen) || segLen <= 0 || segLen >= gapCutoff) continue;
    let t = step - carried;
    while (t <= segLen) {
      const f = t / segLen;
      pts.push({ x: prev.x + (cur.x - prev.x) * f, y: prev.y + (cur.y - prev.y) * f });
      t += step;
    }
    carried = (carried + segLen) % step;
  }
  if (pts.length < 2 * HEADING_WINDOW + 8) return [];

  // Unsigned heading change across a window centred on each point (the loop is closed).
  const n = pts.length;
  const bend = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - HEADING_WINDOW + n) % n];
    const b = pts[i];
    const c = pts[(i + HEADING_WINDOW) % n];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    bend[i] = Math.abs(d);
  }

  // Rotate so index 0 sits at the S/F line — corner numbers then follow the lap.
  let startIdx = 0;
  if (sfX !== null && sfY !== null) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d2 = (pts[i].x - sfX) ** 2 + (pts[i].y - sfY) ** 2;
      if (d2 < best) { best = d2; startIdx = i; }
    }
  }

  // Cluster contiguous above-threshold spans; apex = the span's max-bend point.
  const corners: Corner[] = [];
  let inCorner = false;
  let apexIdx = -1;
  let apexBend = 0;
  let lastCornerEnd = -Infinity;
  for (let step = 0; step < n; step++) {
    const i = (startIdx + step) % n;
    if (bend[i] >= CORNER_THRESHOLD_RAD) {
      if (!inCorner && step - lastCornerEnd <= MIN_CORNER_GAP_PTS && corners.length > 0) {
        // Re-entering bend territory immediately after a corner — same complex, keep extending.
        inCorner = true;
      } else if (!inCorner) {
        inCorner = true;
        apexIdx = i;
        apexBend = bend[i];
      }
      if (bend[i] > apexBend) { apexBend = bend[i]; apexIdx = i; }
    } else if (inCorner) {
      inCorner = false;
      lastCornerEnd = step;
      corners.push({ number: corners.length + 1, x: pts[apexIdx].x, y: pts[apexIdx].y });
      apexBend = 0;
    }
  }
  if (inCorner && apexIdx >= 0) {
    corners.push({ number: corners.length + 1, x: pts[apexIdx].x, y: pts[apexIdx].y });
  }

  // Sanity: real circuits have ~8-20 corners. Outside that, the path is too noisy to trust —
  // return [] so overtakes degrade to no corner label rather than a wrong one.
  if (corners.length < 4 || corners.length > 30) return [];
  return corners;
}

// GUID: PW_RACE_EVENTS-002-v01
// [Intent] Nearest derived corner to a point, within a plausibility radius — an overtake on a
//          long straight should say nothing rather than name the corner 300m behind.
// [Inbound Trigger] Overtake event construction.
export function nearestCorner(corners: Corner[], x: number, y: number): Corner | null {
  let best: Corner | null = null;
  let bestD2 = Infinity;
  for (const c of corners) {
    const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  if (!best || corners.length < 2) return best;
  // Scale-free plausibility: an overtake on a long straight should say nothing rather than name
  // the corner far behind. "Near" = within half the typical inter-corner spacing.
  let spacingSum = 0;
  for (let i = 1; i < corners.length; i++) {
    spacingSum += Math.hypot(corners[i].x - corners[i - 1].x, corners[i].y - corners[i - 1].y);
  }
  const halfSpacing = (spacingSum / (corners.length - 1)) / 2;
  return bestD2 <= halfSpacing * halfSpacing ? best : null;
}

// GUID: PW_RACE_EVENTS-003-v01
// [Intent] Parse OpenF1's interval string ("+1.234") to seconds. "1 LAP"/"2 LAPS"/null → null,
//          because lapped cars are not in a battle with the car ahead in any meaningful sense.
export function parseIntervalSeconds(interval: string | null): number | null {
  if (!interval) return null;
  const m = /^\+?(\d+(?:\.\d+)?)$/.exec(interval.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isFinite(v) ? v : null;
}

// ── Per-tick detection ────────────────────────────────────────────

export interface PositionDiff {
  /** driverNumber -> places gained (+) / lost (-) since the previous snapshot. */
  changes: Map<number, number>;
  events: RaceEvent[];
}

let eventSeq = 0;
function nextId(kind: string): string {
  return `evt-${kind}-${++eventSeq}`;
}

// GUID: PW_RACE_EVENTS-004-v01
// [Intent] Diff two snapshots: per-driver position deltas (feeds the tower's ▲/▼ arrows, which
//          existed since v2.x but were never fed — positionChange was hard-coded 0 in every data
//          path) plus overtake / pit / fastest-lap events.
//          Noise rules, each earned:
//          - pairs where either car is in the pit lane are position CHANGES, not on-track
//            overtakes — excluded from overtake events (the pit_in/pit_out events cover them);
//          - lap 0/1 shuffling (grid formation, race start) is excluded — a race start is not
//            nine separate "overtakes";
//          - a tick with more than MAX_PASSES_PER_TICK passes is a data glitch or a red-flag
//            reorder; the whole tick's overtake set is dropped (deltas still apply).
// [Inbound Trigger] useRaceEvents on every data tick where prev and next share a session.
// [Downstream Impact] Events feed the ticker; changes feed the enriched driver array.
const MAX_PASSES_PER_TICK = 6;

/** A pass observed on one tick, held until the NEXT tick confirms the order stuck. */
export interface PendingPass {
  aNumber: number;
  bNumber: number;
  /** GPS + lap captured at the moment of the pass, for corner attribution. */
  x: number | null;
  y: number | null;
  lap: number | null;
  position: number;
}

/** How long a car stays "pit-tainted" after being seen in the pit lane. Position changes against
 *  a pit-cycling car are real but they are NOT on-track overtakes — and the inPit flag alone
 *  misses transition ticks, which is exactly where the swaps register. Tuned against replayed
 *  race 11342: without this window, 20 pit stops inflated 211 "overtakes". */
const RECENT_PIT_WINDOW_MS = 60_000;

export function diffSnapshots(
  prev: DriverRaceState[],
  next: DriverRaceState[],
  corners: Corner[],
  now: number,
  pending: PendingPass[],
  recentPitAt: Map<number, number>,
): PositionDiff & { pending: PendingPass[] } {
  const changes = new Map<number, number>();
  const events: RaceEvent[] = [];
  if (prev.length === 0 || next.length === 0) return { changes, events, pending: [] };

  const prevBy = new Map(prev.map(d => [d.driverNumber, d]));
  const nextBy = new Map(next.map(d => [d.driverNumber, d]));

  // Refresh the pit-taint window before judging any pass.
  for (const d of next) {
    if (d.inPit) recentPitAt.set(d.driverNumber, now);
  }
  const pitTainted = (n: number) => now - (recentPitAt.get(n) ?? -Infinity) < RECENT_PIT_WINDOW_MS;

  for (const d of next) {
    const p = prevBy.get(d.driverNumber);
    if (!p || !p.position || !d.position) continue;
    const delta = p.position - d.position; // + = gained places
    if (delta !== 0) changes.set(d.driverNumber, delta);
  }

  // TICK-CONFIRMED OVERTAKES (tuned against replayed race 11342, which produced 214 raw passes —
  // position flicker and pit cycles inflate a realistic ~60-90 badly). A pass candidate is
  // recorded when A moves ahead of B; the EVENT only fires on the following tick if A is still
  // ahead. Costs one poll interval of latency (~5s live) — still half a minute ahead of the TV.
  for (const cand of pending) {
    const a = nextBy.get(cand.aNumber);
    const b = nextBy.get(cand.bNumber);
    if (!a || !b || !a.position || !b.position) continue;
    if (a.position >= b.position) continue; // reverted — flicker, not a pass
    if (a.inPit || b.inPit || a.retired || b.retired) continue;
    if (pitTainted(a.driverNumber) || pitTainted(b.driverNumber)) continue;
    if (events.filter(e => e.kind === 'overtake').length >= MAX_PASSES_PER_TICK) break;
    const corner = cand.x !== null && cand.y !== null ? nearestCorner(corners, cand.x, cand.y) : null;
    events.push({
      id: nextId('ot'),
      kind: 'overtake',
      at: now,
      driverNumber: a.driverNumber,
      driverCode: a.driverCode,
      teamColour: a.teamColour,
      otherDriverNumber: b.driverNumber,
      otherDriverCode: b.driverCode,
      message: corner
        ? `${a.driverCode} passed ${b.driverCode} into T${corner.number} — P${a.position}`
        : `${a.driverCode} passed ${b.driverCode} — P${a.position}`,
      lap: cand.lap,
      corner: corner?.number ?? null,
    });
  }

  // Collect this tick's new candidates for the next tick to confirm.
  const newPending: PendingPass[] = [];
  for (const a of next) {
    const pa = prevBy.get(a.driverNumber);
    if (!pa || !pa.position || !a.position) continue;
    if (a.position >= pa.position) continue; // only gainers initiate
    if (a.inPit || pa.inPit || a.retired || a.currentLap <= 1) continue;
    if (pitTainted(a.driverNumber)) continue;
    for (const b of next) {
      if (b.driverNumber === a.driverNumber) continue;
      const pb = prevBy.get(b.driverNumber);
      if (!pb || !pb.position || !b.position) continue;
      if (b.inPit || pb.inPit || b.retired) continue;
      if (pitTainted(b.driverNumber)) continue;
      if (pa.position > pb.position && a.position < b.position) {
        newPending.push({
          aNumber: a.driverNumber, bNumber: b.driverNumber,
          x: a.x, y: a.y, lap: a.currentLap || null, position: a.position,
        });
      }
    }
  }

  // Pit entry / exit.
  for (const d of next) {
    const p = prevBy.get(d.driverNumber);
    if (!p) continue;
    if (d.currentLap <= 1) continue; // formation/grid churn is not a pit stop story
    if (!p.inPit && d.inPit) {
      events.push({
        id: nextId('pin'), kind: 'pit_in', at: now,
        driverNumber: d.driverNumber, driverCode: d.driverCode, teamColour: d.teamColour,
        message: `${d.driverCode} into the pits from P${p.position}`,
        lap: d.currentLap || null, corner: null,
      });
    } else if (p.inPit && !d.inPit) {
      events.push({
        id: nextId('pout'), kind: 'pit_out', at: now,
        driverNumber: d.driverNumber, driverCode: d.driverCode, teamColour: d.teamColour,
        message: `${d.driverCode} out of the pits in P${d.position}${d.tyreCompound && d.tyreCompound !== 'UNKNOWN' ? ` on ${String(d.tyreCompound).toLowerCase()}s` : ''}`,
        lap: d.currentLap || null, corner: null,
      });
    }
  }

  // Fastest lap: the session-best holder changed.
  const prevHolder = prev.find(d => d.fastestLap)?.driverNumber ?? null;
  const nextHolderDriver = next.find(d => d.fastestLap) ?? null;
  if (nextHolderDriver && nextHolderDriver.driverNumber !== prevHolder && nextHolderDriver.bestLapTime) {
    const t = nextHolderDriver.bestLapTime;
    const mins = Math.floor(t / 60);
    const secs = (t - mins * 60).toFixed(3).padStart(6, '0');
    events.push({
      id: nextId('fl'), kind: 'fastest_lap', at: now,
      driverNumber: nextHolderDriver.driverNumber,
      driverCode: nextHolderDriver.driverCode,
      teamColour: nextHolderDriver.teamColour,
      message: `${nextHolderDriver.driverCode} fastest lap — ${mins}:${secs}`,
      lap: nextHolderDriver.currentLap || null, corner: null,
    });
  }

  return { changes, events, pending: newPending };
}

// ── Battle radar ──────────────────────────────────────────────────

export interface BattleState {
  /** chaser driverNumber -> recent interval samples (newest last). */
  gapHistory: Map<number, number[]>;
  /** chaser driverNumbers currently flagged as in a battle. */
  active: Set<number>;
  /** chaser driverNumber -> `at` of the last battle_forming, for the re-fire cooldown. */
  lastFormedAt: Map<number, number>;
}

export function createBattleState(): BattleState {
  return { gapHistory: new Map(), active: new Set(), lastFormedAt: new Map() };
}

// GUID: PW_RACE_EVENTS-005-v01
// [Intent] The predictive half of the Battle Engine. A battle FORMS when a car is within
//          BATTLE_GAP_S of the car ahead and the gap has closed monotonically-ish across the
//          last BATTLE_TREND_SAMPLES samples — the fan learns a fight is brewing before the TV
//          director cuts to it, because this watches all the gaps at once and he doesn't.
//          A battle ENDS when the gap opens past BATTLE_OVER_S (dropped back or pass completed —
//          the overtake event covers the pass itself) or either car pits/retires.
// [Inbound Trigger] useRaceEvents on every tick, after diffSnapshots.
// [Downstream Impact] battle_forming / battle_over events; the active set drives amber battle
//          pips between tower rows. History is capped so a whole race costs a few hundred floats.
const BATTLE_GAP_S = 1.0;
const BATTLE_OVER_S = 2.0;
const BATTLE_TREND_SAMPLES = 4;
const GAP_HISTORY_CAP = 8;
/** After battle_forming, the same chaser cannot re-fire for this long — tuned against replayed
 *  race 11342, where hysteresis alone produced 188 formings from gap oscillation around the
 *  thresholds. */
const BATTLE_REFIRE_COOLDOWN_MS = 180_000;

export function updateBattles(state: BattleState, next: DriverRaceState[], now: number): RaceEvent[] {
  const events: RaceEvent[] = [];
  const byPosition = [...next].filter(d => d.position > 0 && !d.retired).sort((a, b) => a.position - b.position);
  const seen = new Set<number>();

  for (let i = 1; i < byPosition.length; i++) {
    const chaser = byPosition[i];
    const ahead = byPosition[i - 1];
    seen.add(chaser.driverNumber);
    const gap = parseIntervalSeconds(chaser.intervalToAhead);

    const history = state.gapHistory.get(chaser.driverNumber) ?? [];
    if (gap !== null) {
      history.push(gap);
      if (history.length > GAP_HISTORY_CAP) history.shift();
      state.gapHistory.set(chaser.driverNumber, history);
    }

    const inBattleRange = gap !== null && gap <= BATTLE_GAP_S && !chaser.inPit && !ahead.inPit
      && chaser.currentLap > 2; // the opening laps are nose-to-tail by definition, not twenty battles
    const closing =
      history.length >= BATTLE_TREND_SAMPLES &&
      history[history.length - 1] < history[history.length - BATTLE_TREND_SAMPLES];
    const cooledDown = now - (state.lastFormedAt.get(chaser.driverNumber) ?? -Infinity) > BATTLE_REFIRE_COOLDOWN_MS;

    if (inBattleRange && (closing || (gap !== null && gap <= 0.6)) && !state.active.has(chaser.driverNumber) && cooledDown) {
      state.active.add(chaser.driverNumber);
      state.lastFormedAt.set(chaser.driverNumber, now);
      events.push({
        id: nextId('bf'), kind: 'battle_forming', at: now,
        driverNumber: chaser.driverNumber, driverCode: chaser.driverCode, teamColour: chaser.teamColour,
        otherDriverNumber: ahead.driverNumber, otherDriverCode: ahead.driverCode,
        message: `Battle for P${ahead.position}: ${chaser.driverCode} closing on ${ahead.driverCode} (${gap!.toFixed(1)}s)`,
        lap: chaser.currentLap || null, corner: null,
      });
    } else if (state.active.has(chaser.driverNumber)) {
      const over = gap === null || gap > BATTLE_OVER_S || chaser.inPit || ahead.inPit || chaser.retired;
      if (over) {
        // State transition only — no ticker row. Verified against race 11342: emitting these
        // added 141 low-value "drops away" rows; the ⚔ pip disappearing tells the same story.
        state.active.delete(chaser.driverNumber);
      }
    }
  }

  // Drop state for drivers no longer running so a retirement doesn't leave a ghost battle.
  for (const num of [...state.active]) {
    if (!seen.has(num)) state.active.delete(num);
  }
  return events;
}
