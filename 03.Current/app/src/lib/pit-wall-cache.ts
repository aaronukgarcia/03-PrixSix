// GUID: LIB_PITWALL_CACHE-000-v02
// [Intent] Shared module-level cache for Pit Wall live data and detail responses.
//          v02: Added promise coalescing (thundering herd fix) and cache metrics.
//          Extracted from live-data/route.ts so that admin health/purge endpoints
//          can introspect and clear the cache without being in the same route file.
//          IMPORTANT: This works because Firebase App Hosting runs a persistent Node.js
//          process (not serverless). Module-level state is shared across all route handlers
//          within the same process. Would NOT work on Vercel/serverless where each route
//          runs in an isolated function invocation.
// [Inbound Trigger] Imported by live-data/route.ts (read/write) and admin pit-wall endpoints (read/purge).
// [Downstream Impact] Cache state is shared across all concurrent users. Purging forces
//                     next live-data request to re-fetch from OpenF1.

import type { PitWallLiveDataResponse, PitWallDetailResponse } from '@/app/(app)/pit-wall/_types/pit-wall.types';

// ---------- Live Data Cache ----------

// GUID: LIB_PITWALL_CACHE-001-v01
// [Intent] Module-level live data cache — one entry keyed by session_key.
//          Session change (e.g. quali → race) invalidates stale entry.
export interface CacheEntry<T> {
  sessionKey: number | null;
  data: T;
  expiresAt: number;
}

let liveDataCache: CacheEntry<PitWallLiveDataResponse> | null = null;
let detailCache: CacheEntry<PitWallDetailResponse> | null = null;

// GUID: LIB_PITWALL_CACHE-002-v01
// [Intent] OpenF1 token cache — stored here so health endpoint can report token status.
let cachedToken: { token: string; expiresAt: number } | null = null;

// ---------- Promise Coalescing ----------

// GUID: LIB_PITWALL_CACHE-005-v01
// [Intent] In-flight request deduplication — prevents thundering herd.
//          When the cache TTL expires and multiple concurrent requests arrive,
//          only the first request triggers an OpenF1 fan-out. All subsequent
//          requests await the same in-flight promise instead of starting their own.
//          Cleared in the finally{} block so the next request after completion retries.
let inFlightCorePromise: Promise<PitWallLiveDataResponse> | null = null;
let inFlightDetailPromise: Promise<PitWallDetailResponse> | null = null;

// ---------- Cache Metrics ----------

// GUID: LIB_PITWALL_CACHE-008-v01
// [Intent] Cache performance counters for admin observability.
//          Tracks hit/miss/coalesce rates per tier and active request concurrency.
export interface CacheMetrics {
  coreHits: number;
  coreMisses: number;
  coreCoalesced: number;
  detailHits: number;
  detailMisses: number;
  detailCoalesced: number;
  activeRequests: number;
  peakActiveRequests: number;
  lastResetAt: number;
}

let metrics: CacheMetrics = {
  coreHits: 0,
  coreMisses: 0,
  coreCoalesced: 0,
  detailHits: 0,
  detailMisses: 0,
  detailCoalesced: 0,
  activeRequests: 0,
  peakActiveRequests: 0,
  lastResetAt: Date.now(),
};

export type CacheSource = 'cache' | 'coalesced' | 'fetched';

// ---------- Getters ----------

export function getLiveDataCache(): CacheEntry<PitWallLiveDataResponse> | null {
  return liveDataCache;
}

export function getDetailCache(): CacheEntry<PitWallDetailResponse> | null {
  return detailCache;
}

export function getCachedToken(): { token: string; expiresAt: number } | null {
  return cachedToken;
}

// ---------- Setters ----------

export function setLiveDataCache(entry: CacheEntry<PitWallLiveDataResponse> | null): void {
  liveDataCache = entry;
}

export function setDetailCache(entry: CacheEntry<PitWallDetailResponse> | null): void {
  detailCache = entry;
}

export function setCachedToken(entry: { token: string; expiresAt: number } | null): void {
  cachedToken = entry;
}

// ---------- Promise Coalescing API ----------

// GUID: LIB_PITWALL_CACHE-006-v01
// [Intent] Cache-check → in-flight-check → fetch, with promise coalescing.
//          Returns the data and the source (cache/coalesced/fetched) so the route
//          handler can set diagnostic headers and response fields.
//          The fetchFn is responsible for populating liveDataCache via setLiveDataCache().
export async function getOrFetchCoreData(
  fetchFn: () => Promise<PitWallLiveDataResponse>,
): Promise<{ data: PitWallLiveDataResponse; source: CacheSource }> {
  const now = Date.now();

  // 1. Cache hit
  if (liveDataCache && liveDataCache.expiresAt > now) {
    metrics.coreHits++;
    return { data: liveDataCache.data, source: 'cache' };
  }

  // 2. In-flight coalesce — another request is already fetching
  if (inFlightCorePromise) {
    metrics.coreCoalesced++;
    const data = await inFlightCorePromise;
    return { data, source: 'coalesced' };
  }

  // 3. Cache miss — start a new fetch
  metrics.coreMisses++;
  inFlightCorePromise = (async () => {
    try {
      return await fetchFn();
    } finally {
      inFlightCorePromise = null;
    }
  })();

  const data = await inFlightCorePromise;
  return { data, source: 'fetched' };
}

