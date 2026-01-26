'use client';

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';

// Timing constants
const SHOW_DELAY_MS = 4000;      // Anti-flash: only show after 4s
const GIVE_UP_MS = 30000;        // Give up after 30s
const ORBIT_DURATION = 2.5;      // Time for one full orbit (seconds)

// F1 Car SVG - Geometric wireframe, top-down view
const F1CarIcon = () => (
  <svg
    viewBox="0 0 24 48"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-full h-full text-current"
  >
    {/* Nose & Front Wing */}
    <path d="M12 2 L12 8 M7 8 L17 8" />
    {/* Body */}
    <path d="M10 11 L10 22 L8 28 L9 38 L15 38 L16 28 L14 22 L14 11 Z" />
    {/* Tires */}
    <rect x="3" y="10" width="4" height="7" rx="1" />
    <rect x="17" y="10" width="4" height="7" rx="1" />
    <rect x="2" y="28" width="5" height="9" rx="1" />
    <rect x="17" y="28" width="5" height="9" rx="1" />
    {/* Rear Wing */}
    <path d="M6 41 L18 41 L18 44 L6 44 Z" />
  </svg>
);

// Skid mark trail component
const SkidTrail = ({ angle, opacity }: { angle: number; opacity: number }) => {
  const radius = 72; // Match orbit radius
  const x = Math.cos((angle - 90) * Math.PI / 180) * radius;
  const y = Math.sin((angle - 90) * Math.PI / 180) * radius;

  return (
    <motion.div
      className="absolute w-1.5 h-1.5 rounded-full bg-neutral-600/30"
      style={{
        left: '50%',
        top: '50%',
        x: x - 3,
        y: y - 3,
      }}
      initial={{ opacity: opacity * 0.6 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1.5, ease: 'easeOut' }}
    />
  );
};

// Animated percentage counter with mechanical easing
const PercentageCounter = ({ targetValue }: { targetValue: number }) => {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    // Mechanical easing: fast start, slow end
    const controls = animate(count, targetValue, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1], // Custom cubic-bezier for mechanical feel
    });

    const unsubscribe = rounded.on('change', (v) => setDisplayValue(v));

    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [targetValue, count, rounded]);

  return (
    <span className="tabular-nums font-light tracking-tight">
      {displayValue}
    </span>
  );
};

// Main Smart Loader component
interface SmartLoaderProps {
  isLoading: boolean;
  progress?: number; // 0-100, optional simulated progress
  onGiveUp?: () => void;
}

