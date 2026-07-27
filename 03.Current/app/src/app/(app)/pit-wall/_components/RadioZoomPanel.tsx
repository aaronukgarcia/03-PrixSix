// GUID: RADIO_ZOOM_PANEL-000-v01
// [Intent] Bottom panel that slides up 50vh — iMessage-style team radio centre.
//          Dark, premium F1 aesthetic. Two-column: driver list + message thread.
// [Inbound Trigger] Triggered by onRadioClick from PitWallRaceTable.
// [Downstream Impact] Calls radioState.markRead / toggleMute. No Firestore writes.

'use client';

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, RadioMessage } from '../_types/pit-wall.types';
import type { UseRadioStateReturn } from '../_hooks/useRadioState';

// GUID: RADIO_ZOOM_PANEL-001-v01
// [Intent] Framer Motion AnimatePresence + motion.div for the slide-up panel.
interface RadioZoomPanelProps {
  isOpen: boolean;
  onClose: () => void;
  drivers: DriverRaceState[];
  radioMessages: RadioMessage[];
  radioState: UseRadioStateReturn;
  selectedDriver: number | null;
  onSelectDriver: (driverNumber: number | null) => void;
}

// GUID: RADIO_ZOOM_PANEL-002-v01
// [Intent] Module-level audio unlock tracker — set true on first user interaction.
//          Required for mobile browsers that block audio autoplay until a gesture.
let audioUnlocked = false;

function ensureAudioUnlocked() {
  if (!audioUnlocked) {
    audioUnlocked = true;
  }
}

// GUID: RADIO_ZOOM_PANEL-009-v01
// [Intent] @FEAT (FEAT-PW-013, 2026-07-27) Radio static audio cue — a short synthesised
//          "squelch" (band-passed white-noise burst + tiny square-wave boop) played when
//          the user starts a team radio message, and a brief click when it ends. Pure
//          WebAudio synthesis — no audio asset to download, nothing autoplayed: the cue
//          only fires inside the user's play-button click (gesture-safe on mobile).
//          AudioContext is created lazily on first use and reused for the session.
let radioCueCtx: AudioContext | null = null;

function getRadioCueContext(): AudioContext | null {
  try {
    if (!radioCueCtx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      radioCueCtx = new Ctor();
    }
    if (radioCueCtx.state === 'suspended') void radioCueCtx.resume();
    return radioCueCtx;
  } catch {
    return null; // WebAudio unavailable — cue is decorative, never block playback
  }
}

// GUID: RADIO_ZOOM_PANEL-010-v01
// [Intent] Play the open-squelch cue: ~150ms of band-passed noise fading out, overlaid
//          with a very quiet 10ms square-wave blip. Gain kept low (≤0.05) — the cue sits
//          under the actual radio recording, not over it.
function playRadioStaticCue(): void {
  try {
    const ctx = getRadioCueContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Noise burst — 0.15s of white noise through a band-pass (radio-band feel)
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 0.15));
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1800; // narrow "radio" band
    bandpass.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.05, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    noise.connect(bandpass).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.16);

    // Tiny square-wave "boop" right at the front of the burst
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1200;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.02, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // Decorative only — swallow (no error-registry write for a missing beep)
  }
}

// GUID: RADIO_ZOOM_PANEL-011-v01
// [Intent] Play the close-squelch click when a message finishes — a single ~40ms
//          filtered noise tick, quieter than the open cue.
function playRadioEndClick(): void {
  try {
    const ctx = getRadioCueContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2400;
    bandpass.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    noise.connect(bandpass).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.05);
  } catch {
    // Decorative only — swallow
  }
}

// GUID: RADIO_ZOOM_PANEL-003-v01
// [Intent] Format an ISO date string as HH:MM:SS local time for message timestamps.
function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

