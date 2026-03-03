
'use server';

/**
 * @fileOverview Hot News Feed — AI-generated race bulletin using live weather data.
 *
 * Fetches weather from Open-Meteo for the upcoming race venue, optionally enriches
 * with OpenF1 live session data, then calls Vertex AI (Gemini 2.0 Flash via Genkit)
 * to generate a 3–4 bullet-point bulletin useful for F1 predictions.
 *
 * Results are written to app-settings/hot-news in Firestore with a refreshCount
 * that increments on every successful generation.
 *
 * - getHotNewsFeed   — reads from Firestore (called by dashboard)
 * - hotNewsFeedFlow  — generates new content + writes to Firestore (admin + cron)
 * - HotNewsFeedOutput — return type
 *
 * GUID: HOT_NEWS_FLOW-000-v02
 * [Intent] Replace mock hot-news bulletin with real AI generation driven by live weather.
 * [Inbound Trigger] Admin "Refresh Now" button (direct call) or hourly cron via
 *                   /api/cron/refresh-hot-news POST route.
 * [Downstream Impact] Writes app-settings/hot-news; read by dashboard HotNewsFeed component.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { RaceSchedule } from '@/lib/data';

// GUID: HOT_NEWS_FLOW-001-v01
// [Intent] Output schema for the hot news feed — content string + metadata.
// [Inbound Trigger] ai.defineFlow outputSchema, getHotNewsFeed return type.
// [Downstream Impact] HotNewsFeed.tsx destructures newsFeed, lastUpdated, refreshCount.
const HotNewsFeedOutputSchema = z.object({
    newsFeed: z.string().describe('A concise summary of the latest F1 news, including weather, track conditions, and driver updates.'),
    lastUpdated: z.string().optional().describe('ISO timestamp of when the news was last updated.'),
    refreshCount: z.number().optional().describe('How many times the feed has been refreshed.'),
});
export type HotNewsFeedOutput = z.infer<typeof HotNewsFeedOutputSchema>;

// GUID: HOT_NEWS_FLOW-002-v01
// [Intent] Lat/lng coordinates for all 24 race venues so Open-Meteo can return
//          localised weather forecasts without an API key.
// [Inbound Trigger] buildWeatherContext() looks up the next race location here.
// [Downstream Impact] If a venue is missing, weather falls back to "unavailable".
const VENUE_COORDS: Record<string, [number, number]> = {
    "Melbourne":         [-37.8497, 144.9680],
    "Shanghai":          [31.3389,  121.2201],
    "Suzuka":            [34.8431,  136.5406],
    "Sakhir":            [26.0325,   50.5106],
    "Jeddah":            [21.6319,   39.1044],
    "Miami":             [25.9581,  -80.2389],
    "Montreal":          [45.5017,  -73.5673],
    "Monaco":            [43.7347,    7.4206],
    "Barcelona":         [41.5700,    2.2600],
    "Spielberg":         [47.2197,   14.7647],
    "Silverstone":       [52.0786,   -1.0169],
    "Spa-Francorchamps": [50.4372,    5.9714],
    "Budapest":          [47.5830,   19.2526],
    "Zandvoort":         [52.3888,    4.5409],
    "Monza":             [45.6156,    9.2811],
    "Madrid":            [40.3517,   -3.7878],
    "Baku":              [40.3724,   49.8533],
    "Singapore":          [1.2914,  103.8644],
    "Austin":            [30.1328,  -97.6411],
    "Mexico City":       [19.4042,  -99.0907],
    "Sao Paulo":         [-23.7036, -46.6997],
    "Las Vegas":         [36.1147, -115.1728],
    "Lusail":            [25.4900,   51.4542],
    "Yas Marina":        [24.4672,   54.6031],
};

// GUID: HOT_NEWS_FLOW-003-v01
// [Intent] WMO weather code to human-readable description map for Open-Meteo responses.
// [Inbound Trigger] Used by buildWeatherContext() to make weather codes readable in the AI prompt.
// [Downstream Impact] Affects the quality of the AI-generated bulletin.
const WMO_CODES: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Icy fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

const defaultHotNews = {
    content: "Welcome to the Hot News Feed! The AI is warming up its engines...",
    lastUpdated: null as any,
};

// GUID: HOT_NEWS_FLOW-004-v01
// [Intent] Read the current hot news bulletin from Firestore for display on the dashboard.
//          Never triggers an AI call — reads only. AI generation happens via hotNewsFeedFlow.
// [Inbound Trigger] HotNewsFeed.tsx server component on every dashboard load.
// [Downstream Impact] Returns newsFeed content, lastUpdated timestamp, and refreshCount to the UI.
export async function getHotNewsFeed(): Promise<HotNewsFeedOutput> {
    try {
        const { db } = await getFirebaseAdmin();
        const docSnap = await db.collection('app-settings').doc('hot-news').get();

        if (!docSnap.exists) {
            if (process.env.NODE_ENV !== 'production') {
                console.log('Hot news document not found, returning defaults.');
            }
            return { newsFeed: defaultHotNews.content, lastUpdated: undefined, refreshCount: undefined };
        }

        const data = docSnap.data();
        const content = data?.content || defaultHotNews.content;
        const refreshCount = typeof data?.refreshCount === 'number' ? data.refreshCount : undefined;

        let lastUpdated: string | undefined;
        if (data?.lastUpdated && typeof data.lastUpdated.toDate === 'function') {
            lastUpdated = data.lastUpdated.toDate().toISOString();
        }

        return { newsFeed: content, lastUpdated, refreshCount };
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.error('Error fetching hot news:', error);
        }
        return { newsFeed: defaultHotNews.content, lastUpdated: undefined, refreshCount: undefined };
    }
}

// GUID: HOT_NEWS_FLOW-005-v01
// [Intent] Find the next upcoming race from RaceSchedule for weather targeting.
//          Falls back to last race if season is complete.
// [Inbound Trigger] hotNewsFeedFlow() at generation time.
// [Downstream Impact] Determines which venue's weather is fetched.
function getNextRace() {
    const now = new Date();
    return RaceSchedule.find(r => new Date(r.qualifyingTime) > now) ?? RaceSchedule[RaceSchedule.length - 1];
}

// GUID: HOT_NEWS_FLOW-006-v01
// [Intent] Fetch current + 3-day weather forecast from Open-Meteo (free, no API key).
//          Returns structured weather data for the race venue.
// [Inbound Trigger] hotNewsFeedFlow() calls this to build the AI prompt context.
// [Downstream Impact] Weather data shapes the AI bulletin. Never throws — returns null on failure.
async function fetchOpenMeteoWeather(lat: number, lon: number): Promise<{
    temp: number;
    humidity: number;
    wind: number;
    rainChance: number;
    weatherDesc: string;
    maxTemp: number;
    weekendRain: number;
} | null> {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code&daily=temperature_2m_max,precipitation_sum&timezone=auto&forecast_days=3`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) return null;
        const data = await resp.json();
        const c = data.current;
        const d = data.daily;
        return {
            temp: Math.round(c.temperature_2m ?? 0),
            humidity: Math.round(c.relative_humidity_2m ?? 0),
            wind: Math.round(c.wind_speed_10m ?? 0),
            rainChance: Math.round(c.precipitation_probability ?? 0),
            weatherDesc: WMO_CODES[c.weather_code as number] ?? 'Unknown',
            maxTemp: Math.round(Math.max(...(d.temperature_2m_max ?? [0]))),
            weekendRain: parseFloat(((d.precipitation_sum ?? [0]) as number[]).reduce((a: number, b: number) => a + b, 0).toFixed(1)),
        };
    } catch {
        return null;
    }
}

// GUID: HOT_NEWS_FLOW-007-v01
// [Intent] Opportunistically fetch live track weather from OpenF1 if a session is active.
//          Returns track_temperature and rainfall if a session started within the last 6 hours.
//          Wraps in try/catch — OpenF1 failure never blocks AI generation.
// [Inbound Trigger] hotNewsFeedFlow() after Open-Meteo fetch.
// [Downstream Impact] Enriches the AI prompt with live track temps when available.
async function fetchOpenF1Weather(): Promise<{ trackTemp: number; rainfall: number } | null> {
    try {
        const resp = await fetch('https://api.openf1.org/v1/weather?session_key=latest', {
            signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) return null;

        // Check if session data is recent (within last 6 hours)
        const latest = data[data.length - 1];
        if (!latest.date) return null;
        const sessionAge = Date.now() - new Date(latest.date).getTime();
        if (sessionAge > 6 * 60 * 60 * 1000) return null;

        return {
            trackTemp: Math.round(latest.track_temperature ?? 0),
            rainfall: latest.rainfall ?? 0,
        };
    } catch {
        return null;
    }
}

// GUID: HOT_NEWS_FLOW-008-v02
// [Intent] Core AI generation flow — fetches weather, builds prompt, calls Gemini 2.0 Flash,
//          writes result to Firestore with refreshCount increment.
//          This is the function called by both the admin "Refresh Now" button and the hourly cron.
// [Inbound Trigger] Admin panel server action or /api/cron/refresh-hot-news POST route.
// [Downstream Impact] Writes app-settings/hot-news content + refreshCount. Read by getHotNewsFeed().
export const hotNewsFeedFlow = ai.defineFlow(
    {
        name: "hotNewsFeedFlow",
        inputSchema: z.void(),
        outputSchema: HotNewsFeedOutputSchema,
    },
    async () => {
        const nextRace = getNextRace();
        const location = nextRace.location;
        const raceName = nextRace.name;
        const sprintNote = nextRace.hasSprint ? 'Sprint weekend' : 'Standard weekend';

        const coords = VENUE_COORDS[location];
        const [openMeteo, openF1] = await Promise.all([
            coords ? fetchOpenMeteoWeather(coords[0], coords[1]) : Promise.resolve(null),
            fetchOpenF1Weather(),
        ]);

        // Build weather section for prompt
        let weatherSection: string;
        if (openMeteo) {
            weatherSection = [
                `- Air: ${openMeteo.temp}°C | Humidity: ${openMeteo.humidity}% | Wind: ${openMeteo.wind} km/h`,
                `- Conditions: ${openMeteo.weatherDesc} | Rain chance: ${openMeteo.rainChance}%`,
                `- Weekend peak temp: ${openMeteo.maxTemp}°C | Total rain forecast: ${openMeteo.weekendRain}mm`,
            ].join('\n');
        } else {
            weatherSection = '- Weather data unavailable';
        }

        if (openF1) {
            weatherSection += `\n- Live track temperature: ${openF1.trackTemp}°C | Rainfall on track: ${openF1.rainfall}mm`;
        }

        const prompt = `You are a race strategist for Prix Six, an F1 prediction league.
Generate a hot news bulletin (3–4 bullet points, max 150 words) for the upcoming ${raceName} at ${location} (${sprintNote}).

WEATHER at the circuit:
${weatherSection}

Write punchy, factual bullets useful for F1 prediction-making.
Cover: weather impact on strategy, tyre choices, team advantages based on conditions.
Plain text only. Use bullet points starting with •. No markdown headers. No preamble.`;

        const response = await ai.generate(prompt);
        const newsFeed = response.text;

        // Write to Firestore — increment refreshCount atomically
        const { db } = await getFirebaseAdmin();
        await db.collection('app-settings').doc('hot-news').set(
            {
                content: newsFeed,
                lastUpdated: Timestamp.now(),
                refreshCount: FieldValue.increment(1),
                hotNewsFeedEnabled: true,
            },
            { merge: true }
        );

        // Read back the current refreshCount for the response
        const snap = await db.collection('app-settings').doc('hot-news').get();
        const refreshCount = snap.data()?.refreshCount ?? 1;

        return {
            newsFeed,
            lastUpdated: new Date().toISOString(),
            refreshCount,
        };
    }
);