export function SmartLoader({ isLoading, progress, onGiveUp }: SmartLoaderProps) {
  const [showLoader, setShowLoader] = useState(false);
  const [hasGivenUp, setHasGivenUp] = useState(false);
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [trails, setTrails] = useState<{ id: number; angle: number; opacity: number }[]>([]);
  const [carAngle, setCarAngle] = useState(0);
  const trailIdRef = useRef(0);
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const giveUpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Clean up all timers
  const cleanUp = useCallback(() => {
    if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    if (giveUpTimeoutRef.current) clearTimeout(giveUpTimeoutRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    showTimeoutRef.current = null;
    giveUpTimeoutRef.current = null;
    progressIntervalRef.current = null;
    animationFrameRef.current = null;
    startTimeRef.current = null;
  }, []);

  // Handle loading state changes
  useEffect(() => {
    if (isLoading) {
      // Reset state
      setHasGivenUp(false);
      setSimulatedProgress(0);
      setTrails([]);
      startTimeRef.current = Date.now();

      // Anti-flash delay: only show after 4s
      showTimeoutRef.current = setTimeout(() => {
        setShowLoader(true);

        // Start simulated progress if no external progress provided
        if (progress === undefined) {
          progressIntervalRef.current = setInterval(() => {
            setSimulatedProgress((prev) => {
              // Slow down as we approach 90%
              if (prev < 30) return prev + 2;
              if (prev < 60) return prev + 1.5;
              if (prev < 80) return prev + 0.8;
              if (prev < 90) return prev + 0.3;
              return prev; // Cap at ~90% until done
            });
          }, 100);
        }
      }, SHOW_DELAY_MS);

      // Give up timeout
      giveUpTimeoutRef.current = setTimeout(() => {
        setHasGivenUp(true);
        setShowLoader(true);
        cleanUp();
        onGiveUp?.();
      }, GIVE_UP_MS);

    } else {
      // Loading complete
      if (showLoader && !hasGivenUp) {
        // Complete the progress animation
        setSimulatedProgress(100);
        // Hide after brief completion animation
        setTimeout(() => {
          setShowLoader(false);
          setSimulatedProgress(0);
          setTrails([]);
        }, 400);
      } else {
        setShowLoader(false);
      }
      cleanUp();
    }

    return cleanUp;
  }, [isLoading, progress, showLoader, hasGivenUp, cleanUp, onGiveUp]);

  // Continuous car animation and trail generation
  useEffect(() => {
    if (!showLoader || hasGivenUp) return;

    let lastTrailAngle = 0;
    const trailInterval = 15; // Degrees between trail marks

    const animateCar = () => {
      const elapsed = (Date.now() - (startTimeRef.current || Date.now())) / 1000;
      const angle = (elapsed / ORBIT_DURATION) * 360;
      setCarAngle(angle % 360);

      // Add trail marks at intervals
      const currentAngle = angle % 360;
      if (Math.abs(currentAngle - lastTrailAngle) >= trailInterval) {
        lastTrailAngle = currentAngle;
        const newTrail = {
          id: trailIdRef.current++,
          angle: currentAngle,
          opacity: 0.5 + Math.random() * 0.3,
        };
        setTrails((prev) => [...prev.slice(-20), newTrail]); // Keep last 20 trails
      }

      animationFrameRef.current = requestAnimationFrame(animateCar);
    };

    animationFrameRef.current = requestAnimationFrame(animateCar);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [showLoader, hasGivenUp]);

  const displayProgress = progress ?? simulatedProgress;

  // Calculate car position on orbit
  const orbitRadius = 72;
  const carX = Math.cos((carAngle - 90) * Math.PI / 180) * orbitRadius;
  const carY = Math.sin((carAngle - 90) * Math.PI / 180) * orbitRadius;

  return (
    <AnimatePresence>
      {showLoader && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/95 backdrop-blur-sm"
        >
          {hasGivenUp ? (
            // Give up state
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-center px-8"
            >
              <p className="text-neutral-400 text-lg font-light tracking-wide">
                Sorry that didn't work and the error has been logged.
              </p>
            </motion.div>
          ) : (
            // Loading state with doughnut animation
            <div className="relative w-64 h-64 flex items-center justify-center">
              {/* Orbit track - subtle ring */}
              <div
                className="absolute rounded-full border border-neutral-800/50"
                style={{
                  width: orbitRadius * 2 + 24,
                  height: orbitRadius * 2 + 24,
                }}
              />

              {/* Skid mark trails */}
              {trails.map((trail) => (
                <SkidTrail key={trail.id} angle={trail.angle} opacity={trail.opacity} />
              ))}

              {/* F1 Car doing doughnuts */}
              <motion.div
                className="absolute w-6 h-12 text-neutral-300"
                style={{
                  left: '50%',
                  top: '50%',
                  x: carX - 12,
                  y: carY - 24,
                  rotate: carAngle + 90, // Point tangent to circle (drifting)
                }}
              >
                <F1CarIcon />
              </motion.div>

              {/* Center percentage */}
              <div className="relative z-10 flex flex-col items-center">
                <span className="text-6xl text-neutral-100 font-extralight">
                  <PercentageCounter targetValue={Math.round(displayProgress)} />
                  <span className="text-3xl text-neutral-500 ml-0.5">%</span>
                </span>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Context for global smart loader
interface SmartLoaderContextType {
  startLoading: (id?: string) => void;
  stopLoading: (id?: string) => void;
  setProgress: (value: number) => void;
  isLoading: boolean;
}

const SmartLoaderContext = createContext<SmartLoaderContextType>({
  startLoading: () => {},
  stopLoading: () => {},
  setProgress: () => {},
  isLoading: false,
});

export function useSmartLoader() {
  return useContext(SmartLoaderContext);
}

// Provider component
interface SmartLoaderProviderProps {
  children: React.ReactNode;
}

export function SmartLoaderProvider({ children }: SmartLoaderProviderProps) {
  const [activeLoaders, setActiveLoaders] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<number | undefined>(undefined);

  const isLoading = activeLoaders.size > 0;

  const startLoading = useCallback((id?: string) => {
    const loaderId = id || `loader_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setActiveLoaders((prev) => {
      const next = new Set(prev);
      next.add(loaderId);
      return next;
    });
    setProgress(undefined); // Reset progress for new load
  }, []);

  const stopLoading = useCallback((id?: string) => {
    setActiveLoaders((prev) => {
      const next = new Set(prev);
      if (id) {
        next.delete(id);
      } else {
        next.clear();
      }
      return next;
    });
  }, []);

  const handleGiveUp = useCallback(() => {
    // Clear all loaders when giving up
    setActiveLoaders(new Set());
    console.error('[SmartLoader] Loading timed out after 30 seconds');
  }, []);

  return (
    <SmartLoaderContext.Provider value={{ startLoading, stopLoading, setProgress, isLoading }}>
      {children}
      <SmartLoader isLoading={isLoading} progress={progress} onGiveUp={handleGiveUp} />
    </SmartLoaderContext.Provider>
  );
}

// Demo component for testing
export function SmartLoaderDemo() {
  const [isLoading, setIsLoading] = useState(false);
  const [simulatedDuration, setSimulatedDuration] = useState(6000);

  const startDemo = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), simulatedDuration);
  };

  return (
    <div className="p-8 space-y-4 bg-neutral-900 min-h-screen">
      <h2 className="text-xl text-neutral-100 font-light">Smart Loader Demo</h2>

      <div className="flex gap-4 items-center">
        <label className="text-neutral-400 text-sm">
          Simulated load duration (ms):
        </label>
        <input
          type="number"
          value={simulatedDuration}
          onChange={(e) => setSimulatedDuration(Number(e.target.value))}
          className="bg-neutral-800 text-neutral-100 px-3 py-2 rounded w-32"
          step={1000}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={startDemo}
          disabled={isLoading}
          className="px-4 py-2 bg-neutral-700 text-neutral-100 rounded hover:bg-neutral-600 disabled:opacity-50"
        >
          Start Loading
        </button>
        <button
          onClick={() => setIsLoading(false)}
          className="px-4 py-2 bg-neutral-800 text-neutral-400 rounded hover:bg-neutral-700"
        >
          Stop
        </button>
      </div>

      <div className="text-sm text-neutral-500 space-y-1">
        <p>- Set duration &lt; 4000ms: Loader will NOT appear (anti-flash)</p>
        <p>- Set duration &gt; 4000ms: Loader appears after 4s delay</p>
        <p>- Set duration &gt; 30000ms: "Give up" message appears at 30s</p>
      </div>

      <SmartLoader isLoading={isLoading} />
    </div>
  );
}
