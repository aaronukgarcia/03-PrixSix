"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Timer, MapPin } from "lucide-react";
import type { PubChatTimingData } from "@/firebase/firestore/settings";

// ─── FALLBACK DATA ──────────────────────────────────────────────────────────
const FALLBACK_DRIVER_DATA = [
  { position: 1, driver: "Hadjar",    team: "Red Bull",     teamColour: "3671C6", laps: 108, time: "1:18.159", bestLapDuration: 78.159, fullName: "Isack HADJAR",         driverNumber: 6,  tyreCompound: "MEDIUM" },
  { position: 2, driver: "Russell",   team: "Mercedes",     teamColour: "27F4D2", laps:  95, time: "1:18.696", bestLapDuration: 78.696, fullName: "George RUSSELL",       driverNumber: 63, tyreCompound: "SOFT"   },
  { position: 3, driver: "Colapinto", team: "Alpine",       teamColour: "FF87BC", laps:  60, time: "1:20.189", bestLapDuration: 80.189, fullName: "Franco COLAPINTO",     driverNumber: 43, tyreCompound: "SOFT"   },
  { position: 4, driver: "Antonelli", team: "Mercedes",     teamColour: "27F4D2", laps:  59, time: "1:20.700", bestLapDuration: 80.700, fullName: "Andrea Kimi ANTONELLI", driverNumber: 12, tyreCompound: "MEDIUM" },
  { position: 5, driver: "Ocon",      team: "Haas",         teamColour: "B6BABD", laps: 154, time: "1:21.301", bestLapDuration: 81.301, fullName: "Esteban OCON",         driverNumber: 31, tyreCompound: "HARD"   },
  { position: 6, driver: "Lawson",    team: "Racing Bulls", teamColour: "6692FF", laps:  88, time: "1:21.513", bestLapDuration: 81.513, fullName: "Liam LAWSON",          driverNumber: 30, tyreCompound: "MEDIUM" },
  { position: 7, driver: "Bottas",    team: "Cadillac",     teamColour: "1E5D3A", laps:  34, time: "1:24.651", bestLapDuration: 84.651, fullName: "Valtteri BOTTAS",      driverNumber: 77, tyreCompound: "HARD"   },
  { position: 8, driver: "Bortoleto", team: "Audi",         teamColour: "52E252", laps:  28, time: "1:25.296", bestLapDuration: 85.296, fullName: "Gabriel BORTOLETO",    driverNumber: 5,  tyreCompound: "SOFT"   },
  { position: 9, driver: "Perez",     team: "Cadillac",     teamColour: "1E5D3A", laps:  11, time: "1:25.974", bestLapDuration: 85.974, fullName: "Sergio PEREZ",         driverNumber: 11, tyreCompound: "MEDIUM" },
];

const FALLBACK_SESSION = {
  meetingName: "Pre-season Testing",
  sessionName: "Day 1",
  circuitName: "Barcelona",
  location: "Barcelona",
};

/** Parse "M:SS.mmm" → milliseconds */
function parseTimeToMs(t: string): number {
  const [m, rest] = t.split(":");
  const [s, ms] = rest.split(".");
  return +m * 60_000 + +s * 1_000 + +ms;
}

// FEAT-PC-001 Section 1: Map tyre compound to F1-standard colours and abbreviation
const TYRE_STYLE: Record<string, { bg: string; label: string }> = {
  SOFT:         { bg: '#e8002d', label: 'S' },
  MEDIUM:       { bg: '#ffd700', label: 'M' },
  HARD:         { bg: '#e0e0e0', label: 'H' },
  INTERMEDIATE: { bg: '#39b54a', label: 'I' },
  WET:          { bg: '#0067ff', label: 'W' },
};

