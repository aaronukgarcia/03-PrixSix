// GUID: PIT_WALL_SETTINGS_HOOK-000-v02
// [Intent] Manages persistent Pit Wall user settings via localStorage.
//          Controls update interval, visible columns, and radio zoom mode.
//          Auto-reset: if the user changes the update interval from the 60s default,
//          it reverts automatically after 20 minutes of no further changes.
// [Inbound Trigger] Used by PitWallClient as the top-level settings source.
// [Downstream Impact] Settings flow down to all child components and the polling hook.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDefaultVisibleColumns } from '../_types/columns';

// GUID: PIT_WALL_SETTINGS_HOOK-001-v03
const STORAGE_KEY = 'prix6_pitwall_settings_v1';
const DEFAULT_INTERVAL = 60;
const MIN_INTERVAL = 2;
const MAX_INTERVAL = 60;
/** After this many ms of no slider changes, auto-reset the interval to DEFAULT_INTERVAL. */
const INTERVAL_RESET_AFTER_MS = 20 * 60 * 1000; // 20 minutes

interface PitWallSettings {
  updateIntervalSeconds: number;
  visibleColumns: string[];
  radioZoomMode: boolean;
}

interface UsePitWallSettingsReturn {
  settings: PitWallSettings;
  setUpdateInterval: (seconds: number) => void;
  setVisibleColumns: (cols: string[]) => void;
  toggleColumn: (key: string) => void;
  setRadioZoomMode: (open: boolean) => void;
  isHighFrequency: boolean; // true when < 5s
  /** True when a custom (non-default) interval is active and will auto-reset after 20 min. */
  intervalIsTemporary: boolean;
  /** Minutes remaining before the interval auto-resets to default (0 when not temporary). */
  intervalResetMinutes: number;
}

// GUID: PIT_WALL_SETTINGS_HOOK-002-v01
// [Intent] Load settings from localStorage with safe fallback to defaults.
function loadSettings(): PitWallSettings {
  if (typeof window === 'undefined') {
    return {
      updateIntervalSeconds: DEFAULT_INTERVAL,
      visibleColumns: getDefaultVisibleColumns(),
      radioZoomMode: false,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('no settings');
    const parsed = JSON.parse(raw) as PitWallSettings;
    return {
      updateIntervalSeconds: Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, parsed.updateIntervalSeconds ?? DEFAULT_INTERVAL)),
      visibleColumns: Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.length > 0
        ? parsed.visibleColumns
        : getDefaultVisibleColumns(),
      radioZoomMode: parsed.radioZoomMode ?? false,
    };
  } catch {
    return {
      updateIntervalSeconds: DEFAULT_INTERVAL,
      visibleColumns: getDefaultVisibleColumns(),
      radioZoomMode: false,
    };
  }
}

// GUID: PIT_WALL_SETTINGS_HOOK-003-v01
// [Intent] Save settings to localStorage.
function saveSettings(settings: PitWallSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage quota exceeded — ignore
  }
}

// GUID: PIT_WALL_SETTINGS_HOOK-004-v03
// [Intent] React hook exposing pit-wall settings with typed setters.
//          Includes 20-minute auto-reset: if the user sets a non-default interval,
//          a timer resets it to DEFAULT_INTERVAL after INTERVAL_RESET_AFTER_MS.
//          Each new slider move restarts the 20-minute countdown.
// [Inbound Trigger] Used by PitWallClient.
// [Downstream Impact] Interval changes ripple to usePitWallData polling frequency.
export function usePitWallSettings(): UsePitWallSettingsReturn {
  const [settings, setSettings] = useState<PitWallSettings>(() => ({
    updateIntervalSeconds: DEFAULT_INTERVAL,
    visibleColumns: getDefaultVisibleColumns(),
    radioZoomMode: false,
  }));

  // GUID: PIT_WALL_SETTINGS_HOOK-005-v01
  // [Intent] Track when the user last changed the interval (null = never / at default).
  //          Used to compute the auto-reset countdown and remaining minutes display.
  const [intervalChangedAt, setIntervalChangedAt] = useState<number | null>(null);
  const [intervalResetMinutes, setIntervalResetMinutes] = useState(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load from localStorage after mount (SSR guard)
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  // GUID: PIT_WALL_SETTINGS_HOOK-006-v01
  // [Intent] Keep the "Xm remaining" countdown display updated every minute.
  //          Also cleans up on unmount.
  useEffect(() => {
    if (intervalChangedAt === null) {
      setIntervalResetMinutes(0);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    const update = () => {
      const elapsedMs = Date.now() - intervalChangedAt;
      const remainingMs = INTERVAL_RESET_AFTER_MS - elapsedMs;
      setIntervalResetMinutes(Math.max(0, Math.ceil(remainingMs / 60_000)));
    };
    update();
    countdownRef.current = setInterval(update, 60_000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [intervalChangedAt]);

  const updateSettings = useCallback((patch: Partial<PitWallSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const setUpdateInterval = useCallback((seconds: number) => {
    const clamped = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, seconds));
    updateSettings({ updateIntervalSeconds: clamped });

    if (clamped === DEFAULT_INTERVAL) {
      // User explicitly set it back to default — cancel the reset timer
      setIntervalChangedAt(null);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    } else {
      // Non-default: (re)start the 20-minute auto-reset timer
      setIntervalChangedAt(Date.now());
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        updateSettings({ updateIntervalSeconds: DEFAULT_INTERVAL });
        setIntervalChangedAt(null);
      }, INTERVAL_RESET_AFTER_MS);
    }
  }, [updateSettings]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const setVisibleColumns = useCallback((cols: string[]) => {
    updateSettings({ visibleColumns: cols });
  }, [updateSettings]);

  const toggleColumn = useCallback((key: string) => {
    setSettings(prev => {
      const next = prev.visibleColumns.includes(key)
        ? prev.visibleColumns.filter(k => k !== key)
        : [...prev.visibleColumns, key];
      const updated = { ...prev, visibleColumns: next };
      saveSettings(updated);
      return updated;
    });
  }, []);

  const setRadioZoomMode = useCallback((open: boolean) => {
    updateSettings({ radioZoomMode: open });
  }, [updateSettings]);

  return {
    settings,
    setUpdateInterval,
    setVisibleColumns,
    toggleColumn,
    setRadioZoomMode,
    isHighFrequency: settings.updateIntervalSeconds < 5,
    intervalIsTemporary: intervalChangedAt !== null,
    intervalResetMinutes,
  };
}
