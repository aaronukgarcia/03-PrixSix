'use server';

// GUID: AI_CHEEKY_BILL-000-v01
// [Intent] Genkit flow (generateCheekyComment) that uses a Vertex AI prompt to generate a witty, snarky, and cheeky F1 prediction closeout comment signed off by Bill.
// [Inbound Trigger] Called inside submit-prediction/route.ts right before enqueuing the WhatsApp notification.
// [Downstream Impact] Appends a personalized, witty snarky comment to the prediction WhatsApp group message.

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const CheekyBillInputSchema = z.object({
  teamName: z.string().describe('The name of the team submitting the predictions.'),
  driverList: z.string().describe('The formatted list of top 6 driver predictions.'),
});
export type CheekyBillInput = z.infer<typeof CheekyBillInputSchema>;

const CheekyBillOutputSchema = z.object({
  comment: z.string().describe('A cheeky, sarcastic F1 comment signed off by Bill.'),
});
export type CheekyBillOutput = z.infer<typeof CheekyBillOutputSchema>;

export async function generateCheekyComment(input: CheekyBillInput): Promise<string> {
  try {
    const response = await ai.generate({
      prompt: `You are "Bill" (often signed off as "..bill" or "..Bill"), a cheeky, F1-obsessed, highly sarcastic, and witty league coordinator.
Generate a short, sharp, and opinionated one-liner comment about this user's F1 prediction submission.

Team Name: "${input.teamName}"
Submission:
${input.driverList}

Instructions:
- Be witty, funny, sarcastic, or slightly cheeky. Make fun of their choices or praise them in a backhanded way.
- Customize the snark precisely to their choices. Examples:
  - If they put Hamilton last/low: "having Hamilton last, thats a bit boring..bill"
  - If they put Antonelli first: "antonelli first..thats predictable..bill"
  - If they put Hamilton first/pole: "hamilton for pole, brave...Bill"
  - If they predict Verstappen to lose or win: comment on his dominance, form, or general predictability.
  - If they have a wild prediction (like Colapinto or Lawson high up): call out their bravery or absolute insanity.
- The comment MUST be a single, short sentence.
- Always sign off the comment at the end with exactly "..bill", "..Bill", "...bill", or "...Bill".
- Do NOT use double asterisks (**), markdown headers, or any other formatting. Return ONLY the final comment.`,
    });

    const comment = (response.text || "").trim();
    return comment;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error generating cheeky Bill comment:', err);
    }
    // Fallback evergreen witty comments in case AI generation fails
    const fallbacks = [
      "verstappen to win, how original...Bill",
      "bold predictions there, let's see if it pays off...Bill",
      "interesting choices, are we watching the same sport?...bill",
      "brave picks, hope you didn't bet the mortgage on it..Bill"
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}
