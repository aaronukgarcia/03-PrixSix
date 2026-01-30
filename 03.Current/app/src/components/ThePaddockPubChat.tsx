"use client";

import React from "react";
import { motion } from "framer-motion";
import { Timer, MapPin } from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────
const DRIVER_DATA = [
  { driver: "Hadjar",    team: "Red Bull",     laps: 108, time: "1:18.159" },
  { driver: "Russell",   team: "Mercedes",     laps:  95, time: "1:18.696" },
  { driver: "Colapinto", team: "Alpine",       laps:  60, time: "1:20.189" },
  { driver: "Antonelli", team: "Mercedes",     laps:  59, time: "1:20.700" },
  { driver: "Ocon",      team: "Haas",         laps: 154, time: "1:21.301" },
  { driver: "Lawson",    team: "Racing Bulls", laps:  88, time: "1:21.513" },
  { driver: "Bottas",    team: "Cadillac",     laps:  34, time: "1:24.651" },
  { driver: "Bortoleto", team: "Audi",         laps:  28, time: "1:25.296" },
  { driver: "Perez",     team: "Cadillac",     laps:  11, time: "1:25.974" },
];

const TEAM_ACCENT: Record<string, string> = {
  "Red Bull":     "text-blue-400",
  "Mercedes":     "text-teal-400",
  "Alpine":       "text-pink-400",
  "Haas":         "text-neutral-400",
  "Racing Bulls": "text-sky-400",
  "Cadillac":     "text-emerald-400",
  "Audi":         "text-green-400",
};

/** Parse "M:SS.mmm" → milliseconds */
function parseTimeToMs(t: string): number {
  const [m, rest] = t.split(":");
  const [s, ms] = rest.split(".");
  return +m * 60_000 + +s * 1_000 + +ms;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
const ThePaddockPubChat = () => {
  const leaderMs = parseTimeToMs(DRIVER_DATA[0].time);

  // Shared braking curve
  const brakingEase = [0.22, 1, 0.36, 1] as const;

  // CONTAINER — staggered cascade
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        when: "beforeChildren" as const,
        staggerChildren: 0.08,
        delayChildren: 0.3,
      },
    },
  };

  // ROW — weighted spring
  const rowVariants = {
    hidden: { y: 30, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { type: "spring" as const, stiffness: 70, damping: 15, mass: 1 },
    },
  };

  // HEADER entrance
  const headerVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { delay: 0.2, duration: 0.8, ease: brakingEase },
    },
  };

  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-b from-[#0f172a] via-[#0a1628] to-[#020617] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] border border-white/[0.08] font-sans group select-none">

      {/* ── ambient glow ── */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-purple-600/5 via-transparent to-transparent" />

      {/* scanline texture */}
      <div className="absolute inset-0 opacity-[0.025] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.05)_2px,rgba(255,255,255,0.05)_4px)] pointer-events-none" />

      {/* ── header ── */}
      <div className="relative z-10 p-6 pb-3">
        <motion.div variants={headerVariants} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-1">
            <Timer className="w-3.5 h-3.5 text-blue-400/70" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-blue-400/80 font-semibold">
              Pre-season Testing
            </p>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Day 1 &mdash; Barcelona
          </h2>
          <div className="flex items-center gap-1.5 mt-1.5">
            <MapPin className="w-3 h-3 text-slate-500" />
            <p className="text-[10px] text-slate-500 tracking-wide">
              Circuit de Barcelona-Catalunya
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── glowing divider ── */}
      <div className="relative mx-5">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent blur-sm" />
      </div>

      {/* ── timing data ── */}
      <motion.div
        className="relative z-10 px-5 pt-4 pb-5"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* column headers */}
        <div className="flex justify-between text-[9px] uppercase tracking-[0.15em] text-slate-500/80 mb-2.5 px-2 font-semibold">
          <div className="flex items-center gap-3.5">
            <span className="w-5 text-center">P</span>
            <span>Driver</span>
          </div>
          <div className="flex gap-5">
            <span className="w-8 text-center">Laps</span>
            <span className="w-[4.5rem] text-right">Time</span>
            <span className="w-14 text-right">Gap</span>
          </div>
        </div>

        {/* rows */}
        <div className="space-y-0.5">
          {DRIVER_DATA.map((row, i) => {
            const gap =
              i === 0
                ? ""
                : `+${((parseTimeToMs(row.time) - leaderMs) / 1000).toFixed(3)}`;
            const accent = TEAM_ACCENT[row.team] ?? "text-slate-400";

            return (
              <motion.div
                key={row.driver}
                variants={rowVariants}
                className={`flex items-center justify-between py-2 px-2 rounded-lg transition-colors duration-200 hover:bg-white/[0.04] ${
                  i === 0
                    ? "bg-gradient-to-r from-purple-500/[0.08] to-transparent border border-purple-500/10"
                    : "border border-transparent"
                }`}
              >
                {/* position + name */}
                <div className="flex items-center gap-3">
                  <span
                    className={`w-5 text-center text-xs font-bold tabular-nums ${
                      i === 0
                        ? "text-purple-400"
                        : i < 3
                          ? "text-slate-300"
                          : "text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="flex flex-col leading-tight">
                    <span
                      className={`font-bold text-sm ${
                        i === 0 ? "text-white" : "text-slate-200"
                      }`}
                    >
                      {row.driver}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wide ${accent}`}
                    >
                      {row.team}
                    </span>
                  </div>
                </div>

                {/* laps + time + gap */}
                <div className="flex gap-5 items-baseline font-mono">
                  <span className="w-8 text-center text-[11px] text-slate-500 tabular-nums">
                    {row.laps}
                  </span>
                  <span
                    className={`w-[4.5rem] text-right text-[13px] font-bold tabular-nums tracking-tight ${
                      i === 0 ? "text-purple-400" : "text-slate-100"
                    }`}
                  >
                    {row.time}
                  </span>
                  <span
                    className={`w-14 text-right text-[11px] tabular-nums ${
                      i === 0 ? "text-purple-400/60" : "text-slate-500"
                    }`}
                  >
                    {gap || "\u2014"}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ── gradient footer strip ── */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-600 via-purple-500 to-red-500 opacity-80" />
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-r from-blue-600/10 via-purple-500/10 to-red-500/10 blur-xl" />
    </div>
  );
};

export default ThePaddockPubChat;
