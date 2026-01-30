// GUID: COMPONENT_CINEMATIC_INTRO-000-v03
// [Intent] Full-screen cinematic intro animation for the About page. Plays a 24-second F1-themed sequence through four phases: Grid Entry (version display), Telemetry (live stats), Module Tour (feature showcase), and Finish (chequered flag + logo). First-time visitors see this automatically; returning visitors can replay it.
// [Inbound Trigger] Rendered by AboutPageClient when showIntro state is true (first visit or replay).
// [Downstream Impact] Calls onComplete callback when animation finishes or user skips, which persists the "seen" flag to localStorage and hides the intro.

'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, Target, Users, BarChart3, TrendingUp, Calendar, MessageSquare, Gauge, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';

// GUID: COMPONENT_CINEMATIC_INTRO-001-v03
// [Intent] Props interface for CinematicIntro. Receives live data (totalTeams, onlineUsers) and a completion callback.
// [Inbound Trigger] Defined at module level; consumed when CinematicIntro is instantiated.
// [Downstream Impact] totalTeams and onlineUsers drive the telemetry phase counters; onComplete controls intro lifecycle in the parent.
interface CinematicIntroProps {
  totalTeams: number;
  onlineUsers: number;
  onComplete: () => void;
}

// GUID: COMPONENT_CINEMATIC_INTRO-002-v03
// [Intent] F1 brand red colour constant used throughout the intro for visual consistency.
// [Inbound Trigger] Referenced by all sub-components for styling borders, text, SVG strokes, and backgrounds.
// [Downstream Impact] Changing this value alters the entire colour scheme of the cinematic intro.
const F1_RED = '#FF1801';

// GUID: COMPONENT_CINEMATIC_INTRO-003-v03
// [Intent] Timing configuration for the four animation phases. Each phase has a start and end time in milliseconds, controlling the overall 24-second animation timeline.
// [Inbound Trigger] Referenced by the phase progression useEffect to schedule setTimeout transitions.
// [Downstream Impact] Altering these timings changes phase durations and total intro length. Module cycling in Phase 3 depends on moduleTour.start.
const PHASE_TIMINGS = {
  gridEntry: { start: 0, end: 5000 },
  telemetry: { start: 5000, end: 10000 },
  moduleTour: { start: 10000, end: 20000 },
  finish: { start: 20000, end: 24000 },
};

// GUID: COMPONENT_CINEMATIC_INTRO-004-v03
// [Intent] Static data for the module tour phase (Phase 3). Each entry has a Lucide icon, display name, and short description representing a key app feature.
// [Inbound Trigger] Iterated in the Phase 3 render block, indexed by currentModuleIndex state.
// [Downstream Impact] Adding/removing entries changes the number of module cards shown during the tour; timing is spaced at 1500ms intervals.
const MODULES = [
  { icon: Target, name: 'PREDICTIONS', desc: 'Pick your top 6' },
  { icon: TrendingUp, name: 'STANDINGS', desc: 'Track the leaderboard' },
  { icon: BarChart3, name: 'RESULTS', desc: 'Race outcomes' },
  { icon: Calendar, name: 'SCHEDULE', desc: 'Never miss a race' },
  { icon: Users, name: 'TEAMS', desc: 'See all competitors' },
  { icon: MessageSquare, name: 'COMMUNITY', desc: 'Join the paddock' },
];

