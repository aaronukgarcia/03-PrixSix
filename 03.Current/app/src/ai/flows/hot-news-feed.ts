
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
import { getHotNewsSettings, updateHotNewsContent } from '@/firebase/firestore/settings';
import { firestore } from '@/firebase/server';
import { serverTimestamp } from 'firebase/firestore';


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

    // If the feed is disabled by admin, return the static content.
    if (!settings.hotNewsFeedEnabled) {
        console.log('AI Hot News Feed is disabled by admin. Serving static content.');
        return { newsFeed: settings.content, lastUpdated: formatLastUpdated(settings.lastUpdated) };
    }

    const now = new Date().getTime();
    // lastUpdated can be null on first run, so we check for it.
    const lastUpdatedMs = settings.lastUpdated ? settings.lastUpdated.toMillis() : 0;
    const oneHour = 60 * 60 * 1000;

    // If not locked and cache is older than 1 hour, fetch new data.
    if (!settings.isLocked && (now - lastUpdatedMs > oneHour)) {
        console.log('Cache expired or not present. Fetching new hot news...');
        try {
            // The flow itself now handles the update.
            const output = await hotNewsFeedFlow();
            const newTimestamp = new Date();
            // Also update firestore with serverTimestamp for consistency
            await updateHotNewsContent(firestore, { content: output.newsFeed, lastUpdated: serverTimestamp() as any });
            return { ...output, lastUpdated: newTimestamp.toISOString() };
        } catch (error) {
            console.error("Error fetching new hot news, serving stale data:", error);
            // Fallback to serving stale data if the flow fails
            return { newsFeed: settings.content, lastUpdated: formatLastUpdated(settings.lastUpdated) };
        }
    }

    // Otherwise, return cached content from Firestore
    console.log('Serving cached hot news from Firestore.');
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
