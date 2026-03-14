// GUID: PIT_WALL_SETTINGS_HOOK-000-v01
// [Intent] Manages persistent Pit Wall user settings via localStorage.
//          Controls update interval, visible columns, and radio zoom mode.
// [Inbound Trigger] Used by PitWallClient as the top-level settings source.
// [Downstream Impact] Settings flow down to all child components and the polling hook.

'use client';

import { useState, useEffect, useCallback } from 'react';
import { getDefaultVisibleColumns } from '../_types/columns';

// GUID: PIT_WALL_SETTINGS_HOOK-001-v02
const STORAGE_KEY = 'prix6_pitwall_settings_v1';
const DEFAULT_INTERVAL = 60;
const MIN_INTERVAL = 2;
const MAX_INTERVAL = 60;

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

// GUID: PIT_WALL_SETTINGS_HOOK-004-v02
// [Intent] React hook exposing pit-wall settings with typed setters.
export function usePitWallSettings(): UsePitWallSettingsReturn {
  const [settings, setSettings] = useState<PitWallSettings>(() => ({
    updateIntervalSeconds: DEFAULT_INTERVAL,
    visibleColumns: getDefaultVisibleColumns(),
    radioZoomMode: false,
  }));

  // Load from localStorage after mount (SSR guard)
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSettings = useCallback((patch: Partial<PitWallSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const setUpdateInterval = useCallback((seconds: number) => {
    updateSettings({ updateIntervalSeconds: Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, seconds)) });
  }, [updateSettings]);

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
  };
}
