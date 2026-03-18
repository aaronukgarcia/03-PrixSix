// GUID: PIT_WALL_DATA_HOOK-000-v02
// [Intent] Master polling hook for all Pit Wall live data. Fetches from
//          /api/pit-wall/live-data on a configurable interval and exposes
//          the merged DriverRaceState[], race control messages, and weather.
//          Internal state is managed via useReducer (single dispatch per fetch).
//          JSON parsing is offloaded to a Web Worker where available.
// [Inbound Trigger] Called once by PitWallClient with the current settings.
// [Downstream Impact] All live data in the Pit Wall flows from this hook.

'use client';

import { useReducer, useEffect, useRef, useCallback } from 'react';
import type { DriverRaceState, RaceControlMessage, RadioMessage, WeatherSnapshot, PitWallLiveDataResponse, PitWallDetailResponse } from '../_types/pit-wall.types';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';
import type { User } from 'firebase/auth';

// GUID: PIT_WALL_DATA_HOOK-001-v02
export interface UsePitWallDataReturn {
  drivers: DriverRaceState[];
  raceControl: RaceControlMessage[];
  radioMessages: RadioMessage[];
  weather: WeatherSnapshot | null;
  sessionKey: number | null;
  sessionName: string | null;
  meetingName: string | null;
  sessionType: string | null;
  circuitKey: number | null;
  circuitLat: number | null;
  circuitLon: number | null;
  totalLaps: number | null;
  positionDataAvailable: boolean;
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
  correlationId: string | null;
  lastUpdated: Date | null;
  forceRefresh: () => void;
}

// GUID: PIT_WALL_DATA_HOOK-005-v02
// [Intent] Internal reducer state — all data fields in one place, updated atomically per fetch.
interface PitWallDataState {
  drivers: DriverRaceState[];
  raceControl: RaceControlMessage[];
  radioMessages: RadioMessage[];
  weather: WeatherSnapshot | null;
  sessionKey: number | null;
  sessionName: string | null;
  meetingName: string | null;
  sessionType: string | null;
  circuitKey: number | null;
  circuitLat: number | null;
  circuitLon: number | null;
  totalLaps: number | null;
  positionDataAvailable: boolean;
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
  correlationId: string | null;
  lastUpdated: Date | null;
}

type PitWallDataAction =
  | { type: 'FETCH_SUCCESS'; payload: PitWallLiveDataResponse }
  | { type: 'MERGE_DETAIL'; payload: PitWallDetailResponse }
  | { type: 'FETCH_ERROR'; error: string; errorCode: string; correlationId: string }
  | { type: 'SET_LOADING' };

const initialState: PitWallDataState = {
  drivers: [],
  raceControl: [],
  radioMessages: [],
  weather: null,
  sessionKey: null,
  sessionName: null,
  meetingName: null,
  sessionType: null,
  circuitKey: null,
  circuitLat: null,
  circuitLon: null,
  totalLaps: null,
  positionDataAvailable: false,
  isLoading: true,
  error: null,
  errorCode: null,
  correlationId: null,
  lastUpdated: null,
};

// GUID: PIT_WALL_DATA_HOOK-004-v02
// [Intent] Reducer that applies fetch outcomes atomically — no partial state updates.
//          v02: Added MERGE_DETAIL — enriches existing drivers[] with lap times,
//               car telemetry, and radio from the slow detail tier without
//               replacing core fields. Ignored if sessionKey doesn't match.
function pitWallDataReducer(state: PitWallDataState, action: PitWallDataAction): PitWallDataState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: true };
    case 'FETCH_SUCCESS':
      return {
        ...state,
        drivers: action.payload.drivers ?? [],
        raceControl: action.payload.raceControl ?? [],
        radioMessages: action.payload.radioMessages ?? [],
        weather: action.payload.weather ?? null,
        sessionKey: action.payload.sessionKey,
        sessionName: action.payload.sessionName,
        meetingName: action.payload.meetingName,
        sessionType: action.payload.sessionType,
        circuitKey: action.payload.circuitKey,
        circuitLat: action.payload.circuitLat,
        circuitLon: action.payload.circuitLon,
        totalLaps: action.payload.totalLaps,
        positionDataAvailable: action.payload.positionDataAvailable,
        isLoading: false,
        error: null,
        errorCode: null,
        correlationId: null,
        lastUpdated: new Date(),
      };
    case 'MERGE_DETAIL': {
      // Drop stale detail responses (different session)
      if (action.payload.sessionKey !== null && action.payload.sessionKey !== state.sessionKey) return state;
      const detailMap = new Map(action.payload.driverDetail.map(d => [d.driverNumber, d]));
      return {
        ...state,
        radioMessages: action.payload.radioMessages.length > 0
          ? action.payload.radioMessages
          : state.radioMessages,
        drivers: state.drivers.map(d => {
          const detail = detailMap.get(d.driverNumber);
          if (!detail) return d;
          return {
            ...d,
            currentLap:   detail.currentLap   || d.currentLap,
            lastLapTime:  detail.lastLapTime  ?? d.lastLapTime,
            bestLapTime:  detail.bestLapTime  ?? d.bestLapTime,
            fastestLap:   detail.fastestLap,
            sectors:      detail.sectors,
            speed:        detail.speed        ?? d.speed,
            throttle:     detail.throttle     ?? d.throttle,
            brake:        detail.brake        ?? d.brake,
            gear:         detail.gear         ?? d.gear,
          };
        }),
      };
    }
    case 'FETCH_ERROR':
      return {
        ...state,
        isLoading: false,
        error: action.error,
        errorCode: action.errorCode,
        correlationId: action.correlationId,
      };
    default:
      return state;
  }
}

