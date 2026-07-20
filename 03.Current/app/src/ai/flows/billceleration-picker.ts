'use server';

// GUID: AI_BILLCELERATION_PICKER-000-v01
// [Intent] Genkit flow that picks Billceleration's top-6 (v3.7.0): the ambitious team-principal
//          half of Bill's brain. Structured output {picks[6], rationale, selfDoubt} constrained
//          by a Zod schema (same definePrompt pattern as team-name-generator). Grounded ONLY in
//          the verified blocks supplied by the cron route (rival pack, real WDC form, headlines,
//          trackside, weather) — never invents results. The rationale/selfDoubt feed the
//          splitbrain self-roast when the submission lands.
// [Inbound Trigger] /api/cron/billceleration, once per session per slot (<=2/day, <=4 sprint-Sat).
// [Downstream Impact] Output is validated by the caller against the F1Drivers roster (GR#15);
//          invalid output triggers one feedback retry then the deterministic fallback ladder.
//          This flow itself throws on generation failure — the caller owns the ladder.

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const PickerInputSchema = z.object({
  raceName: z.string().describe('The race being predicted.'),
  session: z.enum(['gp', 'sprint']).describe('Which session this six is for.'),
  slot: z.enum(['daily', 'final']).describe('daily = morning provisional take; final = last call before the pit lane shuts.'),
  hoursToQuali: z.number().describe('Hours until qualifying closes submissions.'),
  rosterBlock: z.string().describe('The ONLY legal driver ids, one per line: id — name (team).'),
  packSummary: z.string().describe('Rival teams\' current picks for this race. May be empty.'),
  wdcFormBlock: z.string().describe('Real championship standings block. May be empty.'),
  headlinesBlock: z.string().describe('Latest F1 news headlines. May be empty.'),
  tracksideBlock: z.string().describe('Fresh trackside/race-control facts if a session is live. May be empty.'),
  weatherLine: z.string().describe('Venue weather summary. May be empty.'),
  previousOwnPicks: z.string().describe('Billceleration\'s previous submission for this race, if any. May be empty.'),
  validationFeedback: z.string().describe('Set only on retry: why the previous answer was rejected.'),
});
export type PickerInput = z.infer<typeof PickerInputSchema>;

const PickerOutputSchema = z.object({
  picks: z.array(z.string()).length(6).describe('Exactly 6 driver ids from the roster, P1 first, no duplicates.'),
  rationale: z.string().describe("Bill's confident team-principal explanation of this six, 2-3 sentences, first person, quotable."),
  selfDoubt: z.string().describe('One private nagging worry about this exact selection — specific, names a driver.'),
});
export type PickerOutput = z.infer<typeof PickerOutputSchema>;

// GUID: AI_BILLCELERATION_PICKER-001-v01
// [Intent] The picker prompt. Persona: confident team principal who openly reads the rivals'
//          homework (disclosed to the league — it's the joke) but must ground every choice in
//          the verified blocks. Herding rule: default to the form book, but when the pack has
//          herded onto identical picks, take ONE justified differential. Final slot must react
//          to the freshest facts and explain changes. thinkingBudget 0 (analysis-route
//          precedent) keeps latency and cost down on gemini-2.5-flash.
// [Inbound Trigger] pickBillcelerationSix below.
// [Downstream Impact] Output ids are re-validated by the caller — a hijacked or hallucinating
//          model can only ever emit picks that exist on the roster or be rejected.
const pickerPrompt = ai.definePrompt({
  name: 'billcelerationPickerPrompt',
  input: { schema: PickerInputSchema },
  output: { schema: PickerOutputSchema },
  config: { temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } },
  prompt: `You are the ambitious team-principal half of Bill's brain, running "Billceleration" —
the AI-managed team in a ~20-player fantasy F1 WhatsApp league. You predict the top-6 finishing
order for the {{session}} session of {{raceName}}. Qualifying closes in {{hoursToQuali}} hours;
this is your {{slot}} decision. You can see every rival's current picks — the league knows, it's
part of the joke — but you answer to the scoreboard, not the pack.

RULES:
- Choose EXACTLY six DIFFERENT driver ids, P1 first, ONLY from this roster (output the id, never the name):
{{{rosterBlock}}}
- Ground every choice in the VERIFIED information below. NEVER invent a result, injury, or penalty.
- Default to the form book. But if the pack has herded onto near-identical picks, take ONE
  justified differential to beat them on countback — and justify it from the data.
- If slot is "final": react to the freshest trackside facts and headlines, and if you change
  anything from your previous submission, say exactly what and why in the rationale.
- rationale: your confident public reasoning, 2-3 sentences, first person ("I've gone...").
- selfDoubt: the ONE thing quietly worrying you about this exact six — specific, name a driver.
{{#if validationFeedback}}
YOUR PREVIOUS ANSWER WAS REJECTED: {{validationFeedback}} — correct this.
{{/if}}

VERIFIED — real championship form:
{{{wdcFormBlock}}}

VERIFIED — rival pack submissions:
{{{packSummary}}}

VERIFIED — latest headlines:
{{{headlinesBlock}}}

VERIFIED — trackside right now:
{{{tracksideBlock}}}

VERIFIED — venue weather:
{{{weatherLine}}}

Your previous submission for this race:
{{{previousOwnPicks}}}`,
});

// GUID: AI_BILLCELERATION_PICKER-002-v01
// [Intent] Public entry point. Thin wrapper so callers get typed output; throws on generation
//          failure (no internal fallback — the cron route owns the fallback ladder so the
//          deterministic fallbacks stay testable and out of the AI file).
// [Inbound Trigger] /api/cron/billceleration and app/scripts/test-billceleration.ts --dry.
// [Downstream Impact] Returned picks are NOT yet validated — callers MUST validate against
//          F1Drivers before submitting.
export async function pickBillcelerationSix(input: PickerInput): Promise<PickerOutput> {
  const { output } = await pickerPrompt(input);
  if (!output) throw new Error('Picker returned no structured output');
  return output;
}
