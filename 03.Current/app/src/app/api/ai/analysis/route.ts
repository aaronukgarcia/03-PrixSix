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
  punditAlignment: number;
}

interface AnalysisRequest {
  raceId: string;
  raceName: string;
  circuit: string;
  predictions: PredictionDriver[];
  weights: AnalysisWeights;
  totalWeight: number;
}

// Map weights to word counts (proportional allocation within 250 word cap)
const calculateWordBudgets = (weights: AnalysisWeights, totalWeight: number): Record<string, number> => {
  const maxWords = 250;
  const facets = Object.entries(weights);

  const budgets: Record<string, number> = {};

  facets.forEach(([key, weight]) => {
    if (weight === 0) {
      budgets[key] = 0;
    } else {
      // Proportional allocation
      budgets[key] = Math.round((weight / totalWeight) * maxWords);
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
  const budgets = calculateWordBudgets(weights, totalWeight);

  // Filter to only include facets with weight > 0, sorted by weight descending
  const activeFacets = Object.entries(weights)
    .filter(([_, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  const facetDescriptions: Record<string, string> = {
    driverForm: `**Driver Form** (~${budgets.driverForm} words): Recent performance over the last 3-4 races. Who's on an upward trajectory? Who's struggling?`,
    trackHistory: `**Track History** (~${budgets.trackHistory} words): How have these specific drivers performed at ${circuit} in previous years? Win rates, podiums, average finishing positions.`,
    overtakingCrashes: `**Overtakes & Incidents** (~${budgets.overtakingCrashes} words): Historical overtaking moves and crashes at this circuit. Which drivers have made bold moves here? Who has DNF'd?`,
    circuitCharacteristics: `**Circuit Layout** (~${budgets.circuitCharacteristics} words): Key features of ${circuit} - high-speed sections, technical corners, straights, elevation changes, overtaking opportunities.`,
    trackSurface: `**Track Surface** (~${budgets.trackSurface} words): Grip levels, any recent resurfacing, bumpy sections, how the surface affects tyre wear.`,
    layoutChanges: `**Layout Changes** (~${budgets.layoutChanges} words): Any modifications to the circuit layout compared to previous years and how this might affect racing.`,
    weather: `**Weather** (~${budgets.weather} words): Expected temperature, humidity, wind, rain probability and how conditions might affect the predicted order.`,
    tyreStrategy: `**Tyre Strategy** (~${budgets.tyreStrategy} words): Compound choices (hard/medium/soft), expected degradation, optimal pit windows, how strategy might shuffle positions.`,
    bettingOdds: `**Betting Odds** (~${budgets.bettingOdds} words): Current bookmaker predictions for race winner and podium finishers.`,
    punditAlignment: `**Pundit Alignment** (~${budgets.punditAlignment} words): How does this prediction compare to expert consensus? Highlight any bold or contrarian picks.`,
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

  return `You are an expert Formula 1 analyst providing race prediction analysis for Prix Six, a fantasy F1 league.

The user has submitted their top 6 prediction for the ${raceName} at ${circuit}.

Their prediction:
${predictionList}

Provide analysis weighted according to the user's preferences. The user has allocated ${totalWeight} points across 10 facets. Focus your analysis proportionally:

${facetInstructions}
${exclusionNote}

IMPORTANT RULES:
1. Total response MUST be 250 words maximum
2. Allocate word count proportionally to the weights shown
3. Skip any facet with 0 weight entirely
4. Prioritise facets with higher weights - give them more depth
5. Use British English spelling
6. Be direct and insightful - no waffle
7. Reference specific data points where possible (lap times, previous results, odds)
8. End with a brief overall verdict on the prediction's strength

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
    if (calculatedTotal > 70) {
      return NextResponse.json(
        {
          success: false,
          error: 'Weight total exceeds maximum of 70',
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
          maxOutputTokens: 400,
          temperature: 0.7,
        },
      });
      analysisText = result.text;
    } catch (aiError: any) {
      console.error(`[AI Generation Error ${correlationId}]`, aiError);

      // Log specific AI error
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
          },
        },
      });

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
