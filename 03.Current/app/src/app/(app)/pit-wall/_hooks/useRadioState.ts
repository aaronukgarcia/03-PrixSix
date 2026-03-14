// GUID: PIT_WALL_RADIO_HOOK-000-v01
// [Intent] Manages team radio read/unread and mute state via localStorage.
//          Provides per-driver unread counts and message marking functions.
// [Inbound Trigger] Used by PitWallClient and passed to RadioIcon, RadioZoomPanel.
// [Downstream Impact] Read state flows to RadioIcon (unread dot) and RadioZoomPanel (badges).

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { RadioMessage } from '../_types/pit-wall.types';

// GUID: PIT_WALL_RADIO_HOOK-001-v01
const STORAGE_KEY = 'prix6_pitwall_radio_state_v1';
const MAX_STORED_IDS = 500;

interface RadioStoredState {
  readMessageIds: string[];
  mutedDriverNumbers: number[];
  lastSessionKey: number | null;
}

export interface UseRadioStateReturn {
  isRead: (messageId: string) => boolean;
  markRead: (messageId: string) => void;
  markAllRead: (driverNumber: number, messages: RadioMessage[]) => void;
  isMuted: (driverNumber: number) => boolean;
  toggleMute: (driverNumber: number) => void;
  unreadCountFor: (driverNumber: number, messages: RadioMessage[]) => number;
  totalUnread: (messages: RadioMessage[]) => number;
}

// GUID: PIT_WALL_RADIO_HOOK-002-v01
function loadState(): RadioStoredState {
  if (typeof window === 'undefined') return { readMessageIds: [], mutedDriverNumbers: [], lastSessionKey: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    return JSON.parse(raw) as RadioStoredState;
  } catch {
    return { readMessageIds: [], mutedDriverNumbers: [], lastSessionKey: null };
  }
}

// GUID: PIT_WALL_RADIO_HOOK-003-v01
function saveState(state: RadioStoredState): void {
  if (typeof window === 'undefined') return;
  try {
    // Trim if over limit
    if (state.readMessageIds.length > MAX_STORED_IDS) {
      state.readMessageIds = state.readMessageIds.slice(-MAX_STORED_IDS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded */ }
}

// GUID: PIT_WALL_RADIO_HOOK-004-v01
// [Intent] React hook for radio read/mute state management.
export function useRadioState(sessionKey: number | null): UseRadioStateReturn {
  const stateRef = useRef<RadioStoredState>({ readMessageIds: [], mutedDriverNumbers: [], lastSessionKey: null });
  const [, forceRender] = useState(0);

  useEffect(() => {
    const loaded = loadState();
    // Clear read IDs if session changed (new race)
    if (sessionKey !== null && loaded.lastSessionKey !== null && loaded.lastSessionKey !== sessionKey) {
      loaded.readMessageIds = [];
    }
    if (sessionKey !== null) {
      loaded.lastSessionKey = sessionKey;
    }
    stateRef.current = loaded;
    saveState(loaded);
    forceRender(n => n + 1);
  }, [sessionKey]);

  const isRead = useCallback((messageId: string) => {
    return stateRef.current.readMessageIds.includes(messageId);
  }, []);

  const markRead = useCallback((messageId: string) => {
    if (stateRef.current.readMessageIds.includes(messageId)) return;
    stateRef.current.readMessageIds.push(messageId);
    saveState(stateRef.current);
    forceRender(n => n + 1);
  }, []);

  const markAllRead = useCallback((driverNumber: number, messages: RadioMessage[]) => {
    const ids = messages.filter(m => m.driverNumber === driverNumber).map(m => m.id);
    const newIds = ids.filter(id => !stateRef.current.readMessageIds.includes(id));
    stateRef.current.readMessageIds.push(...newIds);
    saveState(stateRef.current);
    forceRender(n => n + 1);
  }, []);

  const isMuted = useCallback((driverNumber: number) => {
    return stateRef.current.mutedDriverNumbers.includes(driverNumber);
  }, []);

  const toggleMute = useCallback((driverNumber: number) => {
    const muted = stateRef.current.mutedDriverNumbers;
    if (muted.includes(driverNumber)) {
      stateRef.current.mutedDriverNumbers = muted.filter(n => n !== driverNumber);
    } else {
      stateRef.current.mutedDriverNumbers.push(driverNumber);
    }
    saveState(stateRef.current);
    forceRender(n => n + 1);
  }, []);

  const unreadCountFor = useCallback((driverNumber: number, messages: RadioMessage[]) => {
    if (stateRef.current.mutedDriverNumbers.includes(driverNumber)) return 0;
    return messages.filter(m => m.driverNumber === driverNumber && !stateRef.current.readMessageIds.includes(m.id)).length;
  }, []);

  const totalUnread = useCallback((messages: RadioMessage[]) => {
    return messages.filter(m =>
      !stateRef.current.mutedDriverNumbers.includes(m.driverNumber) &&
      !stateRef.current.readMessageIds.includes(m.id)
    ).length;
  }, []);

  return { isRead, markRead, markAllRead, isMuted, toggleMute, unreadCountFor, totalUnread };
}
