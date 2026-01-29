"use client";

import React from "react";
import { motion } from "framer-motion";
import { Flame, Timer, MapPin } from "lucide-react";

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

  // 1. CAR — handled by CSS @keyframes heavyBrake (see <style> block)

  // 2. CONTAINER — staggered cascade (waits for car to park)
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        when: "beforeChildren" as const,
        staggerChildren: 0.08,
        delayChildren: 1.2,
      },
    },
  };

  // 3. ROW — weighted spring (no default easings)
  const rowVariants = {
    hidden: { y: 30, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { type: "spring" as const, stiffness: 70, damping: 15, mass: 1 },
    },
  };

  // 4. HEADER entrance
  const headerVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { delay: 1.5, duration: 0.8, ease: brakingEase },
    },
  };

  // 5. HOT badge pop
  const badgeVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { delay: 1.8, type: "spring" as const, stiffness: 200, damping: 12 },
    },
  };

  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-b from-[#0f172a] via-[#0a1628] to-[#020617] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] border border-white/[0.08] font-sans group select-none">

      {/* ── ambient glow ── */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-purple-600/5 via-transparent to-transparent" />

      {/* scanline texture */}
      <div className="absolute inset-0 opacity-[0.025] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.05)_2px,rgba(255,255,255,0.05)_4px)] pointer-events-none" />

      {/* ── HOT badge ── */}
      <motion.div
        className="absolute top-5 right-5 z-20 flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-500/25 px-3 py-1 backdrop-blur-sm"
        variants={badgeVariants}
        initial="hidden"
        animate="visible"
      >
        <Flame className="w-3 h-3 text-red-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">
          Hot
        </span>
      </motion.div>

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

      {/* ── CSS keyframes for car arrival + tire smoke ── */}
      <style>{`
        @keyframes heavyBrake {
          0%   { opacity: 0; transform: translateX(120%) skewX(-12deg); filter: blur(12px); }
          100% { opacity: 1; transform: translateX(0)    skewX(0);      filter: blur(0);    }
        }
        @keyframes smokePuff {
          0%   { opacity: 0.6; transform: scale(0.5) translateY(0); }
          100% { opacity: 0;   transform: scale(2.5) translateY(-15px); }
        }
      `}</style>

      {/* ── F1 car asset — cinematic arrival ── */}
      <div
        className="absolute top-[-10px] right-[-60px] z-[5] w-[280px] pointer-events-none"
        style={{
          opacity: 0,
          animation: 'heavyBrake 1.2s cubic-bezier(0.22,1,0.36,1) forwards',
        }}
      >
        {/* inline SVG — Red Bull RB side-profile silhouette */}
        <svg
          viewBox="0 0 440 140"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_20px_30px_rgba(0,0,0,0.6)]"
          aria-label="Red Bull F1 Car"
        >
          <defs>
            <linearGradient id="rbBody" x1="0" y1="0" x2="440" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1B3A5C" />
              <stop offset="100%" stopColor="#0D1F3C" />
            </linearGradient>
          </defs>

          {/* ground shadow */}
          <ellipse cx="220" cy="128" rx="190" ry="8" fill="black" opacity="0.25" />

          {/* main body */}
          <path
            d="M18,88 L10,94 L6,100 L14,106 L50,106 C55,92 68,84 82,84
               C96,84 108,92 112,106 L300,106 C305,92 318,84 332,84
               C346,84 358,92 362,106 L378,106 L384,98 L386,86 L380,72
               L360,48 L300,44 L258,48 L240,56 L232,48 Q218,34 206,48
               L200,56 L190,62 L140,68 L90,76 L50,84 Z"
            fill="url(#rbBody)"
          />

          {/* red accent stripe */}
          <path
            d="M100,92 L160,84 L260,82 L340,88 L260,90 L160,90 Z"
            fill="#DC2626" opacity="0.85"
          />

          {/* cockpit opening */}
          <path d="M200,56 L210,48 L226,48 L232,54 L224,60 L206,62 Z" fill="#050D1A" />

          {/* halo */}
          <path
            d="M202,57 Q206,38 218,36 Q230,38 228,54"
            stroke="#3B6B8C" strokeWidth="3.5" fill="none" strokeLinecap="round"
          />

          {/* air intake */}
          <path d="M240,50 L248,40 L260,40 L254,52 Z" fill="#050D1A" />

          {/* engine cover / shark fin */}
          <path
            d="M268,48 L300,36 L358,36 L378,48 L374,62 L340,56 L280,50 Z"
            fill="#132D4A" stroke="#1B3A5C" strokeWidth="0.5"
          />

          {/* rear wing pillar */}
          <rect x="380" y="26" width="5" height="52" rx="2" fill="#1B3A5C" />
          {/* rear wing main plane */}
          <rect x="368" y="20" width="32" height="7" rx="2" fill="#DC2626" />
          {/* rear wing flap */}
          <rect x="372" y="32" width="26" height="4" rx="1" fill="#2B4A6C" />
          {/* rear wing endplate */}
          <rect x="398" y="18" width="4" height="62" rx="2" fill="#1B3A5C" />

          {/* front wing */}
          <path d="M14,100 L4,108 L0,114 L6,118 L36,116 L52,108 L40,100 Z" fill="#1B3A5C" />
          <rect x="0" y="114" width="38" height="3" rx="1" fill="#DC2626" />
          <rect x="0" y="104" width="4" height="16" rx="1" fill="#2B4A6C" />

          {/* rear diffuser */}
          <path d="M368,100 L386,104 L392,112 L382,116 L362,112 Z" fill="#1B3A5C" />

          {/* front wheel */}
          <circle cx="82" cy="106" r="20" fill="#111827" />
          <circle cx="82" cy="106" r="16" fill="#1F2937" />
          <circle cx="82" cy="106" r="5"  fill="#374151" />
          <circle cx="82" cy="106" r="18" fill="none" stroke="#374151" strokeWidth="1" />

          {/* rear wheel */}
          <circle cx="332" cy="106" r="22" fill="#111827" />
          <circle cx="332" cy="106" r="18" fill="#1F2937" />
          <circle cx="332" cy="106" r="6"  fill="#374151" />
          <circle cx="332" cy="106" r="20" fill="none" stroke="#374151" strokeWidth="1" />

          {/* number 1 */}
          <text x="172" y="92" fontSize="14" fontWeight="bold" fill="#DC2626" fontFamily="Arial,sans-serif">1</text>

          {/* nose highlight */}
          <path d="M100,78 L180,70 L200,66 L180,73 L100,80 Z" fill="white" opacity="0.06" />
        </svg>

        {/* tire smoke — puffs at rear wheel on lock-up */}
        <div
          className="absolute bottom-[10px] right-[70px] w-[50px] h-[25px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 70%)',
            opacity: 0,
            transform: 'scale(0.5)',
            animation: 'smokePuff 0.8s ease-out 0.9s forwards',
          }}
        />
        {/* secondary smoke puff — slightly offset */}
        <div
          className="absolute bottom-[14px] right-[85px] w-[35px] h-[18px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(200,200,220,0.3) 0%, rgba(255,255,255,0) 70%)',
            opacity: 0,
            transform: 'scale(0.3)',
            animation: 'smokePuff 0.6s ease-out 1.0s forwards',
          }}
        />
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
