// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       scores/adjustments via @/lib/cumulative-standings (Admin SDK)
// Writes:      nothing (pure image generation)
// Errors:      throws on hard failure; callers degrade gracefully (email ships without image)
// Idempotent:  YES — same data in, same PNG out
// SSOT:        Visual language mirrors the /standings page chart (v3.9.0): dark F1 bump chart,
//              label rail with colour chips, same stable team-colour hash.
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_STANDINGS_CHART_IMAGE-000-v01
// [Intent] Server-side "Your position — last 3 rounds" chart image for the post-race results
//          email (Aaron-approved mockup, 2026-07-26). Two-phase API so a 30+ recipient batch
//          computes league data ONCE: buildChartImageContext(db) loads scores/adjustments and
//          takes cumulative-standings snapshots after each of the last 4 completed GP weekends
//          (entry point + 3 rounds); renderMyPositionChartPng(ctx, userId) draws the target
//          team ±5 window as an SVG bump chart and rasterises to PNG via @resvg/resvg-js.
// [Inbound Trigger] /api/send-results-email builds the context once per batch, renders per user.
// [Downstream Impact] PNG is attached inline (cid) to the results email. Fonts: bundled
//          public/fonts/Roboto-Regular.ttf (OFL) — Cloud Run containers have no system fonts,
//          so loadSystemFonts is off and the bundled file is the only font source.

import * as path from 'path';
import * as fs from 'fs';
import { Resvg } from '@resvg/resvg-js';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  buildRaceRunMillisMap,
  readStandingsAdjustments,
  ADJUSTMENT_RACE_ID,
  type ScoreData,
} from '@/lib/cumulative-standings';
import type { getFirebaseAdmin } from '@/lib/firebase-admin';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

export interface ChartImageContext {
  snapshots: Array<{ label: string; rankByTeam: Map<string, { rank: number; pts: number }> }>;
  /** Final-snapshot entries ordered by rank: [teamUserId, teamName, rank, pts]. */
  finalOrdered: Array<{ userId: string; teamName: string; rank: number; pts: number }>;
  raceTitle: string;
}

