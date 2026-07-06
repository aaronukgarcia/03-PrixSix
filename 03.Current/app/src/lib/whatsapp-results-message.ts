// GUID: LIB_WHATSAPP_RESULTS_MESSAGE-000-v01
// [Intent] Pure builder for the concise WhatsApp "results are in" message. Deliberately NOT the same
//          as the results email — WhatsApp gets a short, glanceable summary: the race podium, the
//          round-winning team (with a congrats), and a Championship top-N. No HTML, no per-team table.
// [Inbound Trigger] Called by /api/calculate-scores (resultsPublished alert) and by the one-off
//          British GP backfill-post script. Kept dependency-free (no imports) so scripts can import it
//          via a relative path without the @/ alias resolver.
// [Downstream Impact] Output string is passed to sendWhatsAppAlert / enqueued to whatsapp_queue. The
//          worker appends its own "Bill#<n>" trace suffix — do not add one here.

export interface ResultsWhatsAppInput {
  /** e.g. "British Grand Prix - GP" */
  raceName: string;
  /** Official finishing driver NAMES, top of the order first (podium = first 3). */
  podium: string[];
  /** Team name(s) sharing the highest points for THIS race (ties allowed). */
  roundWinners: string[];
  /** Points the round winner(s) scored this race. */
  roundWinnerPoints: number;
  /** Cumulative championship standings (rank asc). Only the top N are rendered. */
  standings: { rank: number; teamName: string; totalPoints: number }[];
  /** How many championship rows to show. Default 5. */
  standingsTopN?: number;
}

/** Join a list as "A", "A & B", or "A, B & C". */
function humanJoin(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function buildResultsWhatsAppMessage(input: ResultsWhatsAppInput): string {
  const { raceName, podium, roundWinners, roundWinnerPoints, standings } = input;
  const topN = input.standingsTopN ?? 5;

  const lines: string[] = [];
  lines.push(`📊 *${raceName} — Results are in!*`);

  const medals = ['🥇', '🥈', '🥉'];
  const podiumTop3 = podium.filter(Boolean).slice(0, 3);
  if (podiumTop3.length) {
    lines.push('');
    lines.push(`🏁 Podium: ${podiumTop3.map((d, i) => `${medals[i]} ${d}`).join('   ')}`);
  }

  if (roundWinners.length) {
    const who = humanJoin(roundWinners);
    const plural = roundWinners.length > 1 ? 'winners' : 'winner';
    lines.push('');
    lines.push(`🏆 Round ${plural}: *${who}* (${roundWinnerPoints} pts) — congrats! 🎉`);
  }

  const top = standings.slice(0, topN);
  if (top.length) {
    lines.push('');
    lines.push(`📋 *Championship — Top ${top.length}*`);
    top.forEach((s) => lines.push(`${s.rank}. ${s.teamName} — ${s.totalPoints}`));
  }

  lines.push('');
  lines.push('👉 Full results & standings: prix6.win/standings');

  return lines.join('\n');
}