// GUID: RADIO_ZOOM_PANEL-004-v02
// [Intent] iMessage-style audio waveform player with animated bars and progress bar.
//          Inline sub-component — not exported.
//          v02: @FEAT (FEAT-PW-013) radio squelch cues — static burst on play start,
//          click on message end (see RADIO_ZOOM_PANEL-009/-010/-011).
function AudioWaveformPlayer({
  url,
  messageId,
  onPlay,
}: {
  url: string;
  messageId: string;
  onPlay: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0–100

  const togglePlay = useCallback(() => {
    ensureAudioUnlocked();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // @FEAT (FEAT-PW-013, 2026-07-27): open-squelch static cue under the recording.
      // Fired inside the click handler (user gesture) so mobile autoplay policy allows it.
      playRadioStaticCue();
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          onPlay();
        })
        .catch(() => {
          // Autoplay blocked — no-op, user must re-tap
          setIsPlaying(false);
        });
    }
  }, [isPlaying, onPlay]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress((audio.currentTime / audio.duration) * 100);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setProgress(0);
    // @FEAT (FEAT-PW-013): close-squelch click — "message over".
    playRadioEndClick();
  }, []);

  // Waveform bar heights — 5 bars, arbitrary proportions
  const barHeights = [0.6, 1.0, 0.7, 0.9, 0.5];

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      {/* Play / Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        className="p-1 rounded hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors shrink-0"
        aria-label={isPlaying ? 'Pause radio message' : 'Play radio message'}
      >
        {isPlaying ? (
          <Pause className="w-3 h-3" aria-hidden="true" />
        ) : (
          <Play className="w-3 h-3" aria-hidden="true" />
        )}
      </button>

      {/* Waveform bars */}
      <div className="flex items-center gap-0.5 h-4 shrink-0" aria-hidden="true">
        {barHeights.map((height, i) => (
          <motion.div
            key={i}
            className="w-0.5 rounded-full bg-slate-400"
            animate={
              isPlaying
                ? {
                    scaleY: [height, height * 0.5, height * 1.2, height * 0.7, height],
                    opacity: [0.8, 0.5, 1.0, 0.6, 0.8],
                  }
                : { scaleY: height * 0.3, opacity: 0.3 }
            }
            transition={{
              duration: 0.8,
              delay: i * 0.1,
              repeat: isPlaying ? Infinity : 0,
              ease: 'easeInOut',
            }}
            style={{ height: '100%' }}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div className="flex-1 h-1 bg-slate-700 rounded overflow-hidden">
        <div
          className="h-full bg-slate-400 rounded transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="none"
        aria-hidden="true"
      />
    </div>
  );
}

// GUID: RADIO_ZOOM_PANEL-005-v01
// [Intent] Single message bubble — iMessage style with audio waveform or unavailable text.
function MessageBubble({
  message,
  radioState,
}: {
  message: RadioMessage;
  radioState: UseRadioStateReturn;
}) {
  const handlePlay = useCallback(() => {
    radioState.markRead(message.id);
  }, [radioState, message.id]);

  return (
    <motion.div
      key={message.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'flex flex-col gap-1',
        message.isRead ? 'opacity-70' : 'opacity-100'
      )}
    >
      {/* Timestamp */}
      <span className="text-[9px] text-slate-600 font-mono">
        {formatTime(message.date)}
      </span>

      {/* Message bubble */}
      <div
        className={cn(
          'rounded-2xl px-3 py-2 max-w-[80%] self-start border',
          message.isRead
            ? 'bg-slate-800/60 border-slate-700/50'
            : 'bg-slate-800 border-slate-600'
        )}
        style={{
          borderLeftColor: `#${message.teamColour}`,
          borderLeftWidth: '3px',
        }}
      >
        {message.recordingUrl ? (
          <AudioWaveformPlayer
            url={message.recordingUrl}
            messageId={message.id}
            onPlay={handlePlay}
          />
        ) : (
          <span className="text-xs text-slate-500 italic">Audio unavailable</span>
        )}
      </div>
    </motion.div>
  );
}

// GUID: RADIO_ZOOM_PANEL-006-v01
// [Intent] Left driver list column — sorted by unread count desc then position.
//          Shows unread badge and mute toggle per driver.
function DriverListColumn({
  drivers,
  radioMessages,
  radioState,
  selectedDriver,
  onSelectDriver,
  onClose,
}: {
  drivers: DriverRaceState[];
  radioMessages: RadioMessage[];
  radioState: UseRadioStateReturn;
  selectedDriver: number | null;
  onSelectDriver: (n: number | null) => void;
  onClose: () => void;
}) {
  // Only show drivers with messages OR in top 10
  const filteredDrivers = useMemo(() => {
    return drivers.filter(
      (d) =>
        radioMessages.some((m) => m.driverNumber === d.driverNumber) ||
        d.position <= 10
    );
  }, [drivers, radioMessages]);

  // Sort by unread count desc, then race position
  const sortedDrivers = useMemo(() => {
    return [...filteredDrivers].sort((a, b) => {
      const aUnread = radioState.unreadCountFor(a.driverNumber, radioMessages);
      const bUnread = radioState.unreadCountFor(b.driverNumber, radioMessages);
      if (bUnread !== aUnread) return bUnread - aUnread;
      return a.position - b.position;
    });
  }, [filteredDrivers, radioMessages, radioState]);

  return (
    <div className="w-64 shrink-0 border-r border-slate-800 flex flex-col overflow-hidden">
      {/* Column header */}
      <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between shrink-0">
        <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
          Team Radio
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none px-1"
          aria-label="Close radio panel"
        >
          ×
        </button>
      </div>

      {/* Driver list */}
      <div className="flex-1 overflow-y-auto">
        {sortedDrivers.map((driver) => {
          const unread = radioState.unreadCountFor(driver.driverNumber, radioMessages);
          const muted = radioState.isMuted(driver.driverNumber);
          const isSelected = selectedDriver === driver.driverNumber;

          return (
            <button
              key={driver.driverNumber}
              type="button"
              onClick={() => onSelectDriver(driver.driverNumber)}
              className={cn(
                'w-full px-3 py-2 flex items-center gap-2 cursor-pointer border-b border-slate-800/50',
                'hover:bg-slate-800/50 transition-colors text-left',
                isSelected && 'bg-slate-800 border-l-2 border-blue-500'
              )}
              aria-selected={isSelected}
              aria-label={`${driver.driverCode}${unread > 0 ? `, ${unread} unread` : ''}${muted ? ', muted' : ''}`}
            >
              {/* Team colour dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: `#${driver.teamColour}` }}
                aria-hidden="true"
              />

              {/* Driver code */}
              <span className="text-xs font-mono font-bold text-slate-200 truncate flex-1">
                {driver.driverCode}
              </span>

              {/* Unread count badge */}
              {unread > 0 && (
                <span
                  className="text-[9px] bg-orange-500 text-white rounded-full w-4 h-4 flex items-center justify-center ml-auto shrink-0 font-bold leading-none"
                  aria-hidden="true"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}

              {/* Mute toggle */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  radioState.toggleMute(driver.driverNumber);
                }}
                className="shrink-0 p-0.5 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label={muted ? `Unmute ${driver.driverCode}` : `Mute ${driver.driverCode}`}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? (
                  <VolumeX className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <Volume2 className="w-3 h-3" aria-hidden="true" />
                )}
              </button>
            </button>
          );
        })}

        {sortedDrivers.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-slate-600">
            No drivers to display
          </div>
        )}
      </div>
    </div>
  );
}