// GUID: LIB_STANDINGS_CHART_IMAGE-001-v01
// [Intent] Deterministic team colour — same hash as the standings page (PAGE_STANDINGS-018)
//          so a team's email chart colour matches its website chart colour.
// [Inbound Trigger] Called per team while rendering.
// [Downstream Impact] Pure function.
function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${((hash % 360) + 360) % 360}, 65%, 55%)`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// GUID: LIB_STANDINGS_CHART_IMAGE-002-v01
// [Intent] One-per-batch league data load: per-weekend cumulative standings snapshots (with
//          adjustments) for the entry point + last 3 completed GP weekends.
// [Inbound Trigger] Called once by the results-email route before its recipient loop.
// [Downstream Impact] Returned context feeds every renderMyPositionChartPng call in the batch.
export async function buildChartImageContext(db: AdminFirestore): Promise<ChartImageContext> {
  const [{ scores }, names, adjustments] = await Promise.all([
    computeRaceScores(db),
    buildTeamNamesMap(db),
    readStandingsAdjustments(db),
  ]);
  const runMillis = buildRaceRunMillisMap();

  const gpIds = [...new Set(scores.map((s) => s.raceId))]
    .filter((id) => !id.endsWith('-sprint'))
    .map((id) => ({ id, ms: runMillis.get(id) }))
    .filter((r): r is { id: string; ms: number } => typeof r.ms === 'number')
    .sort((a, b) => a.ms - b.ms);
  if (gpIds.length === 0) throw new Error('No completed GP weekends — cannot build chart context');

  const lastFour = gpIds.slice(-4);
  const firstShownRound = gpIds.length - lastFour.length + 1;
  const nameByUid = names;

  const snapshots = lastFour.map((w, i) => {
    const upto = new Set<string>([ADJUSTMENT_RACE_ID]);
    for (const g of gpIds) {
      upto.add(g.id);
      upto.add(`${g.id}-sprint`);
      if (g.id === w.id) break;
    }
    const rows: ScoreData[] = [...scores, ...adjustments];
    const standings = aggregateStandings(rows, nameByUid, { limitToRaceIds: upto } as any);
    const rankByTeam = new Map<string, { rank: number; pts: number }>();
    standings.forEach((s: any) => rankByTeam.set(s.userId, { rank: s.rank, pts: s.totalPoints }));
    return { label: i === 0 ? `R${firstShownRound + i} (start)` : `R${firstShownRound + i}`, rankByTeam };
  });

  const final = snapshots[snapshots.length - 1];
  const finalOrdered = [...final.rankByTeam.entries()]
    .map(([userId, v]) => ({ userId, teamName: nameByUid.get(userId) ?? userId, rank: v.rank, pts: v.pts }))
    .sort((a, b) => a.rank - b.rank);

  const lastGp = lastFour[lastFour.length - 1].id;
  const raceTitle = lastGp.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return { snapshots, finalOrdered, raceTitle };
}

// GUID: LIB_STANDINGS_CHART_IMAGE-003-v02
// [Intent] Render one team's "My Position — last 3 rounds" PNG: the team ±5 window by final
//          rank, team line highlighted with a white halo, others dimmed, right label rail with
//          colour chips ("P26 LREG · 208"), circuit-dark styling. Returns null if the team has
//          no standing (e.g. no scores yet) so the caller can skip the image gracefully.
// [Inbound Trigger] Called per recipient by the results-email route.
// [Downstream Impact] Buffer is base64'd into a Graph inline attachment.
export function renderMyPositionChartPng(ctx: ChartImageContext, targetUserId: string): Buffer | null {
  const { snapshots, finalOrdered } = ctx;
  const idx = finalOrdered.findIndex((t) => t.userId === targetUserId);
  if (idx === -1) return null;
  const targetName = finalOrdered[idx].teamName;

  const start = Math.max(0, Math.min(idx - 5, finalOrdered.length - 11));
  const windowTeams = finalOrdered.slice(start, start + 11);

  const S = 2;
  const railW = 190 * S, leftW = 46 * S, topPad = 56 * S, botPad = 40 * S;
  const rowH = 26 * S;
  let lo = Infinity, hi = -Infinity;
  windowTeams.forEach((t) =>
    snapshots.forEach((s) => {
      const r = s.rankByTeam.get(t.userId)?.rank;
      if (r) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    })
  );
  if (!isFinite(lo)) return null;
  const rows = hi - lo + 1;
  const plotH = rows * rowH, plotW = 430 * S;
  const W = leftW + plotW + railW + 20 * S, H = topPad + plotH + botPad;
  const yFor = (rank: number) => topPad + (rank - lo + 0.5) * rowH;
  const xFor = (i: number) => leftW + (i * plotW) / (snapshots.length - 1);

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="${W}" height="${H}" fill="#0b0b0f"/>`;
  svg += `<text x="${leftW}" y="${26 * S}" font-family="Roboto" font-size="${15 * S}" font-weight="700" fill="#ffffff">Your position — last 3 rounds</text>`;
  svg += `<text x="${leftW}" y="${43 * S}" font-family="Roboto" font-size="${10 * S}" fill="#9aa0a6">${esc(targetName)} and the teams around you · after the ${esc(ctx.raceTitle)}</text>`;

  for (let r = lo; r <= hi; r++) {
    const y = yFor(r);
    svg += `<line x1="${leftW}" y1="${y}" x2="${leftW + plotW}" y2="${y}" stroke="#1d1d24" stroke-width="${1 * S}"/>`;
    svg += `<text x="${leftW - 8 * S}" y="${y + 3.5 * S}" text-anchor="end" font-family="Roboto" font-size="${9 * S}" fill="#6b7280">P${r}</text>`;
  }
  snapshots.forEach((s, i) => {
    svg += `<text x="${xFor(i)}" y="${topPad + plotH + 18 * S}" text-anchor="middle" font-family="Roboto" font-size="${9 * S}" fill="#9aa0a6">${esc(s.label)}</text>`;
  });

  const drawOrder = [...windowTeams.filter((t) => t.userId !== targetUserId), windowTeams[idx - start]];
  drawOrder.forEach((t) => {
    if (!t) return;
    const pts = snapshots
      .map((s, i) => {
        const r = s.rankByTeam.get(t.userId)?.rank;
        return r ? `${xFor(i)},${yFor(r)}` : null;
      })
      .filter(Boolean)
      .join(' ');
    const me = t.userId === targetUserId;
    if (me) svg += `<polyline points="${pts}" fill="none" stroke="#ffffff" stroke-width="${5 * S}" opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`;
    svg += `<polyline points="${pts}" fill="none" stroke="${teamColor(t.teamName)}" stroke-width="${(me ? 3 : 1.6) * S}" opacity="${me ? 1 : 0.55}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  // Rail labels with two-pass collision dodging — TIED ranks (e.g. two teams on P36 · 183)
  // share the same y and previously overprinted into an unreadable smudge (Aaron's 2026-07-26
  // email screenshot). Same algorithm as the web ChartLabelRail: sort by line y, push apart
  // top-down to a minimum gap, pull back inside the plot bottom-up, leader line when displaced.
  const MIN_GAP = 13 * S;
  const slots = windowTeams
    .map((t) => ({ t, lineY: yFor(t.rank), labelY: yFor(t.rank) }))
    .sort((a, b) => a.lineY - b.lineY || a.t.teamName.localeCompare(b.t.teamName));
  let prevY = -Infinity;
  for (const s of slots) {
    s.labelY = Math.max(s.labelY, prevY + MIN_GAP, topPad + 4 * S);
    prevY = s.labelY;
  }
  let nextY = Infinity;
  for (let i = slots.length - 1; i >= 0; i--) {
    slots[i].labelY = Math.min(slots[i].labelY, nextY - MIN_GAP, topPad + plotH - 2 * S);
    nextY = slots[i].labelY;
  }
  const xEnd = leftW + plotW;
  slots.forEach(({ t, lineY, labelY }) => {
    const me = t.userId === targetUserId;
    const nm = t.teamName.length > 20 ? `${t.teamName.slice(0, 19)}…` : t.teamName;
    const color = teamColor(t.teamName);
    if (Math.abs(labelY - lineY) > 2 * S) {
      svg += `<path d="M${xEnd + 1 * S},${lineY} L${xEnd + 10 * S},${labelY}" stroke="${color}" stroke-width="${1 * S}" opacity="0.55" fill="none"/>`;
    }
    svg += `<rect x="${xEnd + 12 * S}" y="${labelY - 4 * S}" width="${8 * S}" height="${8 * S}" rx="${2 * S}" fill="${color}"/>`;
    svg += `<text x="${xEnd + 26 * S}" y="${labelY + 3.5 * S}" font-family="Roboto" font-size="${10 * S}" font-weight="${me ? 700 : 400}" fill="${me ? '#ffffff' : '#c9cdd3'}">P${t.rank} ${esc(nm)} · ${t.pts}</text>`;
  });

  svg += `<text x="${leftW}" y="${H - 12 * S}" font-family="Roboto" font-size="${9 * S}" fill="#6b7280">prix6.win/standings — tap for the full interactive chart</text>`;
  svg += `</svg>`;

  // Cloud Run containers ship no system fonts — the bundled Roboto is the only source.
  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'Roboto-Regular.ttf');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width' as const, value: W },
    font: fs.existsSync(fontPath)
      ? { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: 'Roboto' }
      : { loadSystemFonts: true },
  });
  return Buffer.from(resvg.render().asPng());
}
