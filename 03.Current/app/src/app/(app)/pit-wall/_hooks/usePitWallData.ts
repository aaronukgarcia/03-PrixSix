// GUID: PIT_WALL_DATA_HOOK-000-v01
// [Intent] Master polling hook for all Pit Wall live data. Fetches from
//          /api/pit-wall/live-data on a configurable interval and exposes
//          the merged DriverRaceState[], race control messages, and weather.
// [Inbound Trigger] Called once by PitWallClient with the current settings.
// [Downstream Impact] All live data in the Pit Wall flows from this hook.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DriverRaceState, RaceControlMessage, RadioMessage, WeatherSnapshot, PitWallLiveDataResponse } from '../_types/pit-wall.types';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';
import type { User } from 'firebase/auth';

// GUID: PIT_WALL_DATA_HOOK-001-v01
export interface UsePitWallDataReturn {
  drivers: DriverRaceState[];
  raceControl: RaceControlMessage[];
  radioMessages: RadioMessage[];
  weather: WeatherSnapshot | null;
  sessionKey: number | null;
  sessionName: string | null;
  meetingName: string | null;
  sessionType: string | null;
  circuitLat: number | null;
  circuitLon: number | null;
  totalLaps: number | null;
  isLoading: boolean;
  error: string | null;
  errorCode: string | null;
  correlationId: string | null;
  lastUpdated: Date | null;
  forceRefresh: () => void;
}

// GUID: PIT_WALL_DATA_HOOK-002-v01
// [Intent] Fetch live data from the pit-wall API route with Firebase auth token.
async function fetchLiveData(firebaseUser: User): Promise<PitWallLiveDataResponse> {
  const token = await firebaseUser.getIdToken();
  const res = await fetch('/api/pit-wall/live-data', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// GUID: PIT_WALL_DATA_HOOK-003-v01
// [Intent] React hook managing the polling lifecycle.
export function usePitWallData(
  updateIntervalSeconds: number,
  firebaseUser: User | null,
): UsePitWallDataReturn {
  const [drivers, setDrivers] = useState<DriverRaceState[]>([]);
  const [raceControl, setRaceControl] = useState<RaceControlMessage[]>([]);
  const [radioMessages, setRadioMessages] = useState<RadioMessage[]>([]);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [meetingName, setMeetingName] = useState<string | null>(null);
  const [sessionType, setSessionType] = useState<string | null>(null);
  const [circuitLat, setCircuitLat] = useState<number | null>(null);
  const [circuitLon, setCircuitLon] = useState<number | null>(null);
  const [totalLaps, setTotalLaps] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshCountRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const data = await fetchLiveData(firebaseUser);
      setDrivers(data.drivers ?? []);
      setRaceControl(data.raceControl ?? []);
      setRadioMessages(data.radioMessages ?? []);
      setWeather(data.weather ?? null);
      setSessionKey(data.sessionKey);
      setSessionName(data.sessionName);
      setMeetingName(data.meetingName);
      setSessionType(data.sessionType);
      setCircuitLat(data.circuitLat);
      setCircuitLon(data.circuitLon);
      setTotalLaps(data.totalLaps);
      setError(null);
      setErrorCode(null);
      setCorrelationId(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      const cid = generateClientCorrelationId();
      setError(err?.message || CLIENT_ERRORS.NETWORK_ERROR.message);
      setErrorCode(CLIENT_ERRORS.NETWORK_ERROR.code);
      setCorrelationId(cid);
    } finally {
      setIsLoading(false);
    }
  }, [firebaseUser]);

  const forceRefresh = useCallback(() => {
    refreshCountRef.current += 1;
    fetchData();
  }, [fetchData]);

  // Reset and restart polling when interval or user changes
  useEffect(() => {
    if (!firebaseUser) return;
    // Immediate fetch
    setIsLoading(drivers.length === 0);
    fetchData();
    // Set up interval
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchData, updateIntervalSeconds * 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
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
    drivers, raceControl, radioMessages, weather,
    sessionKey, sessionName, meetingName, sessionType,
    circuitLat, circuitLon, totalLaps,
    isLoading, error, errorCode, correlationId, lastUpdated,
    forceRefresh,
  };
}
