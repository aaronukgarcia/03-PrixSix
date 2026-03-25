// GUID: LIB_PITWALL_METRICS-000-v01
// [Intent] Process health metrics module for Pit Wall admin monitoring.
//          Tracks Node.js process metrics (heap, RSS, CPU, event loop lag),
//          maintains high-water marks, and records per-user replay access counts.
//          All state is module-level — safe because Firebase App Hosting runs
//          a persistent single-instance Node.js process (maxInstances: 1).
// [Inbound Trigger] Imported by pit-wall-health route and PitWallManager admin component.
// [Downstream Impact] Provides observability data for admin dashboard.

// GUID: LIB_PITWALL_METRICS-001-v01
// [Intent] Process metrics snapshot — heap, RSS, CPU, uptime.
export interface ProcessSnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  heapUsedPct: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  uptimeSeconds: number;
  eventLoopLagMs: number;
}

// GUID: LIB_PITWALL_METRICS-002-v01
// [Intent] High-water marks — peak values observed since process start or last reset.
export interface HighWaterMarks {
  peakHeapUsedMB: number;
  peakRssMB: number;
  peakEventLoopLagMs: number;
}

// GUID: LIB_PITWALL_METRICS-003-v01
// [Intent] Per-user replay access tracking.
export interface ReplayAccessEntry {
  userId: string;
  count: number;
  lastAccessedAt: number;
}

export interface ReplayStats {
  totalAccesses: number;
  uniqueUsers: number;
  byUser: ReplayAccessEntry[];
}

export interface FullMetrics {
  process: ProcessSnapshot;
  highWaterMarks: HighWaterMarks;
  replay: ReplayStats;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

let hwm: HighWaterMarks = {
  peakHeapUsedMB: 0,
  peakRssMB: 0,
  peakEventLoopLagMs: 0,
};

let lastEventLoopLagMs = 0;

// GUID: LIB_PITWALL_METRICS-004-v01
// [Intent] Event loop lag sampler — fires setTimeout(0) every 5s and measures
//          the actual delay vs expected 0ms. High lag indicates the event loop
//          is saturated (blocked by CPU-intensive work or too many concurrent ops).
let samplerHandle: ReturnType<typeof setTimeout> | null = null;

function sampleEventLoopLag(): void {
  const start = Date.now();
  samplerHandle = setTimeout(() => {
    const lag = Date.now() - start;
    // Subtract the expected 0ms — the raw lag IS the measurement
    lastEventLoopLagMs = lag;

    // Update high-water marks on every sample
    const mem = process.memoryUsage();
    const heapMB = toMB(mem.heapUsed);
    const rssMB = toMB(mem.rss);

    if (heapMB > hwm.peakHeapUsedMB) hwm.peakHeapUsedMB = heapMB;
    if (rssMB > hwm.peakRssMB) hwm.peakRssMB = rssMB;
    if (lag > hwm.peakEventLoopLagMs) hwm.peakEventLoopLagMs = lag;

    // Schedule next sample
    sampleEventLoopLag();
  }, 5000);

  // Ensure the timer doesn't prevent process exit
  if (samplerHandle && typeof samplerHandle === 'object' && 'unref' in samplerHandle) {
    samplerHandle.unref();
  }
}

// Start sampling on module import
sampleEventLoopLag();

// ---------------------------------------------------------------------------
// Replay tracking
// ---------------------------------------------------------------------------

const MAX_REPLAY_ENTRIES = 100;
const replayAccessLog = new Map<string, { count: number; lastAccessedAt: number }>();

// GUID: LIB_PITWALL_METRICS-005-v01
// [Intent] Record a replay access for a user. Called by replay API routes.
//          Capped at MAX_REPLAY_ENTRIES to prevent unbounded memory growth.
export function trackReplayAccess(userId: string): void {
  const existing = replayAccessLog.get(userId);
  if (existing) {
    existing.count++;
    existing.lastAccessedAt = Date.now();
  } else {
    // Evict LRU if at capacity
    if (replayAccessLog.size >= MAX_REPLAY_ENTRIES) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, val] of replayAccessLog) {
        if (val.lastAccessedAt < oldestTime) {
          oldestTime = val.lastAccessedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) replayAccessLog.delete(oldestKey);
    }
    replayAccessLog.set(userId, { count: 1, lastAccessedAt: Date.now() });
  }
}

export function getReplayStats(): ReplayStats {
  let totalAccesses = 0;
  const byUser: ReplayAccessEntry[] = [];

  for (const [userId, entry] of replayAccessLog) {
    totalAccesses += entry.count;
    byUser.push({ userId, count: entry.count, lastAccessedAt: entry.lastAccessedAt });
  }

  // Sort by count descending
  byUser.sort((a, b) => b.count - a.count);

  return {
    totalAccesses,
    uniqueUsers: replayAccessLog.size,
    byUser,
  };
}

// ---------------------------------------------------------------------------
// Process snapshot
// ---------------------------------------------------------------------------

export function getProcessMetrics(): ProcessSnapshot {
  const mem = process.memoryUsage();
  const heapUsedMB = toMB(mem.heapUsed);
  const heapTotalMB = toMB(mem.heapTotal);

  return {
    heapUsedMB,
    heapTotalMB,
    heapUsedPct: heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 1000) / 10 : 0,
    rssMB: toMB(mem.rss),
    externalMB: toMB(mem.external),
    arrayBuffersMB: toMB(mem.arrayBuffers),
    uptimeSeconds: Math.round(process.uptime()),
    eventLoopLagMs: lastEventLoopLagMs,
  };
}

export function getHighWaterMarks(): HighWaterMarks {
  return { ...hwm };
}

// ---------------------------------------------------------------------------
// Combined getter
// ---------------------------------------------------------------------------

export function getFullMetrics(): FullMetrics {
  return {
    process: getProcessMetrics(),
    highWaterMarks: getHighWaterMarks(),
    replay: getReplayStats(),
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function resetMetrics(): void {
  hwm = { peakHeapUsedMB: 0, peakRssMB: 0, peakEventLoopLagMs: 0 };
  lastEventLoopLagMs = 0;
  replayAccessLog.clear();
}
