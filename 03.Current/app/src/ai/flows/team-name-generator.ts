'use server';

/**
 * @fileOverview This file defines a Genkit flow to generate a punny F1 team name.
 *
 * - `generateTeamName`: An async function that triggers the name generation process.
 * - `TeamNameOutput`: The output type for the `generateTeamName` function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const TeamNameInputSchema = z.object({
  existingTeamName: z.string().describe('An existing F1 team name to base a pun on.'),
});
export type TeamNameInput = z.infer<typeof TeamNameInputSchema>;

const TeamNameOutputSchema = z.object({
  teamName: z.string().describe('A funny, pun-based F1 team name.'),
});
export type TeamNameOutput = z.infer<typeof TeamNameOutputSchema>;

export async function generateTeamName(input: TeamNameInput): Promise<TeamNameOutput> {
  return generateTeamNameFlow(input);
}

const teamNamePrompt = ai.definePrompt({
    name: 'teamNamePrompt',
    input: { schema: TeamNameInputSchema },
    output: { schema: TeamNameOutputSchema },
    prompt: `You are a creative assistant who is an expert at making funny puns. 
      Generate a pun-based team name based on the following existing F1 team name: {{{existingTeamName}}}.
      For example, if the existing name is "Red Bull", a good pun would be "Racing Bulls".
      Only return the new team name. Do not include any other text.`,
});


const generateTeamNameFlow = ai.defineFlow(
  {
    name: 'generateTeamNameFlow',
    inputSchema: TeamNameInputSchema,
    outputSchema: TeamNameOutputSchema,
  },
  async (input) => {
    const { output } = await teamNamePrompt(input);
    return output!;
  }
);