// GUID: RADIO_ZOOM_PANEL-007-v01
// [Intent] Right message thread column — shows messages for selected driver,
//          iMessage style, oldest at top, auto-scrolls to bottom on new messages.
function MessageThreadColumn({
  selectedDriver,
  drivers,
  radioMessages,
  radioState,
}: {
  selectedDriver: number | null;
  drivers: DriverRaceState[];
  radioMessages: RadioMessage[];
  radioState: UseRadioStateReturn;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedDriverData = useMemo(
    () => drivers.find((d) => d.driverNumber === selectedDriver) ?? null,
    [drivers, selectedDriver]
  );

  // Messages for the selected driver, sorted oldest first (iMessage style)
  const threadMessages = useMemo(() => {
    if (selectedDriver === null) return [];
    return [...radioMessages]
      .filter((m) => m.driverNumber === selectedDriver)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [radioMessages, selectedDriver]);

  // Enrich messages with isRead state
  const enrichedMessages = useMemo(
    () =>
      threadMessages.map((m) => ({
        ...m,
        isRead: radioState.isRead(m.id),
      })),
    [threadMessages, radioState]
  );

  const handleMarkAllRead = useCallback(() => {
    if (selectedDriver === null) return;
    radioState.markAllRead(selectedDriver, radioMessages);
  }, [selectedDriver, radioMessages, radioState]);

  // Auto-scroll to bottom when messages change or panel opens
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [enrichedMessages.length, selectedDriver]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Thread header */}
      <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2 shrink-0">
        {selectedDriverData ? (
          <>
            {/* Team colour chip */}
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: `#${selectedDriverData.teamColour}` }}
              aria-hidden="true"
            />
            <span className="text-xs font-mono font-bold text-slate-200">
              {selectedDriverData.driverCode}
            </span>
            <span className="text-xs text-slate-500 truncate">
              {selectedDriverData.teamName}
            </span>

            {/* Mark all read */}
            {enrichedMessages.some((m) => !m.isRead) && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-slate-500 hover:text-slate-300 ml-auto transition-colors"
                aria-label="Mark all messages as read"
              >
                Mark all read
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-500">No driver selected</span>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {selectedDriver === null ? (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">
            Select a driver to view radio
          </div>
        ) : enrichedMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">
            No radio messages for {selectedDriverData?.driverCode ?? 'this driver'}
          </div>
        ) : (
          <>
            {enrichedMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                radioState={radioState}
              />
            ))}
            {/* Auto-scroll anchor */}
            <div ref={bottomRef} aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  );
}

// GUID: RADIO_ZOOM_PANEL-008-v01
// [Intent] Main RadioZoomPanel component — slide-up 50vh overlay with two-column layout.
//          Registers audio unlock listener on mount.
export function RadioZoomPanel({
  isOpen,
  onClose,
  drivers,
  radioMessages,
  radioState,
  selectedDriver,
  onSelectDriver,
}: RadioZoomPanelProps) {
  // Unlock audio on first user click anywhere in the document
  useEffect(() => {
    const unlock = () => {
      ensureAudioUnlocked();
    };
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — subtle dimming above the panel */}
          <motion.div
            key="radio-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-up panel */}
          <motion.div
            key="radio-panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 h-[50vh] bg-slate-950 border-t border-slate-800 z-50 flex flex-row overflow-hidden"
            role="dialog"
            aria-label="Team radio panel"
            aria-modal="true"
          >
            {/* Left: driver list */}
            <DriverListColumn
              drivers={drivers}
              radioMessages={radioMessages}
              radioState={radioState}
              selectedDriver={selectedDriver}
              onSelectDriver={onSelectDriver}
              onClose={onClose}
            />

            {/* Right: message thread */}
            <MessageThreadColumn
              selectedDriver={selectedDriver}
              drivers={drivers}
              radioMessages={radioMessages}
              radioState={radioState}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