// GUID: LIB_PITWALL_CACHE-007-v01
// [Intent] Same coalescing pattern for the detail tier (laps, car_data, team_radio).
//          The fetchFn is responsible for populating detailCache via setDetailCache().
export async function getOrFetchDetailData(
  fetchFn: () => Promise<PitWallDetailResponse>,
): Promise<{ data: PitWallDetailResponse; source: CacheSource }> {
  const now = Date.now();

  // 1. Cache hit
  if (detailCache && detailCache.expiresAt > now) {
    metrics.detailHits++;
    return { data: detailCache.data, source: 'cache' };
  }

  // 2. In-flight coalesce
  if (inFlightDetailPromise) {
    metrics.detailCoalesced++;
    const data = await inFlightDetailPromise;
    return { data, source: 'coalesced' };
  }

  // 3. Cache miss
  metrics.detailMisses++;
  inFlightDetailPromise = (async () => {
    try {
      return await fetchFn();
    } finally {
      inFlightDetailPromise = null;
    }
  })();

  const data = await inFlightDetailPromise;
  return { data, source: 'fetched' };
}

// ---------- Request Tracking ----------

// GUID: LIB_PITWALL_CACHE-009-v01
// [Intent] Track active request concurrency with high-water mark.
//          Call trackRequest() at the start of the live-data handler,
//          untrackRequest() in the finally{} block.
export function trackRequest(): void {
  metrics.activeRequests++;
  if (metrics.activeRequests > metrics.peakActiveRequests) {
    metrics.peakActiveRequests = metrics.activeRequests;
  }
}

export function untrackRequest(): void {
  metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
}

// ---------- Metrics Export ----------

export function getCacheMetrics(): CacheMetrics {
  return { ...metrics };
}

export function resetCacheMetrics(): void {
  metrics = {
    coreHits: 0,
    coreMisses: 0,
    coreCoalesced: 0,
    detailHits: 0,
    detailMisses: 0,
    detailCoalesced: 0,
    activeRequests: metrics.activeRequests, // preserve current active count
    peakActiveRequests: metrics.activeRequests, // reset peak to current
    lastResetAt: Date.now(),
  };
}

// ---------- Purge ----------

// GUID: LIB_PITWALL_CACHE-003-v02
// [Intent] Purge all caches and in-flight promises. Called by admin cache-purge endpoint.
//          v02: Also clears in-flight promises to prevent stale coalesced responses.
//          Next request to live-data will trigger a fresh OpenF1 fan-out.
export function purgeAllCaches(): { purgedLiveData: boolean; purgedDetail: boolean; purgedToken: boolean } {
  const purgedLiveData = liveDataCache !== null;
  const purgedDetail = detailCache !== null;
  const purgedToken = cachedToken !== null;
  liveDataCache = null;
  detailCache = null;
  cachedToken = null;
  inFlightCorePromise = null;
  inFlightDetailPromise = null;
  return { purgedLiveData, purgedDetail, purgedToken };
}

// ---------- Introspection ----------

// GUID: LIB_PITWALL_CACHE-004-v01
// [Intent] Return cache status summary for admin health endpoint.
export function getCacheStatus(): {
  liveData: { active: boolean; sessionKey: number | null; ageMs: number | null; expiresIn: number | null };
  detail: { active: boolean; sessionKey: number | null; ageMs: number | null; expiresIn: number | null };
  token: { valid: boolean; expiresIn: number | null };
} {
  const now = Date.now();

  const liveActive = liveDataCache !== null && liveDataCache.expiresAt > now;
  const detailActive = detailCache !== null && detailCache.expiresAt > now;
  const tokenValid = cachedToken !== null && cachedToken.expiresAt > now;

  return {
    liveData: {
      active: liveActive,
      sessionKey: liveDataCache?.sessionKey ?? null,
      ageMs: liveActive ? now - liveDataCache!.data.fetchedAt : null,
      expiresIn: liveActive ? liveDataCache!.expiresAt - now : null,
    },
    detail: {
      active: detailActive,
      sessionKey: detailCache?.sessionKey ?? null,
      ageMs: detailActive && detailCache!.data.fetchedAt ? now - detailCache!.data.fetchedAt : null,
      expiresIn: detailActive ? detailCache!.expiresAt - now : null,
    },
    token: {
      valid: tokenValid,
      expiresIn: tokenValid ? cachedToken!.expiresAt - now : null,
    },
  };
}
