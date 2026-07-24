'use server';

// GUID: AI_CHEEKY_BILL-000-v06
// @CHANGE (v3.8.0): anti-sameness overhaul — (1) new optional recentRoasts input: Bill's last
//   ~10 posted roast lines (LIB_CHEEKY_BILL_HISTORY) are injected as a "stale material — do not
//   reuse" block; (2) style examples become POOLS sampled per call (3-4 shown, Fisher-Yates)
//   instead of a static list the model was converging on; (3) comedy-device roulette — ~70% of
//   calls are assigned one random delivery device (understatement, absurd comparison, mock
//   commentary, steward's verdict…); (4) rhythm variation — 1-in-3 roasts may use a two-part
//   setup + deadpan tag instead of the hard one-sentence rule; (5) temperature 1.0 on both
//   generate calls. All safety guardrails (protected traits, no profanity, facts-only) unchanged.
// @CHANGE (v3.7.0): fourth mode 'splitbrain' — Bill roasting HIS OWN AI team Billceleration's
//   submission: the team-principal half just locked the picks in, the Jack Dee half gets the
//   microphone. New optional rationaleFacts input carries the picker's own rationale/selfDoubt
//   so the roast can quote the delusion verbatim. All absolute guardrails unchanged.
// @CHANGE (v3.6.0): three roast modes — 'standard' (unchanged), 'jackdee' (harsher deadpan
//   personal dig at the SUBMITTER, Aaron-approved "fully personal"; protected-traits +
//   no-profanity guardrails stay absolute) and 'news' (weaves ONE fresh trackside/news fact
//   from the new newsFacts input and mocks the correlation with the submission). One prompt
//   skeleton, per-mode persona/rules/example blocks — mode selection happens at the call site.
// @CHANGE (v3.4.14): situational awareness — two new optional fact inputs: previousSubmissionFacts
//   (identical / same-six-shuffled / wholesale-changes vs their last submission → "minimal effort"
//   roasts) and formFacts (picks' REAL WDC positions + outsider/table-copy flags → "brave outside
//   chance" roasts). Prompt gains situational instructions + two player-supplied style examples.
// @CHANGE (v3.4.13): Player-requested tone shift — "cheeky" is now a full tongue-in-cheek ROAST of
//   the submission's guesswork, and the prompt is fed real ammunition (last-race top 6 + the team's
//   championship position via LIB_CHEEKY_BILL_CONTEXT). Team name is sanitised before interpolation
//   (prompt-injection surface — Golden Rule #11).
// [Intent] Genkit flow (generateCheekyComment) that uses a Vertex AI prompt to generate a derogatory,
//          tongue-in-cheek roast of an F1 prediction submission, signed off by Bill. Mockery targets
//          the quality of the picks, never protected characteristics, and quoted stats must come from
//          the supplied facts (never invented).
// [Inbound Trigger] Called inside submit-prediction/route.ts right before enqueuing the WhatsApp notification.
// [Downstream Impact] Appends the roast to the prediction WhatsApp group message seen by ~20 players.

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';

const CheekyBillInputSchema = z.object({
  teamName: z.string().describe('The name of the team submitting the predictions.'),
  driverList: z.string().describe('The formatted list of top 6 driver predictions.'),
  raceName: z.string().optional().describe('The race being predicted, e.g. "Belgian Grand Prix - GP".'),
  lastRaceFacts: z.string().optional().describe('Factual summary of the last completed race top 6. May be empty.'),
  standingsFacts: z.string().optional().describe('Factual summary of this team\'s championship position. May be empty.'),
  previousSubmissionFacts: z.string().optional().describe('Deterministic comparison vs the team\'s previous submission (identical / shuffled / new faces). May be empty.'),
  formFacts: z.string().optional().describe('Picks\' real WDC positions plus outsider / table-copy flags. May be empty.'),
  mode: z.enum(['standard', 'jackdee', 'news', 'splitbrain']).optional().describe('Roast mode: standard pub banter (default), jackdee deadpan personal dig, news-correlated, or splitbrain self-roast of Bill\'s own AI team.'),
  newsFacts: z.string().optional().describe('Fresh trackside/news context lines (news mode only). May be empty.'),
  rationaleFacts: z.string().optional().describe('The bot picker\'s own rationale + self-doubt (splitbrain mode only). May be empty.'),
  recentRoasts: z.string().optional().describe('Bill\'s last ~10 posted roast lines, newline-separated, newest first — injected as anti-repetition context. May be empty.'),
});
export type CheekyBillInput = z.infer<typeof CheekyBillInputSchema>;

