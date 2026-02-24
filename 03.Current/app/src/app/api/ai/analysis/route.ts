// GUID: API_AI_ANALYSIS-000-v04
// [Intent] AI-powered race prediction analysis API route. Accepts a user's top-6 driver prediction and analysis weight configuration, builds a dynamic weighted prompt, calls Genkit/Gemini AI, and returns structured analysis text covering multiple F1 analysis facets and optional pundit personas.
// [Inbound Trigger] POST request from the predictions analysis UI when a user requests AI analysis of their race prediction.
// [Downstream Impact] Calls Google AI (Gemini) via Genkit. Returns analysis text to the client. Logs errors to error_logs. AI costs are incurred per request. No data is persisted beyond error logs. Per-user rate limit enforced via Firestore (20 req/hour). User-controlled fields are sanitized before prompt interpolation.

// AI-powered race prediction analysis with weighted facets
// Uses Genkit with Google AI (Gemini)

import { NextRequest, NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

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

// GUID: API_AI_ANALYSIS-011-v01
// [Intent] Sanitize a user-controlled string before interpolation into an AI prompt. Strips control characters, newlines, carriage returns, null bytes, and any characters outside the safe allowlist (alphanumeric, space, hyphen, apostrophe, dot, comma, parentheses, ampersand). Truncates to maxLen to prevent oversized inputs.
// [Inbound Trigger] Called by buildWeightedPrompt and the prediction list builder for every user-supplied field (raceName, circuit, driverName, team) before they are embedded in the prompt string.
// [Downstream Impact] Prevents prompt injection attacks where crafted input strings could override or hijack AI instructions. Sanitized output is safe for direct interpolation into template literals sent to Gemini.
function sanitizeForPrompt(input: string, maxLen = 100): string {
  if (typeof input !== 'string') return '';
  // Strip control characters (including newlines \n, carriage returns \r, null bytes \x00, etc.)
  // Allow only: alphanumeric, space, hyphen, apostrophe, dot, comma, parentheses, ampersand
  const stripped = input
    .replace(/[\x00-\x1F\x7F]/g, '')  // remove all ASCII control characters (0-31, 127)
    .replace(/[^a-zA-Z0-9 \-'.,()&]/g, '');  // strip anything outside the safe allowlist
  return stripped.substring(0, maxLen);
}

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

// GUID: API_AI_ANALYSIS-006-v04
// [Intent] Build the complete AI prompt dynamically based on race details, user predictions, and weight configuration. Includes facet descriptions with emphasis levels, word budgets, exclusion notes, and formatting rules (British English, headings, verdict). All user-controlled fields (raceName, circuit) are sanitized via sanitizeForPrompt() before interpolation.
// [Inbound Trigger] Called by the POST handler after validating the request.
// [Downstream Impact] The returned prompt string is sent directly to Genkit ai.generate(). Prompt quality directly affects analysis quality. Facet descriptions define the AI's knowledge of each analysis dimension.
const buildWeightedPrompt = (
  raceName: string,
  circuit: string,
  predictionList: string,
  weights: AnalysisWeights,
  totalWeight: number
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

Begin your analysis:`;
};

// GUID: API_AI_ANALYSIS-012-v01
// [Intent] Enforce per-user AI analysis rate limit using a Firestore sliding-window counter. Reads the users/{userId}/aiRateLimit sub-document, resets the window if the 1-hour period has elapsed, and atomically increments the counter. Returns true if the request is allowed, false if the limit (20 requests/hour) has been exceeded.
// [Inbound Trigger] Called by the POST handler immediately after successful auth verification, before any AI processing.
// [Downstream Impact] Prevents financial DoS via runaway AI API costs. Writes to users/{userId}/aiRateLimit in Firestore on every allowed request. Uses a Firestore transaction to guarantee atomic read-modify-write. On rate-limit breach, the caller returns HTTP 429 with ERRORS.EMAIL_RATE_LIMITED.
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

// GUID: API_AI_ANALYSIS-007-v04
// [Intent] POST handler that verifies auth, enforces per-user AI rate limit (20 req/hour via Firestore), validates weights, sanitizes user-controlled fields, builds the prediction list and weighted prompt, calls Genkit AI (Gemini), and returns the analysis text. Includes dedicated error handling for AI generation failures separate from general errors.
// [Inbound Trigger] POST /api/ai/analysis with JSON body matching AnalysisRequest interface.
// [Downstream Impact] Calls Google AI via Genkit (incurs API costs). Returns analysis text to client. Logs AI-specific and general errors to error_logs with AI_GENERATION_FAILED error code. Console-logs audit info for each successful analysis. Rate limit violations return 429 with EMAIL_RATE_LIMITED error code.
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
      console.error(`[Rate Limit Check Error ${correlationId}]`, rateLimitErr?.message);
      rateLimitResult = { allowed: true, count: 0, resetAt: new Date() };
    }

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.EMAIL_RATE_LIMITED.message,
          errorCode: ERRORS.EMAIL_RATE_LIMITED.code,
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

    // Build weighted prompt — raceName and circuit are sanitized inside buildWeightedPrompt
    const prompt = buildWeightedPrompt(
      raceName,
      circuit,
      predictionList,
      weights,
      totalWeight || calculatedTotal
    );

    // GUID: API_AI_ANALYSIS-009-v03
    // [Intent] Call Genkit AI (Gemini) with the weighted prompt and configured generation parameters. Dedicated try/catch provides specific AI error handling with detailed logging.
    // [Inbound Trigger] Prompt built successfully from validated inputs.
    // [Downstream Impact] Returns AI-generated analysis text on success. On failure, logs detailed AI error info (name, code, status, truncated stack) to error_logs and returns a fallback message. Token limit of 1500 controls cost and response length.
    let analysisText: string;
    try {
      const result = await ai.generate({
        prompt,
        config: {
          maxOutputTokens: 1500, // ~1000 words: 9 facets x 50 + 2 pundits x 250 + verdict
          temperature: 0.7,
        },
      });
      analysisText = result.text;
    } catch (aiError: any) {
      console.error(`[AI Generation Error ${correlationId}]`, JSON.stringify({
        message: aiError?.message,
        name: aiError?.name,
        code: aiError?.code,
        status: aiError?.status,
        stack: aiError?.stack?.substring(0, 500),
      }));

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
        console.error(`[Failed to log AI error ${correlationId}]`, logErr);
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
