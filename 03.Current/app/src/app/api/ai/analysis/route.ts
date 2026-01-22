// AI-powered race prediction analysis with weighted facets
// Uses Genkit with Google AI (Gemini)

import { NextRequest, NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface PredictionDriver {
  position: number;
  driverCode: string;
  driverName: string;
  team: string;
}

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

interface AnalysisRequest {
  raceId: string;
  raceName: string;
  circuit: string;
  predictions: PredictionDriver[];
  weights: AnalysisWeights;
  totalWeight: number;
}

// Standard facets get 50 words, pundit facets get up to 250 words
const WORDS_PER_FACET = 50;
const WORDS_PER_PUNDIT = 250;

const PUNDIT_FACETS = ['jackSparrow', 'rowanHornblower'];

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

// Build dynamic prompt based on weights
const buildWeightedPrompt = (
  raceName: string,
  circuit: string,
  predictionList: string,
  weights: AnalysisWeights,
  totalWeight: number
): string => {
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
    circuitCharacteristics: `**Circuit Layout**: Key features of ${circuit} - high-speed sections, technical corners, straights, elevation changes, overtaking opportunities.`,
    trackSurface: `**Track Surface**: Grip levels, any recent resurfacing, bumpy sections, how the surface affects tyre wear and the predicted order.`,
    layoutChanges: `**Historical Results**: How have the predicted drivers performed at ${circuit} in previous years? Win rates, podiums, average finishing positions.`,
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

The user has submitted their top 6 prediction for the ${raceName} at ${circuit}.

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

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // Note: Firebase App Hosting uses Application Default Credentials (ADC) automatically.
    // genkit.ts has a fallback projectId, so we don't need to check env vars here.
    // If credentials are missing, Vertex AI will return a meaningful error.

    const body: AnalysisRequest = await request.json();
    const { raceName, circuit, predictions, weights, totalWeight } = body;

    // Validate weights
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

    // Build prediction list
    const predictionList = predictions
      .map(p => `P${p.position}: ${p.driverName} (${p.team})`)
      .join('\n');

    // Build weighted prompt
    const prompt = buildWeightedPrompt(
      raceName,
      circuit,
      predictionList,
      weights,
      totalWeight || calculatedTotal
    );

    // Call Genkit AI
    let analysisText: string;
    try {
      const result = await ai.generate({
        prompt,
        config: {
          maxOutputTokens: 1500, // ~1000 words: 9 facets × 50 + 2 pundits × 250 + verdict
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
        await logError({
          correlationId,
          error: aiError instanceof Error ? aiError : String(aiError),
          context: {
            route: '/api/ai/analysis',
            action: 'ai.generate',
            additionalInfo: {
              errorCode: ERROR_CODES.AI_GENERATION_FAILED.code,
              errorType: aiError?.name || 'AIGenerationError',
              aiErrorCode: aiError?.code,
              aiErrorStatus: aiError?.status,
              raceName,
              promptLength: prompt?.length,
            },
          },
        });
      } catch (logErr) {
        console.error(`[Failed to log AI error ${correlationId}]`, logErr);
      }

      return NextResponse.json(
        {
          success: false,
          error: `AI generation failed: ${aiError?.message || 'Unknown AI error'}`,
          errorCode: ERROR_CODES.AI_GENERATION_FAILED.code,
          correlationId,
          analysis: 'Unable to generate analysis at this time. Please try again later.',
        },
        { status: 500 }
      );
    }

    // Log for audit
    console.log(`[AI Analysis] Race: ${raceName}, Weights: ${JSON.stringify(weights)}, Total: ${totalWeight}`);

    return NextResponse.json({
      success: true,
      analysis: analysisText,
      race: raceName,
      weightsApplied: weights,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error(`[AI Analysis Error ${correlationId}]`, error);

    // Log error to error_logs collection
    await logError({
      correlationId,
      error: error instanceof Error ? error : String(error),
      context: {
        route: '/api/ai/analysis',
        action: 'POST',
        additionalInfo: {
          errorCode: ERROR_CODES.AI_GENERATION_FAILED.code,
          errorType: error?.name || 'Unknown',
        },
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: ERROR_CODES.AI_GENERATION_FAILED.message,
        errorCode: ERROR_CODES.AI_GENERATION_FAILED.code,
        correlationId,
        analysis: 'Unable to generate analysis at this time. Please try again later.',
      },
      { status: 500 }
    );
  }
}