function TyreIndicator({ compound }: { compound?: string }) {
  if (!compound) return null;
  const style = TYRE_STYLE[compound.toUpperCase()];
  if (!style) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black leading-none"
      style={{ backgroundColor: style.bg, color: compound === 'HARD' ? '#111' : '#fff' }}
      title={compound.charAt(0) + compound.slice(1).toLowerCase()}
    >
      {style.label}
    </span>
  );
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
// FEAT-PC-001: view modes — 'leaderboard' (Section 1), 'team-lens' (Section 2), 'comparison' (Section 3)
export type PubChatViewMode = 'leaderboard' | 'team-lens' | 'comparison';

interface ThePaddockPubChatProps {
  timingData?: PubChatTimingData | null;
  viewMode?: PubChatViewMode;         // Section 2/3: which view to render (default: leaderboard)
  selectedTeam?: string;              // Section 2: display name (e.g. "Williams")
  teamDriverNumbers?: number[];       // Section 2: driver numbers from official_teams — precise join key to OpenF1
}

const ThePaddockPubChat = ({ timingData, viewMode = 'leaderboard', selectedTeam, teamDriverNumbers }: ThePaddockPubChatProps) => {
  // Section 3: internal multi-select state for driver comparison
  const [compareSelected, setCompareSelected] = useState<Set<number>>(new Set());

  const drivers = timingData?.drivers?.length ? timingData.drivers : FALLBACK_DRIVER_DATA;
  const session = timingData?.session || FALLBACK_SESSION;

  const leaderMs = parseTimeToMs(drivers[0].time);

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

  // FEAT-PC-001 Section 2: Team Lens — filter by official driver numbers (precise join key) when
  // provided from official_teams Firestore collection, else fall back to team name string match.
  const lensTeam = selectedTeam || 'Williams';
  const lensDrivers = (teamDriverNumbers && teamDriverNumbers.length > 0)
    ? drivers.filter(d => teamDriverNumbers.includes(d.driverNumber))
    : drivers.filter(d => d.team.toLowerCase().includes(lensTeam.toLowerCase()));
  const leaderMs_ref = drivers.length > 0 ? parseTimeToMs(drivers[0].time) : 0;

  // FEAT-PC-001 Section 3: Comparison — driven by internal checkbox state
  const compareDrivers = compareSelected.size > 0
    ? drivers.filter(d => compareSelected.has(d.driverNumber))
    : [];

  // Build header text from session metadata
  const headerLabel = session.meetingName || "Pre-season Testing";
  const headerTitle = session.sessionName
    ? `${session.sessionName} \u2014 ${session.circuitName || session.location || ""}`
    : "Day 1 \u2014 Barcelona";
  const circuitSubtext = session.circuitName
    ? `Circuit de ${session.circuitName}`
    : "Circuit de Barcelona-Catalunya";

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
              {headerLabel}
            </p>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            {headerTitle}
          </h2>
          <div className="flex items-center gap-1.5 mt-1.5">
            <MapPin className="w-3 h-3 text-slate-500" />
            <p className="text-[10px] text-slate-500 tracking-wide">
              {circuitSubtext}
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── glowing divider ── */}
      <div className="relative mx-5">
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent blur-sm" />
      </div>

      {/* ── timing data — view-mode aware ── */}
      <motion.div
        className="relative z-10 px-5 pt-4 pb-5"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >

        {/* ── VIEW: LEADERBOARD (Section 1) ── */}
        {viewMode === 'leaderboard' && (<>
          {/* column headers */}
          <div className="flex justify-between text-[9px] uppercase tracking-[0.15em] text-slate-500/80 mb-2.5 px-2 font-semibold">
            <div className="flex items-center gap-3.5">
              <span className="w-5 text-center">P</span>
              <span>Driver</span>
            </div>
            <div className="flex gap-5 items-center">
              <span className="w-4 text-center">T</span>
              <span className="w-8 text-center">Laps</span>
              <span className="w-[4.5rem] text-right">Time</span>
              <span className="w-14 text-right">Gap</span>
            </div>
          </div>
          {/* rows */}
          <div className="space-y-0.5">
            {drivers.map((row, i) => {
              const gap = i === 0 ? "" : `+${((parseTimeToMs(row.time) - leaderMs) / 1000).toFixed(3)}`;
              return (
                <motion.div
                  key={row.driverNumber ?? row.driver}
                  variants={rowVariants}
                  className={`flex items-center justify-between py-2 px-2 rounded-lg transition-colors duration-200 hover:bg-white/[0.04] ${
                    i === 0 ? "bg-gradient-to-r from-purple-500/[0.08] to-transparent border border-purple-500/10" : "border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-5 text-center text-xs font-bold tabular-nums ${i === 0 ? "text-purple-400" : i < 3 ? "text-slate-300" : "text-slate-500"}`}>
                      {i + 1}
                    </span>
                    <div className="flex flex-col leading-tight">
                      <span className={`font-bold text-sm ${i === 0 ? "text-white" : "text-slate-200"}`}>{row.driver}</span>
                      <span className="text-[10px] uppercase tracking-wide" style={{ color: `#${row.teamColour}` }}>{row.team}</span>
                    </div>
                  </div>
                  <div className="flex gap-5 items-center font-mono">
                    <span className="w-4 flex justify-center"><TyreIndicator compound={row.tyreCompound} /></span>
                    <span className="w-8 text-center text-[11px] text-slate-500 tabular-nums">{row.laps}</span>
                    <span className={`w-[4.5rem] text-right text-[13px] font-bold tabular-nums tracking-tight ${i === 0 ? "text-purple-400" : "text-slate-100"}`}>{row.time}</span>
                    <span className={`w-14 text-right text-[11px] tabular-nums ${i === 0 ? "text-purple-400/60" : "text-slate-500"}`}>{gap || "\u2014"}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>)}

        {/* ── VIEW: TEAM LENS (Section 2) ── */}
        {viewMode === 'team-lens' && (<>
          {/* Team name header */}
          <div className="text-center mb-4">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500/80 font-semibold mb-1">Team Lens</p>
            <div className="flex items-center justify-center gap-2">
              {lensDrivers[0] && (
                <div className="h-0.5 w-8 rounded" style={{ backgroundColor: `#${lensDrivers[0].teamColour}` }} />
              )}
              <span className="text-base font-bold text-white">{lensTeam}</span>
              {lensDrivers[0] && (
                <div className="h-0.5 w-8 rounded" style={{ backgroundColor: `#${lensDrivers[0].teamColour}` }} />
              )}
            </div>
          </div>
          {/* Driver cards — or empty state if team has no drivers in this session */}
          {lensDrivers.length === 0 ? (
            <p className="text-center text-[11px] text-slate-500 py-6">
              No {lensTeam} drivers in this session
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {lensDrivers.slice(0, 2).map((row) => {
                const gapMs = leaderMs_ref > 0 ? parseTimeToMs(row.time) - leaderMs_ref : 0;
                const gapStr = gapMs <= 0 ? "Leader" : `+${(gapMs / 1000).toFixed(3)}`;
                return (
                  <motion.div
                    key={row.driverNumber}
                    variants={rowVariants}
                    className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-3 flex flex-col items-center gap-2"
                  >
                    <TyreIndicator compound={row.tyreCompound} />
                    <div className="text-center leading-tight">
                      <p className="font-bold text-sm text-white">{row.driver}</p>
                      <p className="text-[9px] uppercase tracking-wide" style={{ color: `#${row.teamColour}` }}>#{row.driverNumber}</p>
                    </div>
                    <div className="w-full space-y-1 mt-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-500">Best lap</span>
                        <span className="font-mono font-bold text-slate-100">{row.time}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-500">Gap</span>
                        <span className={`font-mono ${gapStr === 'Leader' ? 'text-purple-400' : 'text-slate-400'}`}>{gapStr}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-500">Pos</span>
                        <span className="font-mono font-bold text-slate-200">P{row.position}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-500">Laps</span>
                        <span className="font-mono text-slate-400">{row.laps}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          {lensDrivers.length === 1 && (
            <p className="text-center text-[10px] text-slate-600 mt-3">Only one driver with lap data this session</p>
          )}
        </>)}

        {/* ── VIEW: DRIVER COMPARISON (Section 3) ── */}
        {viewMode === 'comparison' && (<>
          {/* Multi-select driver picker */}
          <div className="mb-3">
            <p className="text-[9px] uppercase tracking-[0.15em] text-slate-500/80 mb-1.5 font-semibold px-1">
              Select drivers to compare
            </p>
            <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
              {drivers.map(d => {
                const checked = compareSelected.has(d.driverNumber);
                return (
                  <button
                    key={d.driverNumber}
                    type="button"
                    onClick={() => {
                      const next = new Set(compareSelected);
                      if (checked) next.delete(d.driverNumber);
                      else next.add(d.driverNumber);
                      setCompareSelected(next);
                    }}
                    className={`flex items-center gap-1.5 py-1 px-2 rounded-lg text-left transition-colors ${
                      checked
                        ? 'bg-purple-500/20 border border-purple-500/30'
                        : 'hover:bg-white/[0.04] border border-transparent'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center ${
                      checked ? 'border-purple-400 bg-purple-500/40' : 'border-slate-600'
                    }`}>
                      {checked && <span className="text-purple-200 text-[7px] font-black leading-none">✓</span>}
                    </span>
                    <span className="text-[11px] text-slate-200 font-semibold truncate">{d.driver}</span>
                    <span className="text-[9px] ml-auto flex-shrink-0" style={{ color: `#${d.teamColour}` }}>
                      {d.team.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-3" />
          {/* Comparison table */}
          {compareDrivers.length === 0 ? (
            <p className="text-center text-[11px] text-slate-600 py-3">Select drivers above to compare</p>
          ) : (
            <div className="space-y-1">
              <div className="grid text-[9px] uppercase tracking-[0.1em] text-slate-600 font-semibold mb-1 px-1" style={{ gridTemplateColumns: '1fr 1fr 2.5rem 3.5rem 3rem' }}>
                <span>Driver</span>
                <span>Team</span>
                <span className="text-center">T</span>
                <span className="text-right">Time</span>
                <span className="text-right">Gap</span>
              </div>
              {compareDrivers.map((row) => {
                const gapMs = leaderMs_ref > 0 ? parseTimeToMs(row.time) - leaderMs_ref : 0;
                const gapStr = gapMs <= 0 ? "—" : `+${(gapMs / 1000).toFixed(3)}`;
                return (
                  <motion.div
                    key={row.driverNumber}
                    variants={rowVariants}
                    className="grid items-center py-1.5 px-1 rounded-lg hover:bg-white/[0.03] border border-transparent"
                    style={{ gridTemplateColumns: '1fr 1fr 2.5rem 3.5rem 3rem' }}
                  >
                    <div>
                      <p className="text-[12px] font-bold text-slate-100">{row.driver}</p>
                      <p className="text-[9px] text-slate-600">#{row.driverNumber}</p>
                    </div>
                    <p className="text-[10px] uppercase tracking-wide truncate" style={{ color: `#${row.teamColour}` }}>{row.team}</p>
                    <span className="flex justify-center"><TyreIndicator compound={row.tyreCompound} /></span>
                    <p className="text-right font-mono text-[12px] font-bold text-slate-100">{row.time}</p>
                    <p className={`text-right font-mono text-[10px] ${gapMs <= 0 ? 'text-purple-400' : 'text-slate-500'}`}>{gapStr}</p>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>)}

      </motion.div>

      {/* ── gradient footer strip ── */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-600 via-purple-500 to-red-500 opacity-80" />
      <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-r from-blue-600/10 via-purple-500/10 to-red-500/10 blur-xl" />
    </div>
  );
};

export default ThePaddockPubChat;
