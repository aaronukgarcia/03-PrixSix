
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
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { RaceSchedule } from '@/lib/data';
import type { Race } from '@/lib/data';
import { generateRaceIdLowercase } from '@/lib/normalize-race-id';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';

// GUID: HOT_NEWS_FLOW-001-v03
// [Intent] Output schema for the hot news feed — content string + metadata.
// [Inbound Trigger] ai.defineFlow outputSchema, getHotNewsFeed return type.
// [Downstream Impact] HotNewsFeed.tsx destructures newsFeed, lastUpdated, messageId.
// @BUGFIX (PUBCHAT-05): added messageId so the UI can display the SAME id that is embedded
//   in the stored content (#NNNN). Previously the component rendered refreshCount as the
//   bulletin id — two diverging id sequences for one bulletin.
const HotNewsFeedOutputSchema = z.object({
    newsFeed: z.string().describe('A concise summary of the latest F1 news, including weather, track conditions, and driver updates.'),
    lastUpdated: z.string().optional().describe('ISO timestamp of when the news was last updated.'),
    refreshCount: z.number().optional().describe('How many times the feed has been refreshed.'),
    messageId: z.number().optional().describe('The bulletin id (#NNNN) — matches the id embedded in the content (PUBCHAT-05).'),
    enabled: z.boolean().optional().describe('False when the admin has disabled the feed (PUBCHAT-01) — consumers should hide it.'),
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

// GUID: HOT_NEWS_FLOW-004-v03
// [Intent] Read the current hot news bulletin from Firestore for display on the dashboard.
//          Never triggers an AI call — reads only. AI generation happens via hotNewsFeedFlow.
// [Inbound Trigger] HotNewsFeed.tsx server component on every dashboard load.
// [Downstream Impact] Returns newsFeed content, lastUpdated timestamp, refreshCount and messageId to the UI.
export async function getHotNewsFeed(): Promise<HotNewsFeedOutput> {
    try {
        const { db } = await getFirebaseAdmin();
        const docSnap = await db.collection('app-settings').doc('hot-news').get();

        if (!docSnap.exists) {
            // Genuine "not generated yet" state — the warming-up placeholder is correct here.
            if (process.env.NODE_ENV !== 'production') {
                console.log('Hot news document not found, returning defaults.');
            }
            return { newsFeed: defaultHotNews.content, lastUpdated: undefined, refreshCount: undefined };
        }

        const data = docSnap.data();
        const content = data?.content || defaultHotNews.content;
        const refreshCount = typeof data?.refreshCount === 'number' ? data.refreshCount : undefined;
        // @BUGFIX (PUBCHAT-05): surface the stored messageId — the doc's single id source.
        const messageId = typeof data?.messageId === 'number' ? data.messageId : undefined;

        let lastUpdated: string | undefined;
        if (data?.lastUpdated && typeof data.lastUpdated.toDate === 'function') {
            lastUpdated = data.lastUpdated.toDate().toISOString();
        }

        // @BUGFIX (PUBCHAT-01): expose the admin toggle so the dashboard can actually hide the feed.
        const enabled = data?.hotNewsFeedEnabled !== false;
        return { newsFeed: content, lastUpdated, refreshCount, messageId, enabled };
    } catch (error) {
        // @BUGFIX (PUBCHAT-09): a READ FAILURE previously masqueraded as the "warming up"
        // placeholder — indistinguishable from the legit not-yet-generated state, so outages
        // hid for hours. Now: log a registry-sourced traced error (GR#1/#7) and return a
        // DISTINCT "temporarily unavailable" message carrying code + correlationId.
        const correlationId = generateCorrelationId();
        try {
            const { db } = await getFirebaseAdmin();
            const traced = createTracedError(ERRORS.FIRESTORE_READ_FAILED, {
                correlationId,
                context: { function: 'getHotNewsFeed', doc: 'app-settings/hot-news' },
                cause: error instanceof Error ? error : new Error(String(error)),
            });
            await logTracedError(traced, db);
        } catch {
            // Logging failure must not break the dashboard — the read failure itself may be
            // a total Firestore outage, in which case the log write fails too.
            if (process.env.NODE_ENV !== 'production') {
                console.error('Error fetching hot news (and logging failed):', error);
            }
        }
        return {
            newsFeed: `Hot News is temporarily unavailable — please check back shortly. (${ERRORS.FIRESTORE_READ_FAILED.code} · ${correlationId})`,
            lastUpdated: undefined,
            refreshCount: undefined,
        };
    }
}

// GUID: HOT_NEWS_FLOW-005-v03
// [Intent] Find the active race — the first unscored race — by checking race_results in Firestore.
//          This mirrors the same "activeRace" logic used by the dashboard, ensuring the hot news
//          bulletin targets the current race weekend even when qualifying has already passed
//          (previously returned next race as soon as qualifying started — root cause of JP content
//          appearing during the Chinese GP weekend).
//          Falls back to time-based (raceTime > now) if Firestore is unavailable.
// @BUGFIX (PUBCHAT-07): the unscored-first rule STUCK on a finished race until the admin
//          entered results — bulletins kept previewing a race that had already run (sometimes
//          for days). Now: if the first unscored race finished more than RESULTS_LAG_GRACE_MS
//          ago, fall through to the time-based next race even though results aren't in yet.
// [Inbound Trigger] hotNewsFeedFlow() at generation time.
// [Downstream Impact] Determines which venue's weather is fetched and what race context
//                     the AI prompt uses. Wrong race → irrelevant bulletin.
async function getActiveRace(): Promise<Race> {
    // Grace window after lights-out during which the just-run race is still "active"
    // (post-race analysis window) even without results entered. 4h ≈ race duration + podium.
    const RESULTS_LAG_GRACE_MS = 4 * 60 * 60 * 1000;
    const now = new Date();
    try {
        const { db } = await getFirebaseAdmin();
        const resultsSnap = await db.collection('race_results').get();
        const resultIds = new Set(resultsSnap.docs.map(d => d.id.toLowerCase()));
        const firstUnscored = RaceSchedule.find(
            race => !resultIds.has(generateRaceIdLowercase(race.name, 'gp'))
        );
        if (firstUnscored) {
            const raceOverBy = new Date(firstUnscored.raceTime).getTime() + RESULTS_LAG_GRACE_MS;
            if (raceOverBy > now.getTime()) return firstUnscored;
            // Race finished >4h ago with no results yet — don't stick on it; fall through
            // to the time-based next race below (PUBCHAT-07).
        }
    } catch {
        // Firestore unavailable — fall back to time-based
    }
    return RaceSchedule.find(r => new Date(r.raceTime) > now) ?? RaceSchedule[RaceSchedule.length - 1];
}

// GUID: HOT_NEWS_FLOW-009-v01
// [Intent] Compute a human-readable description of where we are in the race weekend.
//          Used in the AI prompt so the bulletin is relevant to the CURRENT moment —
//          e.g. "Sprint Race in ~18h" rather than a generic pre-qualifying preview.
// [Inbound Trigger] hotNewsFeedFlow() after getActiveRace().
// [Downstream Impact] Injected into the AI prompt as the CURRENT PHASE section.
function getWeekendPhase(race: Race, now: Date): string {
    const qt = new Date(race.qualifyingTime);
    const rt = new Date(race.raceTime);
    const st = race.hasSprint && race.sprintTime ? new Date(race.sprintTime) : null;

    const hoursUntil = (d: Date) => Math.round((d.getTime() - now.getTime()) / 3_600_000);

    if (qt > now) {
        const label = race.hasSprint ? 'Sprint Qualifying' : 'Qualifying';
        return `Pre-${label}. ${label} in ~${hoursUntil(qt)}h. Submit your predictions before then.`;
    } else if (st && st > now) {
        return `Sprint Qualifying complete. Sprint Race in ~${hoursUntil(st)}h. Grand Prix follows ~${hoursUntil(rt)}h after.`;
    } else if (rt > now) {
        const prefix = race.hasSprint ? 'Sprint Race complete. ' : 'Qualifying complete. ';
        return `${prefix}Grand Prix in ~${hoursUntil(rt)}h.`;
    } else {
        return 'Race weekend complete. Awaiting results.';
    }
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

// GUID: HOT_NEWS_FLOW-010-v02
// @CHANGE (v3.7.0): exported so the Billceleration picker flow reuses the same pre-formatted
//   championship block (GR#3 — one Jolpica standings renderer).
// [Intent] Fetch REAL current-season F1 championship data — driver standings (top 6), constructor
//          standings (top 5) and the last race podium — from Jolpica-F1 (api.jolpi.ca, the free,
//          no-key Ergast-compatible successor). This grounds the bulletin in ACTUAL 2026 form
//          instead of the model's stale training knowledge (which e.g. wrongly had Verstappen
//          leading in RB20/MCL38 cars). Returns a pre-formatted prompt block, or null on any failure.
// [Inbound Trigger] hotNewsFeedFlow() builds the prompt's CURRENT CHAMPIONSHIP section from this.
//                   Also called by ai/flows/billceleration-picker.ts (v3.7.0).
// [Downstream Impact] Accurate driver/team storylines; null => prompt falls back to evergreen angles.
export async function fetchF1Standings(): Promise<string | null> {
    try {
        const BASE = 'https://api.jolpi.ca/ergast/f1/current';
        const j = async (path: string) => {
            const r = await fetch(`${BASE}/${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
            if (!r.ok) throw new Error(`jolpica ${path} ${r.status}`);
            return r.json();
        };
        const [ds, cs, lr] = await Promise.all([
            j('driverstandings/?limit=6'),
            j('constructorstandings/?limit=5'),
            j('last/results/?limit=3'),
        ]);
        const dList = ds?.MRData?.StandingsTable?.StandingsLists?.[0];
        const cList = cs?.MRData?.StandingsTable?.StandingsLists?.[0];
        const race = lr?.MRData?.RaceTable?.Races?.[0];
        if (!dList?.DriverStandings?.length || !cList?.ConstructorStandings?.length) return null;

        const drivers = dList.DriverStandings.map((d: any) =>
            `${d.position}. ${(d.Driver.givenName ?? '').charAt(0)} ${d.Driver.familyName} (${d.Constructors?.[0]?.name ?? '?'}) ${d.points}pts${Number(d.wins) > 0 ? `, ${d.wins} win${Number(d.wins) > 1 ? 's' : ''}` : ''}`
        );
        const cons = cList.ConstructorStandings.map((c: any) => `${c.position}. ${c.Constructor.name} ${c.points}pts`);

        let lastLine = '';
        if (race?.Results?.length) {
            const podium = race.Results.map((r: any) => `${r.position}. ${r.Driver.familyName} (${r.Constructor.name})`);
            lastLine = `\nLast race (${race.raceName}): ${podium.join(', ')}`;
        }
        return `CURRENT ${dList.season} CHAMPIONSHIP (after round ${dList.round}):\nDrivers: ${drivers.join('; ')}\nConstructors: ${cons.join('; ')}${lastLine}`;
    } catch {
        return null;
    }
}

// GUID: HOT_NEWS_FLOW-011-v02
// @CHANGE (v3.6.0): exported so LIB_CHEEKY_BILL_CONTEXT can reuse the same sanitised headline
//   feed for the news-correlated roast mode (GR#3 — one RSS parser, one sanitisation point).
//   Export is legal under 'use server' because the function is async.
// [Intent] Fetch current real-world F1 news headlines from Autosport RSS to provide varied up-to-date context.
export async function fetchF1Headlines(): Promise<string[]> {
    try {
        const resp = await fetch('https://www.autosport.com/rss/feed/f1', {
            signal: AbortSignal.timeout(6000)
        });
        if (!resp.ok) return [];
        const xml = await resp.text();
        const items: string[] = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        const titleRegex = /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
            const itemContent = match[1];
            const titleMatch = titleRegex.exec(itemContent);
            if (titleMatch) {
                // @SECURITY_FIX (cyber.md F5): these headlines come from an EXTERNAL feed and are
                // interpolated into a Gemini prompt whose output is auto-broadcast to the WhatsApp group.
                // Sanitise (strip control chars/newlines + cap length) so a compromised/mischievous feed
                // cannot smuggle instructions into the prompt. Uses the shared prompt sanitiser.
                const title = sanitizeForPrompt((titleMatch[1] || titleMatch[2] || "").trim(), 160);
                if (title) items.push(title);
            }
        }
        return items;
    } catch {
        return [];
    }
}

// GUID: HOT_NEWS_FLOW-013-v01
// [Intent] One-line venue weather summary for a race location, for prompts that need weather
//          context without the full bulletin machinery (Billceleration picker, v3.7.0). Wraps
//          the private VENUE_COORDS + fetchOpenMeteoWeather so those stay module-private.
// [Inbound Trigger] ai/flows/billceleration-picker.ts input gathering.
// [Downstream Impact] Returns '' when the venue is unknown or Open-Meteo fails — callers treat
//          weather as optional context (decorative-degrade, same as every fetcher here).
export async function getVenueWeatherLine(location: string): Promise<string> {
    try {
        const coords = VENUE_COORDS[location];
        if (!coords) return '';
        const w = await fetchOpenMeteoWeather(coords[0], coords[1]);
        if (!w) return '';
        return `${location}: ${w.weatherDesc}, ${w.temp}C now (max ${w.maxTemp}C), wind ${w.wind} km/h, rain chance ${w.rainChance}%, weekend rain total ${w.weekendRain}mm.`;
    } catch {
        return '';
    }
}

// GUID: HOT_NEWS_FLOW-012-v02
// [Intent] Fetch the previous 10 daily bulletins from whatsapp_queue to avoid repeating stories/angles.
//          Uses in-memory filtering over recent queue items to remain completely composite-index-free and safe.
// @BUGFIX (PUBCHAT-10): the old cleanup regex required a literal \n\n\n which the daily message
//          only contains when the countdown banner is ABSENT. The real shape (functions/index.js
//          dailyHotNewsWhatsApp) is: header \n\n 🏁-line \n ⏱️-line \n\n content — so the strip
//          silently no-opped and the header+banner were fed to the AI as "previous bulletin"
//          content. Now stripDailyEnvelope matches the actual shape line-by-line.
// [Inbound Trigger] hotNewsFeedFlow() input gathering (Promise.all).
// [Downstream Impact] Cleaned bulletin bodies feed the anti-repetition prompt section.
function stripDailyEnvelope(msg: string): string {
    // 1. Drop the header line ("🏎️ *Prix Six Hot News*") plus its trailing newline(s).
    let s = msg.replace(/^🏎️ \*Prix Six Hot News\*\s*\n+/, '');
    // 2. Drop the optional 2-line countdown banner ("🏁 *Next:* ..." + "⏱️ ...") plus blank line.
    s = s.replace(/^🏁 \*Next:\*[^\n]*\n⏱️[^\n]*\n+/, '');
    // 3. Drop the trailing "#NNNN" messageId line — it's an id, not bulletin content.
    s = s.replace(/\n#\d{4,}\s*$/, '');
    return s.trim();
}

async function fetchPreviousBulletins(): Promise<string[]> {
    try {
        const { db } = await getFirebaseAdmin();
        const snap = await db.collection('whatsapp_queue')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        return snap.docs
            .map(doc => doc.data())
            .filter(data => data.source === 'hot-news-daily-7am')
            .slice(0, 10)
            .map(data => stripDailyEnvelope(data.message || ""))
            .filter(Boolean);
    } catch {
        return [];
    }
}

// GUID: HOT_NEWS_FLOW-008-v06
// [Intent] Core AI generation flow — fetches weather, builds prompt, calls Gemini 2.0 Flash,
//          writes result to Firestore with refreshCount increment and messageId suffix in text.
//          v04: prompt reframed to lead on DRIVER/TEAM storylines for the forthcoming race
//          (form, rivalries, championship stakes, circuit fit) with weather demoted to ≤1 bullet.
//          v05: inject REAL current-season standings/results (fetchF1Standings → Jolpica) as ground
//          truth so championship claims are accurate, not the model's stale training memory.
//          WhatsApp formatting — instruct single-asterisk bold (WhatsApp markup), never ** /
//          markdown headers, since the bulletin is broadcast to the WhatsApp group (** rendered literally).
//          v06: PUBCHAT-10 (dedupe against the currently stored bulletin, not only daily WhatsApp
//          posts) + PUBCHAT-11 (messageId assigned inside a Firestore transaction — no more
//          read-then-write race between concurrent cron/admin refreshes).
//          This is the function called by both the admin "Refresh Now" button and the hourly cron.
// [Inbound Trigger] Admin panel server action or /api/cron/refresh-hot-news POST route.
// [Downstream Impact] Writes app-settings/hot-news content (with #NNNN suffix) + refreshCount + messageId.
//                     Read by getHotNewsFeed(). messageId starts at 18 and increments on every generation.
export const hotNewsFeedFlow = ai.defineFlow(
    {
        name: "hotNewsFeedFlow",
        inputSchema: z.void(),
        outputSchema: HotNewsFeedOutputSchema,
    },
    async () => {
        const now = new Date();

        // @BUGFIX (PUBCHAT-01, 2026-07-26): honor the admin toggle. Previously this flow never
        // checked hotNewsFeedEnabled and force-wrote it back to true on every run, so the admin
        // OFF switch was silently undone within the hour. Disabled → return the existing bulletin
        // untouched (no Gemini call, no counter bump, flag left alone). Read moved BEFORE the
        // external fetches (v06) so a disabled feed also skips the weather/standings/RSS calls.
        const { db } = await getFirebaseAdmin();
        const hotNewsRef = db.collection('app-settings').doc('hot-news');
        const currentDoc = await hotNewsRef.get();
        if (currentDoc.exists && currentDoc.data()?.hotNewsFeedEnabled === false) {
            const d = currentDoc.data()!;
            return {
                newsFeed: d.content ?? '',
                lastUpdated: d.lastUpdated?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
                refreshCount: typeof d.refreshCount === 'number' ? d.refreshCount : 0,
                messageId: typeof d.messageId === 'number' ? d.messageId : undefined,
                enabled: false,
            };
        }

        const activeRace = await getActiveRace();
        const location = activeRace.location;
        const raceName = activeRace.name;
        const sprintNote = activeRace.hasSprint ? 'Sprint weekend' : 'Standard weekend';
        const phase = getWeekendPhase(activeRace, now);

        const coords = VENUE_COORDS[location];
        const [openMeteo, openF1, f1Data, headlines, prevBulletins] = await Promise.all([
            coords ? fetchOpenMeteoWeather(coords[0], coords[1]) : Promise.resolve(null),
            fetchOpenF1Weather(),
            fetchF1Standings(),
            fetchF1Headlines(),
            fetchPreviousBulletins(),
        ]);

        // @BUGFIX (PUBCHAT-10): dedupe against the CURRENT app-settings/hot-news bulletin too,
        // not only the daily WhatsApp posts — hourly refreshes only ever hit WhatsApp once a day,
        // so back-to-back hourly bulletins could repeat each other verbatim. stripDailyEnvelope
        // removes the trailing "#NNNN" id line (header/banner steps no-op on stored content).
        const currentContent = stripDailyEnvelope(currentDoc.data()?.content ?? '');
        if (currentContent && !prevBulletins.includes(currentContent)) {
            prevBulletins.unshift(currentContent);
        }

        // Real championship data (ground truth) or a fallback instruction if the feed is down.
        const f1Section = f1Data
            ? f1Data
            : 'CURRENT CHAMPIONSHIP: live data unavailable — do NOT state specific championship positions or points; keep to evergreen driver/team storylines and circuit fit.';

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

        let prompt = `You are an F1 correspondent for Prix Six, an F1 prediction league.
Write a hot news bulletin (3–4 bullet points, max 150 words) previewing the ${raceName} at ${location} (${sprintNote}),
focused on DRIVER and TEAM storylines that help players make their Six predictions.

CURRENT PHASE: ${phase}

${f1Section}`;

        if (headlines.length > 0) {
            prompt += `\n\nLATEST F1 NEWS HEADLINES (use these as source material for fresh, up-to-date driver/team storylines):\n${headlines.map(h => `- ${h}`).join('\n')}`;
        }

        if (prevBulletins.length > 0) {
            prompt += `\n\nPRIOR DAILY BULLETINS (CRITICAL: do NOT repeat or overlap with these storylines, topics, angles, or specific phrases. We need totally fresh variety!):\n${prevBulletins.map((b, idx) => `[Bulletin ${idx+1}]\n${b}`).join('\n\n')}`;
        }

        prompt += `\n\nLead with the people and the teams — NOT the weather. Cover angles such as:
- Who is in form and the championship picture — use the CURRENT CHAMPIONSHIP data above as the SOURCE OF TRUTH for names, positions, points and the last winner
- Momentum, news, and rivalries going into this round — ground your bulletin in the LATEST F1 NEWS HEADLINES if available
- Driver/team factors specific to this circuit (a team's car characteristics suiting ${location}, a driver's history at this track)
- At most ONE bullet on weather/track conditions, and only if it materially affects driver/team prospects

WEATHER (reference sparingly, at most one bullet):
${weatherSection}

Base ALL championship claims strictly on the CURRENT CHAMPIONSHIP data above — do NOT contradict it or fall back on prior-season memory (do not name specific car models or assume who leads).
Do NOT invent penalties, quotes, or lineup changes.

FORMATTING — this is sent to WhatsApp, so use WhatsApp markup ONLY:
- Each bullet starts with "• ".
- For a short bold lead-in, wrap it in a SINGLE asterisk: • *Antonelli's charge:* leads by 41 points...
- NEVER use double asterisks (**), markdown headers (#), or underscores. Double asterisks render as literal "**" in WhatsApp.
- No preamble, no closing line — just the bullets.`;

        // @BUGFIX (PUBCHAT-03, 2026-07-26): generation failures and empty responses previously
        // flowed straight into the Firestore write — an empty Gemini response (known 2.5-flash
        // failure mode, cf. PX-3101) produced a header-only bulletin that the 7am publisher then
        // broadcast to the league WhatsApp group. Now: throw on failure/empty so NOTHING is
        // written (no counter bump, no publish) and the previous good bulletin survives.
        let newsFeed: string;
        try {
            const response = await ai.generate(prompt);
            newsFeed = (response.text ?? '').trim();
        } catch (err: any) {
            throw new Error(`Hot-news generation failed — keeping previous bulletin: ${err?.message ?? err}`);
        }
        if (!newsFeed) {
            throw new Error('Hot-news generation returned EMPTY text — keeping previous bulletin (no write, no publish)');
        }

        // @BUGFIX (PUBCHAT-11): messageId was previously READ from a doc snapshot taken before
        // generation and WRITTEN after — two concurrent refreshes (hourly cron + admin "Refresh
        // Now") could both read #0021 and both write #0022, duplicating an id. The read/compute/
        // write now runs inside a Firestore transaction, so contention retries and every
        // generation gets a unique, monotonic messageId. refreshCount is computed in the same
        // transaction (replacing FieldValue.increment) so both counters advance atomically together.
        // messageId starts at 17 (so first increment produces #0018 per user requirement).
        const { nextMessageId, newRefreshCount } = await db.runTransaction(async (tx) => {
            const snap = await tx.get(hotNewsRef);
            const d = snap.exists ? snap.data()! : {};
            const nextMessageId = Math.max(
                (typeof d.messageId === 'number' ? d.messageId : 17) + 1,
                18
            );
            const newRefreshCount = (typeof d.refreshCount === 'number' ? d.refreshCount : 0) + 1;
            tx.set(
                hotNewsRef,
                {
                    // Append message ID suffix to the generated text (PUBCHAT-05: this is THE id).
                    content: newsFeed + `\n#${String(nextMessageId).padStart(4, '0')}`,
                    lastUpdated: Timestamp.now(),
                    refreshCount: newRefreshCount,
                    // PUBCHAT-01: hotNewsFeedEnabled is ADMIN-owned — never overwritten here.
                    messageId: nextMessageId,
                },
                { merge: true }
            );
            return { nextMessageId, newRefreshCount };
        });

        const newsFeedWithId = newsFeed + `\n#${String(nextMessageId).padStart(4, '0')}`;

        return {
            newsFeed: newsFeedWithId,
            lastUpdated: new Date().toISOString(),
            refreshCount: newRefreshCount,
            messageId: nextMessageId,
        };
    }
);
