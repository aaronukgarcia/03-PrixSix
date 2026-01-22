"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPLASH_SHOWN_KEY = "prixsix_splash_shown";

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<"lights" | "flash" | "logo" | "exit">("lights");
  const [activeLights, setActiveLights] = useState(0);

  const handleSkip = useCallback(() => {
    sessionStorage.setItem(SPLASH_SHOWN_KEY, "true");
    onComplete();
  }, [onComplete]);

  // Light sequence: turn on lights one by one
  useEffect(() => {
    if (phase !== "lights") return;

    const lightTimers: NodeJS.Timeout[] = [];

    // Turn on each pair of lights with 300ms interval
    for (let i = 1; i <= 5; i++) {
      lightTimers.push(
        setTimeout(() => setActiveLights(i), i * 300)
      );
    }

    // After all lights are on, wait a beat then proceed to flash
    lightTimers.push(
      setTimeout(() => setPhase("flash"), 1800)
    );

    return () => lightTimers.forEach(clearTimeout);
  }, [phase]);

  // Flash phase
  useEffect(() => {
    if (phase !== "flash") return;

    const timer = setTimeout(() => setPhase("logo"), 150);
    return () => clearTimeout(timer);
  }, [phase]);

  // Logo phase
  useEffect(() => {
    if (phase !== "logo") return;

    const timer = setTimeout(() => setPhase("exit"), 2000);
    return () => clearTimeout(timer);
  }, [phase]);

  // Exit phase
  useEffect(() => {
    if (phase !== "exit") return;

    const timer = setTimeout(() => {
      sessionStorage.setItem(SPLASH_SHOWN_KEY, "true");
      onComplete();
    }, 500);
    return () => clearTimeout(timer);
  }, [phase, onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center overflow-hidden"
        initial={{ y: 0 }}
        animate={{ y: phase === "exit" ? "-100%" : 0 }}
        transition={{ duration: 0.5, ease: "easeIn" }}
      >
        {/* White flash overlay */}
        <AnimatePresence>
          {phase === "flash" && (
            <motion.div
              className="absolute inset-0 bg-white z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
          )}
        </AnimatePresence>

        {/* F1 Starting Lights */}
        {(phase === "lights" || phase === "flash") && (
          <div className="flex gap-6 md:gap-10">
            {[1, 2, 3, 4, 5].map((lightNum) => (
              <div key={lightNum} className="flex flex-col gap-3">
                {/* Top light */}
                <motion.div
                  className="w-8 h-8 md:w-12 md:h-12 rounded-full border-2 border-zinc-700"
                  initial={{ backgroundColor: "#1a1a1a", boxShadow: "none" }}
                  animate={{
                    backgroundColor: activeLights >= lightNum && phase !== "flash" ? "#dc2626" : "#1a1a1a",
                    boxShadow: activeLights >= lightNum && phase !== "flash"
                      ? "0 0 30px 10px rgba(220, 38, 38, 0.6)"
                      : "none",
                  }}
                  transition={{ duration: 0.1 }}
                />
                {/* Bottom light */}
                <motion.div
                  className="w-8 h-8 md:w-12 md:h-12 rounded-full border-2 border-zinc-700"
                  initial={{ backgroundColor: "#1a1a1a", boxShadow: "none" }}
                  animate={{
                    backgroundColor: activeLights >= lightNum && phase !== "flash" ? "#dc2626" : "#1a1a1a",
                    boxShadow: activeLights >= lightNum && phase !== "flash"
                      ? "0 0 30px 10px rgba(220, 38, 38, 0.6)"
                      : "none",
                  }}
                  transition={{ duration: 0.1 }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Logo reveal */}
        {phase === "logo" && (
          <div className="flex flex-col items-center gap-6">
            <svg
              width="200"
              height="200"
              viewBox="0 0 400 400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Background */}
              <motion.rect
                width="400"
                height="400"
                rx="80"
                fill="#111111"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              />

              {/* Main P shape - animated stroke */}
              <motion.path
                d="M130 100 H260 C300 100, 320 130, 290 180 L250 240 C230 270, 200 280, 160 280 H110 L130 220 H160 C180 220, 195 210, 205 195 L225 165 C235 150, 230 140, 210 140 H143 L130 100 Z"
                stroke="#FF1801"
                strokeWidth="4"
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1, fill: "#FF1801" }}
                transition={{
                  pathLength: { duration: 0.8, ease: "easeInOut" },
                  fill: { duration: 0.4, delay: 0.6 }
                }}
              />

              {/* Speed lines */}
              <motion.path
                d="M100 280 L80 340 H140 L160 280 H100 Z"
                fill="white"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 1.0 }}
              />
              <motion.path
                d="M170 280 L150 340 H210 L230 280 H170 Z"
                fill="white"
                opacity={0.8}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 0.8, x: 0 }}
                transition={{ duration: 0.3, delay: 1.1 }}
              />
              <motion.path
                d="M240 280 L220 340 H280 L300 280 H240 Z"
                fill="white"
                opacity={0.4}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 0.4, x: 0 }}
                transition={{ duration: 0.3, delay: 1.2 }}
              />
            </svg>

            {/* PRIX SIX text */}
            <motion.h1
              className="text-4xl md:text-5xl font-black italic tracking-[0.2em] text-white"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.3 }}
            >
              PRIX SIX
            </motion.h1>
          </div>
        )}

        {/* Skip button */}
        <motion.button
          className="absolute bottom-6 right-6 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          onClick={handleSkip}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Skip →
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}

export function useSplashScreen() {
  const [showSplash, setShowSplash] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    // Check sessionStorage on mount
    const hasShown = sessionStorage.getItem(SPLASH_SHOWN_KEY);
    setShowSplash(!hasShown);
    setIsChecked(true);
  }, []);

  const handleComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  return { showSplash, isChecked, handleComplete };
}
