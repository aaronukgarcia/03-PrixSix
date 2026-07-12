// GUID: API_AI_ANALYSIS-000-v05
// [Intent] AI-powered race prediction analysis API route. Accepts a user's top-6 driver prediction and analysis weight configuration, builds a dynamic weighted prompt grounded in the REAL 2026 grid (GUID -013) and REAL recent race results (GUID -014), calls Genkit/Gemini AI, and returns structured analysis text covering multiple F1 analysis facets and optional pundit personas.
// [Inbound Trigger] POST request from the predictions analysis UI when a user requests AI analysis of their race prediction.
// [Downstream Impact] Reads race_results + race_schedule (for the recent-form grounding block) and calls Google AI (Gemini) via Genkit. Returns analysis text to the client. Logs errors to error_logs. AI costs are incurred per request. Nothing is persisted beyond error logs + the rate-limit counter. Per-user rate limit enforced via Firestore (20 req/hour). User-controlled fields are sanitized before prompt interpolation.

// AI-powered race prediction analysis with weighted facets
// Uses Genkit with Google AI (Gemini)

import { NextRequest, NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { F1Drivers, getDriverName } from '@/lib/data';
import { getRaceSchedule } from '@/lib/race-schedule-server';
import { generateRaceId, normalizeRaceIdForComparison } from '@/lib/normalize-race-id';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
// GUID: API_AI_ANALYSIS-011-v02: prompt sanitiser moved to shared lib (Golden Rule #3) — shared with
// ai/flows/hot-news-feed so external text (RSS headlines, Jolpica strings) is sanitised identically.
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_AI_ANALYSIS-001-v03
// [Intent] TypeScript interface for a single driver in the user's prediction — position, driver code, full name, and constructor team.
// [Inbound Trigger] Referenced by AnalysisRequest interface and the prediction list builder.
// [Downstream Impact] Defines the structure of each prediction entry. Changes require updating the client-side prediction submission.
interface PredictionDriver {
  position: number;
  driverCode: string;
  driverName: string;
  team: string;
}

// GUID: API_AI_ANALYSIS-002-v03
// [Intent] TypeScript interface for analysis weight sliders — each facet (0-10) controls how much emphasis the AI gives to that analysis dimension. Includes two pundit personas (jackSparrow, rowanHornblower) with extended word budgets.
// [Inbound Trigger] Referenced by AnalysisRequest and the prompt builder functions.
// [Downstream Impact] Adding new facets requires updating this interface, the prompt builder, facetDescriptions, and the client-side weight controls.
interface AnalysisWeights {
  driverForm: number;
  trackHistory: number;
  overtakingCrashes: number;
  circuitCharacteristics: number;
  trackSurface: number;
  layoutChanges: number;
  weather: number;
  tyreStrategy: number;
  bettingOdds: number;
  jackSparrow: number; // Jack Whitehall style pundit - up to 250 words
  rowanHornblower: number; // Bernie Collins style pundit - up to 250 words
}

// GUID: API_AI_ANALYSIS-003-v03
// [Intent] TypeScript interface for the full analysis request payload — race metadata, driver predictions, weight configuration, and pre-calculated total weight.
// [Inbound Trigger] Referenced when typing the parsed POST request body.
// [Downstream Impact] Defines the contract between the client-side analysis form and this API endpoint.
interface AnalysisRequest {
  raceId: string;
  raceName: string;
  circuit: string;
  predictions: PredictionDriver[];
  weights: AnalysisWeights;
  totalWeight: number;
}

// GUID: API_AI_ANALYSIS-004-v03
// [Intent] Constants defining word budgets per facet type — standard facets get 50 words each, pundit personas get up to 250 words scaled by weight.
// [Inbound Trigger] Referenced by calculateWordBudgets function.
// [Downstream Impact] Controls AI output length. Changing these values affects token consumption and response size.
const WORDS_PER_FACET = 50;
const WORDS_PER_PUNDIT = 250;

const PUNDIT_FACETS = ['jackSparrow', 'rowanHornblower'];

// GUID: API_AI_ANALYSIS-011-v02
// sanitizeForPrompt is now imported from '@/lib/sanitize-prompt' (see imports above). The local copy
// was removed to keep a single source of truth shared with the hot-news flow (Golden Rule #3).

// GUID: API_AI_ANALYSIS-005-v03
// [Intent] Calculate per-facet word budgets based on weights. Standard facets get a fixed 50 words if active; pundit facets scale linearly from 0-250 words based on weight (0-10).
// [Inbound Trigger] Called by buildWeightedPrompt to determine how many words to allocate to each section.
// [Downstream Impact] The budgets are embedded in the AI prompt to guide output length per section.
const calculateWordBudgets = (weights: AnalysisWeights): Record<string, number> => {
  const budgets: Record<string, number> = {};

  Object.entries(weights).forEach(([key, weight]) => {
    if (weight === 0) {
      budgets[key] = 0;
    } else if (PUNDIT_FACETS.includes(key)) {
      // Pundit facets get up to 250 words, scaled by weight (0-10)
      budgets[key] = Math.round((weight / 10) * WORDS_PER_PUNDIT);
    } else {
      // Standard facets get exactly 50 words if active
      budgets[key] = WORDS_PER_FACET;
    }
  });

  return budgets;
};

// GUID: API_AI_ANALYSIS-013-v01
// [Intent] Build an authoritative "ground truth" block describing the ACTUAL current F1 grid,
//   sourced from lib/data.ts (F1Drivers — the single source of truth for the 2026 season). This is
//   prepended to the AI prompt so the model treats the real driver→team line-up as fact rather than
//   falling back on its stale training-cutoff knowledge of the grid.
// [Inbound Trigger] Called by buildWeightedPrompt() on every request.
// [Downstream Impact] Without this block the model mis-reads correct current-season picks (e.g.
//   "Hamilton (Ferrari)", "Antonelli (Mercedes)") as user fantasy and mocks them — because its
//   training prior places Hamilton at Mercedes and treats Antonelli as an unproven rookie. Deriving
//   the roster from F1Drivers (Golden Rule #15 — no hardcoded roster) keeps this correct as the grid
//   changes. NOTE: this block grounds the LINE-UP; recent driver FORM is grounded separately by
//   buildRecentFormBlock (GUID -014, item 3 — now implemented). Prior-year circuit history and live
//   betting odds are still not in the app's data, so those specific facets stay qualitative.
const buildGridGroundTruth = (): string => {
  // Group drivers by team, preserving the data.ts ordering.
  const byTeam = new Map<string, string[]>();
  for (const d of F1Drivers) {
    if (!byTeam.has(d.team)) byTeam.set(d.team, []);
    byTeam.get(d.team)!.push(d.name);
  }
  const roster = Array.from(byTeam.entries())
    .map(([team, drivers]) => `- ${team}: ${drivers.join(', ')}`)
    .join('\n');

  return `AUTHORITATIVE GROUND TRUTH — THE ACTUAL CURRENT F1 GRID (2026 season):
${roster}

CRITICAL: The line-up above is the REAL, current 2026 grid and is authoritative. Your own
training knowledge of driver-team pairings is OUT OF DATE — defer to the list above without
exception. In particular: Lewis Hamilton drives for Ferrari (not Mercedes); Kimi Antonelli is
George Russell's full Mercedes team-mate (a legitimate line-up, not a fantasy); several teams are
new or renamed for 2026 (Audi, Cadillac, Racing Bulls). The user's team assignments in their
prediction are CORRECT. Do NOT question, "correct", or mock a pick merely because it conflicts with
an older grid you remember — treat every driver→team pairing shown as established fact.
`;
};

// GUID: API_AI_ANALYSIS-014-v01
// [Intent] Build an authoritative "recent form" block from the app's OWN race_results (the SSOT of
//   actual F1 classifications) — the top-6 finishers of the most recent completed GP races this 2026
//   season. Injected into the prompt so the model grounds "driver form / recent performance"
//   commentary in real results instead of hallucinating finishing positions from stale training data
//   (item 3 follow-up to the grid grounding, GUID -013).
// [Inbound Trigger] Called once per request by the POST handler (async — reads Firestore + schedule).
// [Downstream Impact] Returns a prompt fragment (or '' if no completed races / on any error — the
//   caller proceeds without it so analysis never breaks). Honest scope: the app stores only the 2026
//   top-6 finish order, NOT prior-year circuit history or live betting odds — the block explicitly
//   tells the model NOT to fabricate those. Ordering uses race_schedule (round order) + raceTime.
async function buildRecentFormBlock(db: FirebaseFirestore.Firestore, maxRaces = 4): Promise<string> {
  try {
    const [resultsSnap, schedule] = await Promise.all([
      db.collection('race_results').get(),
      getRaceSchedule(),
    ]);

    // normalised GP race id -> top-6 finisher names (skip sprint result docs for a clean form picture)
    const resultsByNorm = new Map<string, string[]>();
    resultsSnap.forEach((doc) => {
      const d = doc.data();
      if (!d) return;
      const norm = normalizeRaceIdForComparison(doc.id);
      if (norm.endsWith('-sprint')) return;
      const names = [d.driver1, d.driver2, d.driver3, d.driver4, d.driver5, d.driver6]
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        .map((id: string) => getDriverName(id) || id);
      if (names.length > 0) resultsByNorm.set(norm, names);
    });

    const now = Date.now();
    const completed = schedule
      .filter((r) => r.raceTime && new Date(r.raceTime).getTime() <= now)
      .map((r) => ({ name: r.name, norm: normalizeRaceIdForComparison(generateRaceId(r.name)) }))
      .filter((r) => resultsByNorm.has(r.norm));

    const recent = completed.slice(-maxRaces);
    if (recent.length === 0) return '';

    const lines = recent
      .map((r) => {
        const finishers = resultsByNorm.get(r.norm)!;
        const order = finishers.map((name, i) => `${i + 1}.${name}`).join('  ');
        return `- ${r.name}: ${order}`;
      })
      .join('\n');

    return `RECENT FORM — actual top-6 finishers in the most recent completed races (2026 season, from
the app's own race_results — authoritative, most recent last):
${lines}

Base ALL "driver form / recent performance" commentary on THESE results, not on remembered form.
IMPORTANT: this data covers only the 2026 top-6 finish order. The app does NOT hold prior-year
circuit history, qualifying/lap times, or live betting odds — for the Track Changes, Historical
Results, Betting Odds and similar facets, reason qualitatively from the grid and the form above and
do NOT invent specific historical stats, lap times, win rates, or bookmaker prices.
`;
  } catch {
    return '';
  }
}

// GUID: API_AI_ANALYSIS-006-v06
// @FIX (grid-grounding): Prepend buildGridGroundTruth() so the model stops mocking correct 2026 picks
//   (e.g. Hamilton→Ferrari) as user fantasy based on stale training data. See GUID -013 for detail.
// @FEATURE (recent-form, item 3): also inject recentFormBlock (GUID -014) — the real top-6 finishers
//   of recent races — so "driver form" commentary is grounded in actual results, not hallucinated.
// [Intent] Build the complete AI prompt dynamically based on race details, user predictions, and weight configuration. Includes an authoritative current-grid ground-truth block, a real recent-form block, facet descriptions with emphasis levels, word budgets, exclusion notes, and formatting rules (British English, headings, verdict). All user-controlled fields (raceName, circuit) are sanitized via sanitizeForPrompt() before interpolation.
// [Inbound Trigger] Called by the POST handler after validating the request.
// [Downstream Impact] The returned prompt string is sent directly to Genkit ai.generate(). Prompt quality directly affects analysis quality. Facet descriptions define the AI's knowledge of each analysis dimension.
const buildWeightedPrompt = (
  raceName: string,
  circuit: string,
  predictionList: string,
  weights: AnalysisWeights,
  totalWeight: number,
  recentFormBlock: string = ''
): string => {
  // Sanitize user-controlled fields before prompt interpolation (Item sr0StCf3qIA14HAW1iSB)
  const safeRaceName = sanitizeForPrompt(raceName, 100);
  const safeCircuit = sanitizeForPrompt(circuit, 100);

  const budgets = calculateWordBudgets(weights);
  const activeFacetCount = Object.values(weights).filter(w => w > 0).length;
  const totalWordBudget = Object.values(budgets).reduce((sum, words) => sum + words, 0);

  // Filter to only include facets with weight > 0, sorted by weight descending
  const activeFacets = Object.entries(weights)
    .filter(([_, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  const facetDescriptions: Record<string, string> = {
    driverForm: `**Driver Form**: Recent performance over the last 3-4 races. Who's on an upward trajectory? Who's struggling?`,
    trackHistory: `**Track Changes**: How the circuit has evolved - resurfacing, layout modifications, kerb changes, DRS zones. How these changes since last year affect the predicted drivers.`,
    overtakingCrashes: `**Overtakes & Incidents**: Historical overtaking moves and crashes at this circuit. Which predicted drivers have made bold moves here? Who has DNF'd?`,
    circuitCharacteristics: `**Circuit Layout**: Key features of ${safeCircuit} - high-speed sections, technical corners, straights, elevation changes, overtaking opportunities.`,
    trackSurface: `**Track Surface**: Grip levels, any recent resurfacing, bumpy sections, how the surface affects tyre wear and the predicted order.`,
    layoutChanges: `**Historical Results**: How have the predicted drivers performed at ${safeCircuit} in previous years? Win rates, podiums, average finishing positions.`,
    weather: `**Weather**: Expected temperature, humidity, wind, rain probability and how conditions might affect the predicted order.`,
    tyreStrategy: `**Tyre Strategy**: Compound choices (hard/medium/soft), expected degradation, optimal pit windows, how strategy might shuffle positions.`,
    bettingOdds: `**Betting Odds**: Current bookmaker predictions for race winner and podium. How does the user's prediction align with the money?`,
    jackSparrow: `**Jack Sparrow** (${budgets.jackSparrow} words): Write in the style of Jack Whitehall - cheeky British wit, playful teasing, warm ribbing about bold picks, self-deprecating humour. React to the user's prediction with theatrical mock outrage or exaggerated enthusiasm. Use punchy one-liners and comedic observations about specific driver choices.`,
    rowanHornblower: `**Rowan Hornblower** (${budgets.rowanHornblower} words): Write in the style of Bernie Collins - measured F1 strategist, understated scepticism, professionally doubtful but fair. Offer data-driven tactical observations with dry wit. Question bold picks with statistical context. Provide genuine strategic insight wrapped in gentle sarcasm.`,
  };

  const facetInstructions = activeFacets
    .map(([key, weight]) => {
      const emphasis = weight >= 8 ? '(HIGH PRIORITY - elaborate here)' :
                       weight >= 5 ? '(moderate detail)' :
                       '(brief mention)';
      return `${facetDescriptions[key]} ${emphasis}`;
    })
    .join('\n\n');

  const excludedFacets = Object.entries(weights)
    .filter(([_, weight]) => weight === 0)
    .map(([key]) => key);

  const exclusionNote = excludedFacets.length > 0
    ? `\n\nDO NOT include any analysis on: ${excludedFacets.join(', ')} - the user has set these to zero weight.`
    : '';

  // Build word count instructions
  const standardFacetCount = activeFacets.filter(([key]) => !PUNDIT_FACETS.includes(key)).length;
  const activePundits = activeFacets.filter(([key]) => PUNDIT_FACETS.includes(key));

  return `You are an expert Formula 1 analyst providing race prediction analysis for Prix Six, a fantasy F1 league.

${buildGridGroundTruth()}
${recentFormBlock}
The user has submitted their top 6 prediction for the ${safeRaceName} at ${safeCircuit}.

Their prediction:
${predictionList}

Provide analysis covering ALL active facets below:

${facetInstructions}
${exclusionNote}

IMPORTANT RULES:
1. Total response should be approximately ${totalWordBudget} words
2. Standard analysis facets get exactly ${WORDS_PER_FACET} words each (${standardFacetCount} active = ${standardFacetCount * WORDS_PER_FACET} words)
3. Pundit sections get their specified word counts (shown in parentheses above)
4. Use a clear heading for each facet section
5. Skip any facet with 0 weight entirely
6. Use British English spelling
7. Be direct and insightful - pack value into every word
8. Reference specific data points where possible (lap times, previous results, odds)
9. End with a 20-word verdict on the prediction's overall strength
10. Base ALL commentary — pundits included — on the authoritative 2026 grid above. Tease bold POSITION calls if you like, but NEVER mock a driver→team pairing from the user's prediction (e.g. Hamilton at Ferrari) as unrealistic — those pairings are correct current fact.

Begin your analysis:`;
};

// GUID: API_AI_ANALYSIS-012-v02
// [Intent] Enforce per-user AI analysis rate limit using a Firestore sliding-window counter. Reads the users/{userId}/aiRateLimit sub-document, resets the window if the 1-hour period has elapsed, and atomically increments the counter. Returns true if the request is allowed, false if the limit (20 requests/hour) has been exceeded.
// [Inbound Trigger] Called by the POST handler immediately after successful auth verification, before any AI processing.
// [Downstream Impact] Prevents financial DoS via runaway AI API costs. Writes to users/{userId}/aiRateLimit in Firestore on every allowed request. Uses a Firestore transaction to guarantee atomic read-modify-write. On rate-limit breach, the caller returns HTTP 429 with ERRORS.AI_RATE_LIMITED.
// @FIX (RT4-C3): Now uses ERRORS.AI_RATE_LIMITED (PX-3102) instead of ERRORS.EMAIL_RATE_LIMITED (semantically correct).
async function checkAiRateLimit(userId: string): Promise<{ allowed: boolean; count: number; resetAt: Date }> {
  const AI_RATE_LIMIT_MAX = 20;
  const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  const { db, FieldValue, Timestamp } = await getFirebaseAdmin();
  const rateLimitRef = db.collection('users').doc(userId).collection('aiRateLimit').doc('current');

  const result = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(rateLimitRef);
    const now = Date.now();

    if (!doc.exists) {
      // First request — create the window
      const resetAt = new Date(now + AI_RATE_LIMIT_WINDOW_MS);
      transaction.set(rateLimitRef, {
        count: 1,
        windowStart: Timestamp.fromMillis(now),
        resetAt: Timestamp.fromDate(resetAt),
      });
      return { allowed: true, count: 1, resetAt };
    }

    const docData = doc.data()!;
    const windowStart: number = docData.windowStart?.toMillis?.() ?? 0;
    const currentCount: number = docData.count ?? 0;

    if (now - windowStart >= AI_RATE_LIMIT_WINDOW_MS) {
      // Window has expired — reset
      const resetAt = new Date(now + AI_RATE_LIMIT_WINDOW_MS);
      transaction.set(rateLimitRef, {
        count: 1,
        windowStart: Timestamp.fromMillis(now),
        resetAt: Timestamp.fromDate(resetAt),
      });
      return { allowed: true, count: 1, resetAt };
    }

    if (currentCount >= AI_RATE_LIMIT_MAX) {
      // Within window and limit exceeded
      const resetAt: Date = docData.resetAt?.toDate?.() ?? new Date(windowStart + AI_RATE_LIMIT_WINDOW_MS);
      return { allowed: false, count: currentCount, resetAt };
    }

    // Within window and under limit — increment
    const newCount = currentCount + 1;
    const resetAt: Date = docData.resetAt?.toDate?.() ?? new Date(windowStart + AI_RATE_LIMIT_WINDOW_MS);
    transaction.update(rateLimitRef, { count: FieldValue.increment(1) });
    return { allowed: true, count: newCount, resetAt };
  });

  return result;
}

// GUID: API_AI_ANALYSIS-007-v06
// [Intent] POST handler that verifies auth, enforces per-user AI rate limit (20 req/hour via Firestore), validates weights, sanitizes user-controlled fields, builds the prediction list and weighted prompt, calls Genkit AI (Gemini), and returns the analysis text. Includes dedicated error handling for AI generation failures separate from general errors.
// [Inbound Trigger] POST /api/ai/analysis with JSON body matching AnalysisRequest interface.
// [Downstream Impact] Calls Google AI via Genkit (incurs API costs). Returns analysis text to client. Logs AI-specific and general errors to error_logs with AI_GENERATION_FAILED error code. Console-logs audit info for each successful analysis. Rate limit violations return 429 with AI_RATE_LIMITED error code (PX-3102).
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 }
      );
    }
    // Note: Firebase App Hosting uses Application Default Credentials (ADC) automatically.
    // genkit.ts has a fallback projectId, so we don't need to check env vars here.
    // If credentials are missing, Vertex AI will return a meaningful error.

    // GUID: API_AI_ANALYSIS-012-v01 (rate limit check — see function definition above)
    // Per-user rate limit: 20 AI analysis requests per hour. Must occur after auth so we have verifiedUser.uid.
    let rateLimitResult: { allowed: boolean; count: number; resetAt: Date };
    try {
      rateLimitResult = await checkAiRateLimit(verifiedUser.uid);
    } catch (rateLimitErr: any) {
      // Log but do not block the request if the rate-limit check itself fails —
      // fail open to avoid breaking legitimate users due to Firestore issues.
      // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[Rate Limit Check Error ${correlationId}]`, rateLimitErr?.message);
      }
      rateLimitResult = { allowed: true, count: 0, resetAt: new Date() };
    }

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AI_RATE_LIMITED.message,
          errorCode: ERRORS.AI_RATE_LIMITED.code,
          correlationId,
          retryAfter: rateLimitResult.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)) },
        }
      );
    }

    const body: AnalysisRequest = await request.json();
    const { raceName, circuit, predictions, weights, totalWeight } = body;

    // GUID: API_AI_ANALYSIS-008-v03
    // [Intent] Validate that the total weight across all facets does not exceed the maximum of 77. Prevents abuse and ensures balanced analysis.
    // [Inbound Trigger] Every valid POST request.
    // [Downstream Impact] Returns 400 with VALIDATION_INVALID_FORMAT if exceeded. The maximum of 77 is a business rule (9 standard facets x 7 average + 2 pundits x 7 average).
    const calculatedTotal = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (calculatedTotal > 77) {
      return NextResponse.json(
        {
          success: false,
          error: 'Weight total exceeds maximum of 77',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Build prediction list — sanitize driverName and team for each entry (Item sr0StCf3qIA14HAW1iSB)
    const predictionList = predictions
      .map(p => `P${p.position}: ${sanitizeForPrompt(p.driverName, 50)} (${sanitizeForPrompt(p.team, 50)})`)
      .join('\n');

    // Fetch the real recent-form block (item 3). Never throws (returns '' on error), so a Firestore/
    // schedule hiccup degrades gracefully to grid-grounding-only rather than failing the analysis.
    let recentFormBlock = '';
    try {
      const { db } = await getFirebaseAdmin();
      recentFormBlock = await buildRecentFormBlock(db);
    } catch (formErr: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[Recent Form Fetch Error ${correlationId}]`, formErr?.message);
      }
    }

    // Build weighted prompt — raceName and circuit are sanitized inside buildWeightedPrompt
    const prompt = buildWeightedPrompt(
      raceName,
      circuit,
      predictionList,
      weights,
      totalWeight || calculatedTotal,
      recentFormBlock
    );

    // GUID: API_AI_ANALYSIS-009-v05
    // [Intent] Call Genkit AI (Gemini) with the weighted prompt and configured generation parameters. Dedicated try/catch provides specific AI error handling with detailed logging.
    // [Inbound Trigger] Prompt built successfully from validated inputs.
    // [Downstream Impact] Returns AI-generated analysis text on success. On failure, logs detailed AI error info (name, code, status, truncated stack) to error_logs and returns a fallback message. Token limit of 1500 controls cost and response length.
    let analysisText: string;
    try {
      const result = await ai.generate({
        prompt,
        config: {
          maxOutputTokens: 2048, // ~1000-1200 words: 9 facets x 50 + 2 pundits x 250 + verdict
          temperature: 0.7,
          // @FIX (PX-3101): gemini-2.5-flash is a thinking model — with thinking enabled it spent
          //   ~1410 of 1500 output tokens on hidden reasoning, truncating the visible analysis to a
          //   couple of sentences (finishReason MAX_TOKENS). This is punditry, not a reasoning task,
          //   so disable thinking to give the whole budget to the answer. Verified 2026-06-11.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      analysisText = result.text;
    } catch (aiError: any) {
      // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[AI Generation Error ${correlationId}]`, JSON.stringify({
          message: aiError?.message,
          name: aiError?.name,
          code: aiError?.code,
          status: aiError?.status,
          stack: aiError?.stack?.substring(0, 500),
        }));
      }

      // Log specific AI error (wrapped in try-catch to prevent silent failures)
      try {
        const { db } = await getFirebaseAdmin();
        const traced = createTracedError(ERRORS.AI_GENERATION_FAILED, {
          correlationId,
          context: { route: '/api/ai/analysis', action: 'ai.generate', aiErrorCode: aiError?.code, aiErrorStatus: aiError?.status, raceName: sanitizeForPrompt(raceName, 100), promptLength: prompt?.length },
          cause: aiError instanceof Error ? aiError : undefined,
        });
        await logTracedError(traced, db);
      } catch (logErr) {
        // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV
        if (process.env.NODE_ENV !== 'production') {
          console.error(`[Failed to log AI error ${correlationId}]`, logErr);
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AI_GENERATION_FAILED.message,
          errorCode: ERRORS.AI_GENERATION_FAILED.code,
          correlationId,
          analysis: 'Unable to generate analysis at this time. Please try again later.',
        },
        { status: 500 }
      );
    }

    // Log for audit
    console.log(`[AI Analysis] Race: ${sanitizeForPrompt(raceName, 100)}, Weights: ${JSON.stringify(weights)}, Total: ${totalWeight}`);

    return NextResponse.json({
      success: true,
      analysis: analysisText,
      race: raceName,
      weightsApplied: weights,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    // GUID: API_AI_ANALYSIS-010-v04
    // [Intent] Top-level error handler — catches any unhandled exceptions outside of the AI call (e.g., JSON parse, validation). Logs to error_logs and returns a safe 500 response with a fallback analysis message.
    // [Inbound Trigger] Any uncaught exception within the POST handler (excluding AI errors caught by SEQ 009).
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId and fallback analysis text to client. Golden Rule #1 compliance.
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.AI_GENERATION_FAILED, {
      correlationId,
      context: { route: '/api/ai/analysis', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
        analysis: 'Unable to generate analysis at this time. Please try again later.',
      },
      { status: 500 }
    );
  }
}
