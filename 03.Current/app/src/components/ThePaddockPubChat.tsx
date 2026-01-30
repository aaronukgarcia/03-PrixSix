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
        className="absolute top-[-8px] right-[-50px] z-[5] w-[270px] pointer-events-none"
        style={{
          opacity: 0,
          animation: 'heavyBrake 1.2s cubic-bezier(0.22,1,0.36,1) forwards',
        }}
      >
        {/* inline SVG — technical F1 2026-spec side profile */}
        <svg
          viewBox="0 0 520 155"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_20px_30px_rgba(0,0,0,0.6)]"
          aria-label="F1 Car"
        >
          <defs>
            <linearGradient id="carBody" x1="0" y1="60" x2="520" y2="60" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1e3a5f" />
              <stop offset="50%" stopColor="#162d4a" />
              <stop offset="100%" stopColor="#0e1f35" />
            </linearGradient>
            <linearGradient id="floorGrad" x1="60" y1="115" x2="430" y2="115" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0a1420" />
              <stop offset="100%" stopColor="#162030" />
            </linearGradient>
            <radialGradient id="wheelShine" cx="0.35" cy="0.35" r="0.65">
              <stop offset="0%" stopColor="#3a3a3a" />
              <stop offset="100%" stopColor="#0a0a0a" />
            </radialGradient>
          </defs>

          {/* ground shadow */}
          <ellipse cx="260" cy="142" rx="210" ry="10" fill="black" opacity="0.3" />

          {/* floor / plank */}
          <path
            d="M55,112 L65,118 L420,118 L440,112 L420,108 L65,108 Z"
            fill="url(#floorGrad)" opacity="0.9"
          />
          {/* floor edge detail */}
          <path d="M70,118 L415,118" stroke="#2a4060" strokeWidth="0.5" />

          {/* main monocoque + sidepods */}
          <path
            d="M22,96 L15,102 L12,108 L55,112 L65,108
               C72,94 86,86 102,86 C118,86 130,94 136,108
               L370,108 C377,94 391,86 407,86 C423,86 435,94 440,108
               L458,108 L462,100 L464,88 L458,74
               L440,52 L400,42 L370,38 L340,42
               L310,52 L296,60 L290,52 L278,40
               Q265,30 252,40 L246,50 L238,58
               L200,66 L140,74 L80,84 L40,92 Z"
            fill="url(#carBody)"
          />

          {/* sidepod undercut */}
          <path
            d="M160,96 Q200,108 280,106 Q340,104 380,96"
            stroke="#0a1420" strokeWidth="1.5" fill="none" opacity="0.6"
          />

          {/* sidepod inlet */}
          <path d="M238,58 L245,52 L265,50 L280,54 L268,62 L242,64 Z" fill="#080e18" />

          {/* cockpit opening */}
          <path d="M246,50 L256,42 L276,40 L286,48 L278,56 L252,58 Z" fill="#040810" />

          {/* halo — titanium arc */}
          <path
            d="M248,52 Q252,32 268,28 Q284,32 282,50"
            stroke="#4a7a9c" strokeWidth="3" fill="none" strokeLinecap="round"
          />
          {/* halo inner shadow */}
          <path
            d="M250,50 Q254,34 268,30 Q282,34 280,48"
            stroke="#2a5070" strokeWidth="1" fill="none" strokeLinecap="round"
          />

          {/* air intake above driver */}
          <path d="M294,46 L304,34 L318,34 L310,48 Z" fill="#040810" />

          {/* engine cover / shark fin */}
          <path
            d="M320,42 L360,28 L435,28 L456,42 L452,58 L420,50 L340,44 Z"
            fill="#132d4a" stroke="#1e3a5f" strokeWidth="0.5"
          />

          {/* rear wing assembly */}
          {/* main pillar */}
          <rect x="456" y="22" width="4" height="58" rx="1.5" fill="#1a3050" />
          {/* main plane */}
          <path d="M442,16 L480,16 L478,22 L444,22 Z" fill="#dc2626" />
          {/* upper flap */}
          <path d="M446,10 L478,10 L480,15 L444,15 Z" fill="#1a3050" />
          {/* lower flap */}
          <path d="M448,28 L476,28 L474,32 L450,32 Z" fill="#1e3a5f" />
          {/* endplate */}
          <path d="M478,8 L484,8 L484,78 L480,80 L478,78 Z" fill="#162d4a" stroke="#1e3a5f" strokeWidth="0.3" />
          {/* DRS actuator detail */}
          <rect x="460" y="23" width="12" height="1.5" rx="0.5" fill="#3a5a7a" opacity="0.5" />

          {/* front wing */}
          <path d="M18,102 L6,108 L2,114 L8,120 L42,118 L56,110 L44,102 Z" fill="#1a3050" />
          {/* front wing main plane */}
          <rect x="2" y="116" width="44" height="2.5" rx="1" fill="#dc2626" />
          {/* front wing flap */}
          <rect x="4" y="112" width="40" height="2" rx="0.5" fill="#1e3a5f" />
          {/* front wing endplate */}
          <path d="M2,106 L6,106 L6,122 L2,122 Z" fill="#1e3a5f" />
          {/* nose tip */}
          <path d="M22,96 L15,102 L22,104 L30,98 Z" fill="#162d4a" />

          {/* rear diffuser */}
          <path d="M440,108 L462,104 L470,112 L465,118 L440,116 Z" fill="#0e1a28" />
          {/* diffuser strakes */}
          <line x1="448" y1="108" x2="450" y2="116" stroke="#1e3a5f" strokeWidth="0.5" />
          <line x1="454" y1="106" x2="456" y2="116" stroke="#1e3a5f" strokeWidth="0.5" />
          <line x1="460" y1="106" x2="462" y2="116" stroke="#1e3a5f" strokeWidth="0.5" />

          {/* front wheel */}
          <circle cx="102" cy="112" r="22" fill="url(#wheelShine)" />
          <circle cx="102" cy="112" r="18" fill="#1a1a1a" />
          <circle cx="102" cy="112" r="14" fill="#222" />
          {/* wheel spokes */}
          <g stroke="#333" strokeWidth="1.5">
            <line x1="102" y1="98" x2="102" y2="126" />
            <line x1="88" y1="112" x2="116" y2="112" />
            <line x1="92" y1="102" x2="112" y2="122" />
            <line x1="112" y1="102" x2="92" y2="122" />
          </g>
          {/* wheel nut */}
          <circle cx="102" cy="112" r="4" fill="#2a2a2a" stroke="#444" strokeWidth="0.5" />
          {/* tire sidewall */}
          <circle cx="102" cy="112" r="20" fill="none" stroke="#111" strokeWidth="3" />

          {/* rear wheel */}
          <circle cx="407" cy="112" r="24" fill="url(#wheelShine)" />
          <circle cx="407" cy="112" r="20" fill="#1a1a1a" />
          <circle cx="407" cy="112" r="15" fill="#222" />
          {/* wheel spokes */}
          <g stroke="#333" strokeWidth="1.5">
            <line x1="407" y1="92" x2="407" y2="132" />
            <line x1="387" y1="112" x2="427" y2="112" />
            <line x1="393" y1="98" x2="421" y2="126" />
            <line x1="421" y1="98" x2="393" y2="126" />
          </g>
          {/* wheel nut */}
          <circle cx="407" cy="112" r="4.5" fill="#2a2a2a" stroke="#444" strokeWidth="0.5" />
          {/* tire sidewall */}
          <circle cx="407" cy="112" r="22" fill="none" stroke="#111" strokeWidth="3" />

          {/* bargeboard / sidepod vanes */}
          <line x1="148" y1="86" x2="155" y2="106" stroke="#2a4060" strokeWidth="0.8" />
          <line x1="155" y1="84" x2="162" y2="104" stroke="#2a4060" strokeWidth="0.6" />

          {/* nose body highlight */}
          <path d="M80,84 L180,74 L240,66 L180,76 L80,86 Z" fill="white" opacity="0.04" />
          {/* engine cover highlight */}
          <path d="M330,42 L400,32 L450,34 L400,36 L330,44 Z" fill="white" opacity="0.03" />
        </svg>

        {/* tire smoke — puffs at rear wheel on lock-up */}
        <div
          className="absolute bottom-[8px] right-[55px] w-[50px] h-[25px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 70%)',
            opacity: 0,
            transform: 'scale(0.5)',
            animation: 'smokePuff 0.8s ease-out 0.9s forwards',
          }}
        />
        <div
          className="absolute bottom-[12px] right-[70px] w-[35px] h-[18px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(200,200,220,0.25) 0%, rgba(255,255,255,0) 70%)',
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