// GUID: COMPONENT_CINEMATIC_INTRO-005-v03
// [Intent] Animated number counter that eases from 0 to a target value over a specified duration. Used in the telemetry phase to display live stats with a dramatic count-up effect.
// [Inbound Trigger] Mounted during Phase 2 (telemetry) with target values for totalTeams and onlineUsers.
// [Downstream Impact] Purely visual; no side effects beyond the interval timer which is cleaned up on unmount.
const AnimatedCounter = ({ target, duration = 2000, prefix = '', suffix = '' }: {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) => {
  const [count, setCount] = useState(0);

  // GUID: COMPONENT_CINEMATIC_INTRO-006-v03
  // [Intent] Drives the count-up animation using setInterval at ~60fps. Applies a cubic ease-out curve for a decelerating effect.
  // [Inbound Trigger] Runs when target or duration props change.
  // [Downstream Impact] Updates count state on each frame; clears interval when animation completes or component unmounts.
  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing function for aggressive count-up
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);

  return (
    <span className="font-mono tabular-nums">
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-007-v03
// [Intent] Text component that periodically applies a brief RGB-shift glitch effect, creating a cyberpunk/HUD aesthetic for the version number display.
// [Inbound Trigger] Mounted during Phase 1 (gridEntry) to display the version string with visual flair.
// [Downstream Impact] Purely visual; the glitch fires every 2 seconds for 100ms via setInterval, cleaned up on unmount.
const GlitchText = ({ text, className = '' }: { text: string; className?: string }) => {
  const [glitchActive, setGlitchActive] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setGlitchActive(true);
      setTimeout(() => setGlitchActive(false), 100);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className={`relative inline-block ${className}`}>
      <span className="relative z-10">{text}</span>
      {glitchActive && (
        <>
          <span
            className="absolute top-0 left-0 z-0 opacity-70"
            style={{ color: '#00ffff', transform: 'translate(-2px, -1px)' }}
          >
            {text}
          </span>
          <span
            className="absolute top-0 left-0 z-0 opacity-70"
            style={{ color: F1_RED, transform: 'translate(2px, 1px)' }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-008-v03
// [Intent] Renders a CSS perspective grid with horizontal and vertical lines, creating a retro F1 starting grid / Tron-like visual. Horizontal lines animate downward when isMoving is true.
// [Inbound Trigger] Mounted during Phase 1 (gridEntry) with isMoving=true.
// [Downstream Impact] Purely decorative background element; no data dependencies.
const PerspectiveGrid = ({ isMoving }: { isMoving: boolean }) => {
  return (
    <div className="absolute inset-0 overflow-hidden perspective-[800px]">
      {/* Horizontal grid lines */}
      <div
        className="absolute inset-0"
        style={{
          transform: 'rotateX(60deg) translateZ(-100px)',
          transformOrigin: 'center bottom',
        }}
      >
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={`h-${i}`}
            className="absolute left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${F1_RED}40, transparent)`,
              top: `${(i + 1) * 5}%`,
            }}
            animate={isMoving ? {
              translateY: ['0%', '100%'],
            } : {}}
            transition={{
              duration: 0.5,
              repeat: isMoving ? Infinity : 0,
              ease: 'linear',
            }}
          />
        ))}
      </div>
      {/* Vertical converging lines */}
      {Array.from({ length: 11 }).map((_, i) => {
        const offset = (i - 5) * 10;
        return (
          <div
            key={`v-${i}`}
            className="absolute h-full w-px"
            style={{
              background: `linear-gradient(180deg, transparent, ${F1_RED}30, ${F1_RED}60)`,
              left: `${50 + offset}%`,
              transformOrigin: 'bottom center',
              transform: `perspective(500px) rotateY(${offset * 0.5}deg)`,
            }}
          />
        );
      })}
    </div>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-009-v03
// [Intent] Heads-Up Display overlay with vignette darkening, scan lines, corner brackets, and status readouts. Creates an immersive cockpit/telemetry screen aesthetic.
// [Inbound Trigger] Rendered in Phases 1, 2, and 3 as a persistent overlay layer.
// [Downstream Impact] Purely decorative; uses pointer-events-none so it does not block user interaction with the skip button.
const HUDOverlay = () => {
  return (
    <>
      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.8) 100%)',
        }}
      />
      {/* Scan lines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
        }}
      />
      {/* Corner brackets */}
      <div className="absolute top-4 left-4 w-16 h-16 border-l-2 border-t-2" style={{ borderColor: F1_RED }} />
      <div className="absolute top-4 right-4 w-16 h-16 border-r-2 border-t-2" style={{ borderColor: F1_RED }} />
      <div className="absolute bottom-4 left-4 w-16 h-16 border-l-2 border-b-2" style={{ borderColor: F1_RED }} />
      <div className="absolute bottom-4 right-4 w-16 h-16 border-r-2 border-b-2" style={{ borderColor: F1_RED }} />
      {/* Data readouts in corners */}
      <div className="absolute top-6 left-20 font-mono text-xs opacity-60" style={{ color: F1_RED }}>
        SYS: ONLINE
      </div>
      <div className="absolute top-6 right-20 font-mono text-xs opacity-60 text-right" style={{ color: F1_RED }}>
        LAP: 01/24
      </div>
    </>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-010-v03
// [Intent] Animated chequered flag pattern that sweeps across the screen from left to right during the finish phase, signalling the end of the intro sequence.
// [Inbound Trigger] Rendered during Phase 4 (finish); animation triggers when visible prop becomes true.
// [Downstream Impact] Purely visual transition effect; after the sweep completes, the logo is shown.
const ChequeredFlag = ({ visible }: { visible: boolean }) => {
  return (
    <motion.div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      initial={{ x: '-100%' }}
      animate={visible ? { x: '100%' } : { x: '-100%' }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `
            repeating-conic-gradient(
              #ffffff 0deg 90deg,
              #000000 90deg 180deg
            )
          `,
          backgroundSize: '60px 60px',
          opacity: 0.9,
        }}
      />
    </motion.div>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-011-v03
// [Intent] SVG logo for "PRIX SIX" with animated path drawing. Each letter (P, R, I, X) is drawn sequentially using Framer Motion's pathLength animation, followed by a fade-in "SIX" text element.
// [Inbound Trigger] Rendered during Phase 4 (finish) after the chequered flag sweep completes; animate prop controls whether paths draw.
// [Downstream Impact] Purely visual; final branding element before the intro completes.
const PrixSixLogo = ({ animate }: { animate: boolean }) => {
  return (
    <motion.svg
      width="300"
      height="120"
      viewBox="0 0 400 150"
      fill="none"
      className="mx-auto"
    >
      {/* P shape */}
      <motion.path
        d="M30 30 H100 C130 30, 145 50, 145 75 C145 100, 130 120, 100 120 H60 V80 H95 C105 80, 110 75, 110 70 C110 65, 105 60, 95 60 H60 V120"
        stroke={F1_RED}
        strokeWidth="8"
        fill="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={animate ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      />
      {/* R */}
      <motion.path
        d="M160 30 H220 C245 30, 260 50, 260 70 C260 85, 250 95, 235 100 L270 120 M195 30 V120 M195 90 H220"
        stroke={F1_RED}
        strokeWidth="8"
        fill="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={animate ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration: 1, delay: 0.2, ease: 'easeInOut' }}
      />
      {/* I */}
      <motion.path
        d="M290 30 V120 M275 30 H305 M275 120 H305"
        stroke={F1_RED}
        strokeWidth="8"
        fill="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={animate ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration: 0.5, delay: 0.4, ease: 'easeInOut' }}
      />
      {/* X */}
      <motion.path
        d="M330 30 L380 120 M380 30 L330 120"
        stroke={F1_RED}
        strokeWidth="8"
        fill="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={animate ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration: 0.8, delay: 0.5, ease: 'easeInOut' }}
      />
      {/* Text "SIX" below - simplified */}
      <motion.text
        x="200"
        y="145"
        textAnchor="middle"
        fill={F1_RED}
        fontSize="24"
        fontFamily="monospace"
        fontWeight="bold"
        initial={{ opacity: 0 }}
        animate={animate ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.5, delay: 1.2 }}
      >
        SIX
      </motion.text>
    </motion.svg>
  );
};

// GUID: COMPONENT_CINEMATIC_INTRO-012-v03
// [Intent] Main CinematicIntro component. Orchestrates the 4-phase animation sequence using timed state transitions. Renders a full-screen black overlay with phase-specific content, a skip button, and a progress bar.
// [Inbound Trigger] Mounted by AboutPageClient when showIntro is true.
// [Downstream Impact] Calls onComplete when the animation finishes or user clicks "SKIP INTRO", triggering localStorage persistence and returning to the About page content.
export default function CinematicIntro({ totalTeams, onlineUsers, onComplete }: CinematicIntroProps) {
  const [phase, setPhase] = useState<'gridEntry' | 'telemetry' | 'moduleTour' | 'finish' | 'done'>('gridEntry');
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [showFlag, setShowFlag] = useState(false);
  const [showLogo, setShowLogo] = useState(false);

  // GUID: COMPONENT_CINEMATIC_INTRO-013-v03
  // [Intent] Skip handler allowing users to bypass the intro at any point. Sets phase to 'done' and immediately calls onComplete.
  // [Inbound Trigger] User clicks the "SKIP INTRO" button (visible after 1-second delay).
  // [Downstream Impact] Short-circuits all pending timers (cleaned up by the useEffect return); triggers onComplete in the parent to persist the "seen" flag.
  const handleSkip = useCallback(() => {
    setPhase('done');
    onComplete();
  }, [onComplete]);

  // GUID: COMPONENT_CINEMATIC_INTRO-014-v03
  // [Intent] Master timeline orchestrator. Schedules all phase transitions, module cycling, flag display, and completion using setTimeout calls based on PHASE_TIMINGS. All timers are cleaned up on unmount.
  // [Inbound Trigger] Runs once on mount (onComplete is stable via useCallback in parent).
  // [Downstream Impact] Drives the entire animation lifecycle. Phase state changes trigger AnimatePresence transitions. Calls onComplete at the end of the finish phase.
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Phase 1 -> 2
    timers.push(setTimeout(() => setPhase('telemetry'), PHASE_TIMINGS.telemetry.start));

    // Phase 2 -> 3
    timers.push(setTimeout(() => setPhase('moduleTour'), PHASE_TIMINGS.moduleTour.start));

    // Module cycling during Phase 3
    for (let i = 0; i < MODULES.length; i++) {
      timers.push(setTimeout(() => setCurrentModuleIndex(i), PHASE_TIMINGS.moduleTour.start + (i * 1500)));
    }

    // Phase 3 -> 4
    timers.push(setTimeout(() => {
      setPhase('finish');
      setShowFlag(true);
    }, PHASE_TIMINGS.finish.start));

    // Show logo after flag
    timers.push(setTimeout(() => {
      setShowFlag(false);
      setShowLogo(true);
    }, PHASE_TIMINGS.finish.start + 1500));

    // Complete
    timers.push(setTimeout(() => {
      setPhase('done');
      onComplete();
    }, PHASE_TIMINGS.finish.end));

    return () => timers.forEach(t => clearTimeout(t));
  }, [onComplete]);

  if (phase === 'done') return null;

  // GUID: COMPONENT_CINEMATIC_INTRO-015-v03
  // [Intent] Main render: full-screen fixed overlay with AnimatePresence managing phase transitions. Each phase renders its own motion.div with entry/exit animations. Skip button and progress bar are always visible.
  // [Inbound Trigger] Re-renders on phase, currentModuleIndex, showFlag, or showLogo state changes.
  // [Downstream Impact] Visual output only; skip button calls handleSkip; progress bar is a pure 24-second linear animation.
  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden">
      <AnimatePresence mode="wait">
        {/* Phase 1: Grid Entry */}
        {phase === 'gridEntry' && (
          <motion.div
            key="gridEntry"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <PerspectiveGrid isMoving={true} />
            <HUDOverlay />

            {/* Central version display */}
            <motion.div
              className="relative z-10 text-center"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.div
                className="text-xs font-mono tracking-[0.5em] mb-2 opacity-60"
                style={{ color: F1_RED }}
              >
                SYSTEM STATUS
              </motion.div>
              <div className="text-6xl md:text-8xl font-mono font-black tracking-tight">
                <GlitchText text={`V${APP_VERSION}`} className="text-white" />
              </div>
              <motion.div
                className="mt-4 flex items-center justify-center gap-2 text-sm font-mono"
                style={{ color: F1_RED }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                INITIALIZING
              </motion.div>
            </motion.div>
          </motion.div>
        )}

        {/* Phase 2: Telemetry */}
        {phase === 'telemetry' && (
          <motion.div
            key="telemetry"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5 }}
          >
            <HUDOverlay />

            <div className="relative z-10 grid grid-cols-2 gap-8 md:gap-16 p-8">
              {/* Teams Counter */}
              <motion.div
                className="text-center"
                initial={{ x: -100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex items-center justify-center gap-2 mb-4">
                  <Gauge className="w-8 h-8" style={{ color: F1_RED }} />
                  <span className="text-xs font-mono tracking-widest opacity-60">TOTAL DRIVERS</span>
                </div>
                <div className="text-5xl md:text-7xl font-mono font-black" style={{ color: F1_RED }}>
                  <AnimatedCounter target={totalTeams || 16} duration={2500} />
                </div>
                <div className="mt-2 text-xs font-mono opacity-40">REGISTERED TEAMS</div>
              </motion.div>

              {/* Online Counter */}
              <motion.div
                className="text-center"
                initial={{ x: 100, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="relative">
                    <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#22c55e40' }} />
                    <span className="relative block w-3 h-3 rounded-full bg-green-500" />
                  </div>
                  <span className="text-xs font-mono tracking-widest opacity-60">ON TRACK</span>
                </div>
                <div className="text-5xl md:text-7xl font-mono font-black text-green-500">
                  <AnimatedCounter target={onlineUsers || 3} duration={2000} />
                </div>
                <div className="mt-2 text-xs font-mono opacity-40">LIVE NOW</div>
              </motion.div>
            </div>

            {/* RPM-style gauge decoration */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
              <motion.div
                className="flex gap-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                {Array.from({ length: 12 }).map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-3 h-8 rounded-sm"
                    style={{
                      backgroundColor: i < 8 ? '#22c55e' : i < 10 ? '#eab308' : F1_RED,
                    }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: i < 9 ? 1 : [1, 0.7, 1] }}
                    transition={{
                      delay: 0.8 + (i * 0.05),
                      duration: 0.2,
                      ...(i >= 9 && { repeat: Infinity, duration: 0.3 }),
                    }}
                  />
                ))}
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* Phase 3: Module Tour */}
        {phase === 'moduleTour' && (
          <motion.div
            key="moduleTour"
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Speed lines */}
            <div className="absolute inset-0">
              {Array.from({ length: 30 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute h-px"
                  style={{
                    left: 0,
                    right: 0,
                    top: `${Math.random() * 100}%`,
                    background: `linear-gradient(90deg, transparent, ${F1_RED}40, transparent)`,
                  }}
                  animate={{
                    x: ['-100%', '100%'],
                    opacity: [0, 1, 0],
                  }}
                  transition={{
                    duration: 0.5 + Math.random() * 0.5,
                    repeat: Infinity,
                    delay: Math.random() * 0.5,
                  }}
                />
              ))}
            </div>

            <HUDOverlay />

            {/* Current module card */}
            <AnimatePresence mode="wait">
              <motion.div
                key={currentModuleIndex}
                className="relative z-10 text-center"
                initial={{ x: 300, opacity: 0, scale: 0.8, rotateY: -30 }}
                animate={{ x: 0, opacity: 1, scale: 1, rotateY: 0 }}
                exit={{ x: -300, opacity: 0, scale: 0.8, rotateY: 30 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <div
                  className="p-8 md:p-12 rounded-2xl border-2"
                  style={{
                    borderColor: F1_RED,
                    background: 'rgba(0,0,0,0.8)',
                    boxShadow: `0 0 60px ${F1_RED}30`,
                  }}
                >
                  {(() => {
                    const Module = MODULES[currentModuleIndex];
                    const Icon = Module.icon;
                    return (
                      <>
                        <Icon className="w-16 h-16 mx-auto mb-4" style={{ color: F1_RED }} />
                        <div className="text-3xl md:text-5xl font-mono font-black mb-2" style={{ color: F1_RED }}>
                          {Module.name}
                        </div>
                        <div className="text-sm font-mono opacity-60">{Module.desc}</div>
                      </>
                    );
                  })()}
                </div>

                {/* Module progress indicator */}
                <div className="mt-6 flex justify-center gap-2">
                  {MODULES.map((_, i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full transition-all duration-300"
                      style={{
                        backgroundColor: i === currentModuleIndex ? F1_RED : 'rgba(255,255,255,0.2)',
                        transform: i === currentModuleIndex ? 'scale(1.5)' : 'scale(1)',
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}

        {/* Phase 4: Finish */}
        {phase === 'finish' && (
          <motion.div
            key="finish"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <ChequeredFlag visible={showFlag} />

            {showLogo && (
              <motion.div
                className="relative z-10"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <PrixSixLogo animate={true} />
                <motion.div
                  className="text-center mt-8 font-mono text-sm"
                  style={{ color: F1_RED }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.5 }}
                >
                  PREDICTION LEAGUE
                </motion.div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Skip button - always visible */}
      <motion.div
        className="absolute bottom-6 right-6 z-50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSkip}
          className="font-mono text-xs gap-2 opacity-60 hover:opacity-100 border border-white/20 hover:border-white/40"
        >
          SKIP INTRO
          <X className="w-3 h-3" />
        </Button>
      </motion.div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
        <motion.div
          className="h-full"
          style={{ backgroundColor: F1_RED }}
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 24, ease: 'linear' }}
        />
      </div>
    </div>
  );
}
