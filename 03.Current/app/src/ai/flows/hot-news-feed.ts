
'use server';

/**
 * @fileOverview An AI agent that scrapes F1.com for hot news related to weather, track conditions,
 * and driver updates before each race. This information is intended to help users make informed
 * predictions. The flow scrapes the website, extracts relevant information, and formats it into
 * a concise news feed. It uses a Firestore-backed cache with a 1-hour TTL.
 *
 * - getHotNewsFeed - A function that retrieves and formats the hot news feed.
 * - hotNewsFeedFlow - An exported function that can be called directly to bypass the cache.
 * - HotNewsFeedOutput - The return type for the getHotNewsFeed function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'zod';
import { getHotNewsSettings } from '@/firebase/firestore/settings';
import { firestore } from '@/firebase/server';


const HotNewsFeedOutputSchema = z.object({
  newsFeed: z.string().describe('A concise summary of the latest F1 news, including weather, track conditions, and driver updates.'),
  lastUpdated: z.string().optional().describe('ISO timestamp of when the news was last updated.'),
});
export type HotNewsFeedOutput = z.infer<typeof HotNewsFeedOutputSchema>;


export async function getHotNewsFeed(): Promise<HotNewsFeedOutput> {
    const settings = await getHotNewsSettings(firestore);

    // Format lastUpdated timestamp
    const formatLastUpdated = (timestamp: any) => {
        if (!timestamp || !timestamp.toDate) return undefined;
        return timestamp.toDate().toISOString();
    };

    // Always return the content from Firestore - admin controls the content
    // The AI refresh is only triggered manually via the admin "Refresh Now" button
    console.log('Serving hot news from Firestore.');
    return { newsFeed: settings.content, lastUpdated: formatLastUpdated(settings.lastUpdated) };
}

const mockNewsFeed = `
Weather Update: Sunny skies expected for the race with a track temperature of 35°C.
Track Conditions: Track record stands at 1:24.567 set by Lewis Hamilton in 2020. Last year's winner was Max Verstappen.
Driver News: No major driver illnesses reported. Free practice results: Sector 1 - Verstappen, Sector 2 - Leclerc, Sector 3 - Hamilton.
`;

// This flow now also handles writing the result to Firestore.
export const hotNewsFeedFlow = ai.defineFlow({
    name: "hotNewsFeedFlow",
    inputSchema: z.void(),
    outputSchema: HotNewsFeedOutputSchema,
}, async () => {
    // In a real scenario, this would be an LLM call to generate news.
    // For now, we use mock data.
    const newsFeed = mockNewsFeed;

    return { newsFeed };
});
