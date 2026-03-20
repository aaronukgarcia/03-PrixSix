// GUID: LIB_PITWALL_CACHE-000-v01
// [Intent] Shared module-level cache for Pit Wall live data and detail responses.
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

// ---------- Purge ----------

// GUID: LIB_PITWALL_CACHE-003-v01
// [Intent] Purge all caches. Called by admin cache-purge endpoint.
//          Next request to live-data will trigger a fresh OpenF1 fan-out.
export function purgeAllCaches(): { purgedLiveData: boolean; purgedDetail: boolean; purgedToken: boolean } {
  const purgedLiveData = liveDataCache !== null;
  const purgedDetail = detailCache !== null;
  const purgedToken = cachedToken !== null;
  liveDataCache = null;
  detailCache = null;
  cachedToken = null;
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