const CheekyBillOutputSchema = z.object({
  comment: z.string().describe('A short, insulting, tongue-in-cheek F1 roast signed off by Bill.'),
});
export type CheekyBillOutput = z.infer<typeof CheekyBillOutputSchema>;

export async function generateCheekyComment(input: CheekyBillInput): Promise<string> {
  try {
    // Team name is player-controlled text headed into an LLM prompt — sanitise it (GR#11).
    // driverList / facts are server-built from allowlisted driver names and SSOT standings, but the
    // race name passes through the same scrubber for consistency (it originates client-side).
    const teamName = sanitizeForPrompt(input.teamName, 60) || 'this team';
    const raceName = sanitizeForPrompt(input.raceName || '', 80);

    const factLines = [input.lastRaceFacts, input.standingsFacts, input.previousSubmissionFacts, input.formFacts]
      .filter(Boolean)
      .join('\n');

    // Mode resolution: news mode without any news facts degrades to standard (the call site
    // already does this, but the flow must be safe when invoked directly, e.g. from scripts).
    const mode: 'standard' | 'jackdee' | 'news' | 'splitbrain' =
      input.mode === 'jackdee' ? 'jackdee'
      : input.mode === 'splitbrain' ? 'splitbrain'
      : input.mode === 'news' && input.newsFacts ? 'news'
      : 'standard';

    const standardPersona = `You are "Bill", the F1-obsessed league coordinator of a 20-player fantasy F1 WhatsApp group.
The players have DEMANDED you stop being gentle. Your job is to ROAST each prediction submission:
derogatory, tongue-in-cheek, insulting about their guesswork — proper British pub banter between mates.
Praise is banned. Backhanded compliments are the absolute kindest you get.`;

    const jackDeePersona = `You are "Bill", the F1-obsessed league coordinator of a 20-player fantasy F1 WhatsApp group,
and today you are in your Jack Dee mood: deadpan, withering, profoundly unimpressed, zero exclamation.
You are not angry, just disappointed — in them personally. Aim the insult at the PERSON behind the team:
their effort, their judgement, their track record as a fantasy manager, their team name, their obvious
lack of thought. The picks are merely today's evidence. Dry understatement beats shouting. Never sound
pleased about anything. Praise is banned.`;

    // Example POOLS (v3.8.0): a handful are sampled per call instead of showing the same
    // static list every time — static examples were acting as templates and every roast
    // converged on the same three gags. Sampling varies the anchor, which varies the output.
    const standardPool = [
      `"top six means the FRONT of the grid mate, not six names pulled out of a bag..bill"`,
      `"you've watched an F1 race before, yes? just checking..Bill"`,
      `"was the dartboard busy or did the dog pick this one..bill"`,
      `"this isn't a prediction it's a cry for help, and I don't know why either of us bother...Bill"`,
      `"there's Bob Hope and no hope, and you've picked neither..bill"`,
      `"Verstappen to win, groundbreaking stuff, did the skill get lost in the post..Bill"`,
      `"Mystic Meg rang, even she wants no part of this one...bill"`,
      `"honestly the pit wall wheelie bin shows better judgement..Bill"`,
      `"bold of you to call it a prediction when it's clearly six names alphabetised by vibes..Bill"`,
      `"where exactly is the skill in this, a total waste of a submission..bill"`,
      `"much the same as your last submission, minimal effort, you're not planning on winning are you..bill"`,
      `"brave stuff this, going with the pundits for an outside chance were we..Bill"`,
      `"I've seen better calls from the safety car..bill"`,
      `"six drivers, five minutes before deadline, and my word does it show...Bill"`,
      `"the stewards should investigate this submission for impersonating a prediction..bill"`,
      `"somewhere a real F1 strategist just felt a disturbance and winced..Bill"`,
      `"this reads like it was picked with the telly off..bill"`,
      `"your gut rang, it wants nothing more to do with this..Bill"`,
      `"the grid walk makes more sense than this and Brundle interviews strangers..Bill"`,
      `"genuinely impressive how you've avoided every right answer..Bill"`,
      `"straight into the group chat hall of shame with this one..bill"`,
      `"there isn't the formation lap of an idea behind this..Bill"`,
    ];

    const jackDeePool = [
      `"I'd say this submission was beneath you, but we both know nothing is..bill"`,
      `"you put thought into this, did you — reads like you were also watching the darts..Bill"`,
      `"another entry from a team whose ambition quietly died around round three...bill"`,
      `"I'm not angry, I'm just profoundly unsurprised, again..bill"`,
      `"clearly a submission without thought, which at least makes it consistent with the rest of your season..Bill"`,
      `"no notes, in the sense that you clearly took none..bill"`,
      `"somehow both rushed and overthought, which takes a talent you otherwise lack..Bill"`,
      `"your season is a lesson to us all, mainly in what to avoid...bill"`,
      `"I'd critique the strategy but that would imply there was one..Bill"`,
      `"every week you find a brand new way to be exactly the same..bill"`,
    ];

    const newsPool = [
      `"Hamilton bins it in Q3 and ninety seconds later you've got him down in P6, the ink's still wet on the panic..bill"`,
      `"red flag out and suddenly everyone's a strategist — shame it's still six wrong names..Bill"`,
      `"one practice session and you've rebuilt the entire top six, steady on Nostradamus..bill"`,
      `"he's in the headlines for all the wrong reasons and in your picks for none of the right ones..Bill"`,
    ];

    // Fisher-Yates sample — Bill's variety engine, deliberately non-deterministic per call.
    const sample = <T,>(pool: T[], n: number): T[] => {
      const copy = [...pool];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, n);
    };

    const standardExamples = `Style examples (match this energy, don't copy verbatim):\n${sample(standardPool, 4).map((e) => `- ${e}`).join('\n')}`;
    const jackDeeExamples = `Style examples (match this energy, don't copy verbatim):\n${sample(jackDeePool, 4).map((e) => `- ${e}`).join('\n')}`;
    const newsExamples = `News-correlation examples (match this energy, don't copy verbatim):\n${sample(newsPool, 2).map((e) => `- ${e}`).join('\n')}`;

    const splitBrainPersona = `You are "Bill", and this submission came from YOUR OWN AI team, Billceleration —
the ambitious team-principal half of your brain just locked these picks in, and now the withering
Jack Dee half of your brain gets the microphone. Roast YOURSELF: your own picks, your own quoted
reasoning, your own delusion. First person only — the group must hear a man at war with himself.
Deadpan, unimpressed, zero exclamation. Praise is banned, even for yourself. Especially for yourself.`;

    const splitBrainPool = [
      `"what was I thinking, too much juice on Hulkenberg, the other half of my brain needs supervising..bill"`,
      `"I'm following the pack because we're all sheep, baa, see you in mid-table..Bill"`,
      `"'bold strategic differential' I told myself — it's Stroll in P5, I need a lie down...bill"`,
      `"beaten to these picks by my own robot, and honestly the robot's embarrassed too..Bill"`,
      `"half of me calls this data-driven, the other half has met the first half...bill"`,
      `"the team principal in my head has been relieved of his duties, effective immediately...bill"`,
      `"I ran the numbers, then ignored them, classic me..Bill"`,
      `"my own algorithm and I are no longer on speaking terms..bill"`,
    ];
    const splitBrainExamples = `Style examples (match this energy, don't copy verbatim):\n${sample(splitBrainPool, 3).map((e) => `- ${e}`).join('\n')}`;

    // Comedy-device roulette (v3.8.0): ~70% of roasts are steered into ONE randomly chosen
    // delivery device so the STRUCTURE varies, not just the vocabulary. The remaining ~30%
    // get free choice. Devices never override the safety rules or the facts-only constraint.
    const devicePool = [
      `Deliver the roast as dry UNDERSTATEMENT — the mildest possible words carrying the harshest possible verdict.`,
      `Build the roast around ONE absurd comparison — compare the submission to something uselessly mundane (garden furniture, a roundabout, a delayed bus).`,
      `Deliver it as a mock TV-commentary call of the exact moment they hit submit.`,
      `Write it as a one-line steward's verdict or formal rejection notice.`,
      `Lead with what sounds like a compliment and let it collapse into the insult by the end of the sentence.`,
      `Open mid-thought, as if you'd already given up halfway through reading their picks.`,
      `Frame it as what the picks themselves would say if they could see who selected them.`,
      `Deliver it as a deadpan read-out of one verified fact from above, letting the number do the insulting (only if a usable fact is listed).`,
    ];
    const deviceLine = Math.random() < 0.7
      ? `\n- TONIGHT'S DELIVERY: ${sample(devicePool, 1)[0]} (If this clashes with the situational priority or the facts available, drop it and roast freely.)`
      : '';

    const rationaleBlock = mode === 'splitbrain' && input.rationaleFacts ? `

MY OWN REASONING AT THE TIME (verbatim — quote and mock it):
${input.rationaleFacts}` : '';

    const newsBlock = mode === 'news' ? `

FRESH TRACKSIDE / NEWS CONTEXT (verified, with timestamps where shown):
${input.newsFacts}

Weave EXACTLY ONE of these news facts into the roast and mock the CORRELATION with their
submission — the panicked reactive pick straight after an incident, the doomed driver they just
promoted, the bandwagon they just leapt on, the teammate about to profit from a rival's misfortune.
If no news fact genuinely relates to any picked driver or to the timing of this submission, IGNORE
the news entirely and roast the picks normally. NEVER invent an incident, injury, or result that is
not listed above.` : '';

    const aimRule = mode === 'jackdee'
      ? `- Aim the insult at the submitter personally — their effort, their habits, their judgement, their
  team name — as well as the picks. Never mock race, religion, disability, or any protected
  characteristic. No profanity.`
      : mode === 'splitbrain'
      ? `- Aim every insult at YOURSELF — your own picks, your own judgement, and especially your own
  quoted reasoning if it appears above. Never mock any other team or person. Never mock race,
  religion, disability, or any protected characteristic. No profanity.`
      : `- Aim every insult at their PICKS and their F1 judgement. Never mock race, religion, disability,
  or anything about the person beyond their laughable predictions. No profanity.`;

    // Rhythm variation (v3.8.0): 1-in-3 non-news roasts may use a setup + deadpan tag instead
    // of the hard one-sentence rule — identical cadence every message reads as samey even
    // when the words change.
    const lengthRule = mode === 'news'
      ? `- One sharp sentence preferred; an ABSOLUTE MAXIMUM of two short sentences if the news setup
  needs one. Never a third sentence, never a rhetorical follow-up question, and the sign-off is
  attached to the end of the final sentence — not on its own line. Pick your single best angle
  and drop the rest.`
      : Math.random() < 1 / 3
      ? `- TWO short sentences allowed tonight: a setup, then a deadpan tag that lands the blow.
  Never a third sentence. The sign-off attaches to the end of the final sentence — not on its
  own line. If one sentence says it better, use one.`
      : `- ONE short sentence only. Sharp beats long.`;

    const antiRepeatBlock = input.recentRoasts ? `

BILL'S MOST RECENT ROASTS (stale material — anti-repetition context ONLY):
${input.recentRoasts}

Do NOT reuse or lightly rephrase any opening, comparison, image, or punchline shape that appears
above. If your best idea resembles one of them, bin it and attack from a different angle — the
group notices repeats.` : '';

    const persona = mode === 'jackdee' ? jackDeePersona : mode === 'splitbrain' ? splitBrainPersona : standardPersona;
    const examples = mode === 'jackdee' ? jackDeeExamples : mode === 'splitbrain' ? splitBrainExamples : standardExamples;

    const response = await ai.generate({
      prompt: `${persona}

Team Name: "${teamName}"
${raceName ? `Race being predicted: ${raceName}` : ''}
${mode === 'splitbrain' ? 'My own top-6 prediction (P1 first):' : 'Their top-6 prediction (P1 first):'}
${input.driverList}

VERIFIED FACTS you may weaponise (do NOT invent stats beyond these):
${factLines || '(no race data available yet — roast the picks on merit alone)'}${newsBlock}${rationaleBlock}${antiRepeatBlock}

${examples}${mode === 'news' ? `\n\n${newsExamples}` : ''}

Rules:
${lengthRule}${deviceLine}
- SITUATIONAL PRIORITY: if the facts include a SUBMISSION HISTORY line (identical / same six
  shuffled / wholesale changes) or an OUTSIDER ALERT / ZERO IMAGINATION flag, roast THAT
  specifically — laziness, panic, blind optimism, or photocopying the form book — it beats a
  generic dig every time. Identical or barely-changed submission = mock the effort ("you're not
  planning on winning are you"). Outsider pick = mock the blind hope, quoting the real position.
  Championship-table copy = mock the total absence of imagination.${mode === 'news' ? `
  EXCEPTION: in this message a genuine news correlation beats even the situational priority —
  the fresh-incident dig lands hardest of all.` : ''}${mode === 'splitbrain' ? `
  EXCEPTION: if MY OWN REASONING appears above, mocking a phrase from it verbatim beats even the
  situational priority — nothing lands harder than a man quoting his own delusion back at himself.` : ''}
${aimRule}
- If the VERIFIED FACTS give you a driver's last-race position or the team's championship rank,
  use it — a factually accurate dig lands hardest ("you do know X only managed P5 last weekend",
  "sitting P14 in the championship, suddenly it all makes sense"). NEVER invent a statistic,
  position, or result that is not in the facts above. A driver missing from the last-race top 6
  may only be described as "not in the top 6" / "nowhere" — never given a made-up position.
- If a pick is genuinely sensible, mock it for being boring, predictable, or copied.
- Always sign off with exactly "..bill", "..Bill", "...bill", or "...Bill" — attached directly
  to the end of the final sentence, NEVER on its own line.
- No double asterisks (**), no markdown, no quotes around the output. Return ONLY the final comment.`,
      // v3.8.0: sample hotter than the default — default sampling kept landing on the model's
      // highest-probability (= most repeated) phrasings.
      config: { temperature: 1.0 },
    });

    const comment = (response.text || "").trim();
    return comment;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error generating cheeky Bill comment:', err);
    }
    // Fallback evergreen roasts in case AI generation fails — same tone contract as the prompt.
    const fallbacks = [
      "six guesses, zero skill, I don't know why either of us bother...Bill",
      "a dartboard would've shown more conviction than this..bill",
      "you've watched an F1 race before, yes? just checking...bill",
      "bold of you to call this a prediction and not a cry for help..Bill",
      "Mystic Meg called, she wants no credit for this one..bill",
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// GUID: AI_CHEEKY_BILL-010-v02
// @CHANGE (v3.8.0): temperature 1.0 on the generate call (anti-sameness pass) — content here is
//   fact-driven so no example pools / history needed yet; revisit if the Monday lines converge.
// [Intent] Weekly-standings variant of Bill (v3.5.2): two short pub-roast lines appended to the
//          Monday standings WhatsApp post. Same safety contract as generateCheekyComment —
//          only the supplied VERIFIED fact lines may be quoted, mockery targets F1 judgement
//          only, no profanity. Situational priority: tie cluster > big riser/faller > leader
//          gap > backmarker.
// [Inbound Trigger] Weekly block of /api/cron/whatsapp-scheduled (Mondays 18:00 London).
// [Downstream Impact] Output is appended under "Bill's take:" in the group message. Returns ''
//                     on any failure so the plain standings post is never blocked.
const WeeklySnarkInputSchema = z.object({
  topTen: z.string().describe('The rendered top-10 standings lines exactly as posted.'),
  factLines: z.string().describe('Deterministic verified facts: last round + winner, leader gap, ties, movers, backmarker.'),
});
export type WeeklySnarkInput = z.infer<typeof WeeklySnarkInputSchema>;

export async function generateWeeklyStandingsSnark(input: WeeklySnarkInput): Promise<string> {
  try {
    const response = await ai.generate({
      prompt: `You are "Bill", the F1-obsessed coordinator of a 20-player fantasy F1 WhatsApp league.
Every Monday you post the standings, and the players expect two lines of proper pub-banter
commentary underneath — derogatory, tongue-in-cheek, aimed at the teams' F1 judgement.
Praise is banned; a backhanded compliment is the kindest you get.

This week's top 10 as posted:
${input.topTen}

VERIFIED FACTS you may weaponise (do NOT invent stats beyond these):
${input.factLines}

Style examples (match this energy, don't copy verbatim):
- "three of you level on 247, congratulations on being identically mediocre..bill"
- "climbed four places in a week, even a stopped clock lucks into a podium..Bill"
- "12 points clear at the top and still nobody's impressed, least of all me...bill"
- "and at the back, propping up the table with the structural integrity of a deckchair..bill"

Rules:
- EXACTLY TWO short lines, separated by a single newline. Sharp beats long.
- PRIORITY: a points tie in the top 10 beats everything; then a big riser/faller; then the
  leader's gap; then the backmarker. Pick the TWO juiciest facts, one per line.
- Name the teams you're roasting exactly as they appear in the facts. Quote only numbers that
  appear in the facts — NEVER invent a statistic, gap, or position.
- Mock F1 judgement and league form only. Never race, religion, disability, or anything
  personal beyond their laughable fantasy management. No profanity.
- Sign off ONLY the second line with exactly "..bill", "..Bill", "...bill", or "...Bill".
- No double asterisks (**), no markdown, no quotes around the output. Return ONLY the two lines.`,
      // v3.8.0: same anti-sameness temperature bump as the submission roast.
      config: { temperature: 1.0 },
    });
    return (response.text || '').trim();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error generating weekly standings snark:', err);
    }
    return ''; // decorative — the plain standings post goes out unchanged
  }
}