// GUID: PIT_WALL_DATA_HOOK-002-v02
// [Intent] Fetch raw response text from the pit-wall API core tier.
//          Core tier: sessions, drivers, positions, locations, intervals, stints, weather, race_control.
//          Returns text for Web Worker JSON parsing.
async function fetchCoreDataText(firebaseUser: User): Promise<string> {
  const token = await firebaseUser.getIdToken();
  const res = await fetch('/api/pit-wall/live-data?tier=core', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.text();
}

// GUID: PIT_WALL_DATA_HOOK-006-v01
// [Intent] Fetch detail tier — laps, car_data, team_radio. Runs concurrently with core
//          so slow endpoints don't block the table from appearing. Returns null on any error
//          (detail is supplemental; core failure is the only hard error).
async function fetchDetailData(firebaseUser: User): Promise<PitWallDetailResponse | null> {
  try {
    const token = await firebaseUser.getIdToken();
    const res = await fetch('/api/pit-wall/live-data?tier=detail', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json() as PitWallDetailResponse;
  } catch {
    return null;
  }
}

// GUID: PIT_WALL_DATA_HOOK-003-v02
// [Intent] React hook managing the polling lifecycle with useReducer for atomic state updates
//          and an optional Web Worker for off-main-thread JSON parsing.
export function usePitWallData(
  updateIntervalSeconds: number,
  firebaseUser: User | null,
): UsePitWallDataReturn {
  const [state, dispatch] = useReducer(pitWallDataReducer, initialState);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshCountRef = useRef(0);

  // Web Worker — created once, persists for the hook lifetime
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  // Map from requestId → { resolve, reject } for pending parse operations
  const pendingRef = useRef<Map<number, { resolve: (v: PitWallLiveDataResponse) => void; reject: (e: Error) => void }>>(new Map());

  // Initialise worker on mount; terminate on unmount
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('../pit-wall.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as
          | { type: 'PROCESS_RESULT'; requestId: number; data: any }
          | { type: 'PROCESS_ERROR'; requestId: number; message: string };
        const pending = pendingRef.current.get(msg.requestId);
        if (!pending) return;
        pendingRef.current.delete(msg.requestId);
        if (msg.type === 'PROCESS_RESULT') {
          pending.resolve(msg.data as PitWallLiveDataResponse);
        } else {
          pending.reject(new Error(msg.message));
        }
      };
      workerRef.current = worker;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Parse JSON via worker if available, else fall back to inline JSON.parse
  const parseJson = useCallback((rawText: string): Promise<PitWallLiveDataResponse> => {
    const worker = workerRef.current;
    if (worker) {
      return new Promise<PitWallLiveDataResponse>((resolve, reject) => {
        const requestId = ++requestIdRef.current;
        pendingRef.current.set(requestId, { resolve, reject });
        worker.postMessage({ type: 'PROCESS_JSON', rawText, requestId });
      });
    }
    // Feature-detect fallback
    return Promise.resolve(JSON.parse(rawText) as PitWallLiveDataResponse);
  }, []);

  const fetchData = useCallback(async () => {
    if (!firebaseUser) return;
    // Fire core and detail simultaneously — core dispatches first (fast), detail merges in later (slow)
    const corePromise = fetchCoreDataText(firebaseUser)
      .then(rawText => parseJson(rawText))
      .then(data => dispatch({ type: 'FETCH_SUCCESS', payload: data }))
      .catch((err: any) => {
        const cid = generateClientCorrelationId();
        dispatch({
          type: 'FETCH_ERROR',
          error: err?.message || CLIENT_ERRORS.NETWORK_ERROR.message,
          errorCode: CLIENT_ERRORS.NETWORK_ERROR.code,
          correlationId: cid,
        });
      });
    const detailPromise = fetchDetailData(firebaseUser)
      .then(detail => { if (detail) dispatch({ type: 'MERGE_DETAIL', payload: detail }); });
    // Await both so the interval doesn't fire a new fetch before they complete
    await Promise.allSettled([corePromise, detailPromise]);
  }, [firebaseUser, parseJson]);

  const forceRefresh = useCallback(() => {
    refreshCountRef.current += 1;
    fetchData();
  }, [fetchData]);

  // Reset and restart polling when interval or user changes
  useEffect(() => {
    if (!firebaseUser) return;
    // Only show loading spinner on first fetch (no drivers yet)
    if (state.drivers.length === 0) {
      dispatch({ type: 'SET_LOADING' });
    }
    fetchData();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchData, updateIntervalSeconds * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateIntervalSeconds, firebaseUser, fetchData]);

  // Pause polling when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        fetchData();
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(fetchData, updateIntervalSeconds * 1000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchData, updateIntervalSeconds]);

  return {
    drivers: state.drivers,
    raceControl: state.raceControl,
    radioMessages: state.radioMessages,
    weather: state.weather,
    sessionKey: state.sessionKey,
    sessionName: state.sessionName,
    meetingName: state.meetingName,
    sessionType: state.sessionType,
    circuitKey: state.circuitKey,
    circuitLat: state.circuitLat,
    circuitLon: state.circuitLon,
    totalLaps: state.totalLaps,
    positionDataAvailable: state.positionDataAvailable,
    isLoading: state.isLoading,
    error: state.error,
    errorCode: state.errorCode,
    correlationId: state.correlationId,
    lastUpdated: state.lastUpdated,
    forceRefresh,
  };
}
