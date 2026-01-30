// GUID: LIB_SCORING_RULES-000-v03
// [Intent] Single source of truth for all Prix Six scoring constants, rule descriptions,
// and gameplay rules. Centralises point values and rule text so every consumer
// (rules page, scoring engine, consistency checker) reads from one place.
// [Inbound Trigger] Imported by scoring.ts, rules page components, and consistency checker.
// [Downstream Impact] Changing point values here changes every score calculation and
// display across the entire application. scoring.ts depends on SCORING_POINTS and
// calculateDriverPoints. The rules page depends on SCORING_RULES and GAMEPLAY_RULES.

// GUID: LIB_SCORING_RULES-001-v03
// [Intent] Define the concrete point values for the hybrid position-based scoring system.
// Each property maps to a specific proximity tier (exact, 1 off, 2 off, 3+ off, bonus).
// [Inbound Trigger] Referenced at import time by scoring.ts (calculateDriverPoints, bonus check)
// and by SCORING_RULES / SCORING_DERIVED constants below.
// [Downstream Impact] Any value change directly alters all past and future score calculations.
// SCORING_DERIVED.maxPointsPerRace is computed from these values. SCORING_RULES display
// strings reference these values.

/**
 * Prix Six Scoring Rules - Single Source of Truth
 *
 * This file defines all scoring constants and rule descriptions used throughout
 * the application. Any changes here will automatically update:
 * - The rules page (/rules)
 * - Score calculation logic
 * - Consistency checker validation
 *
 * DO NOT hardcode scoring values elsewhere - import from this file.
 *
 * HYBRID SCORING SYSTEM (Updated January 2026):
 * - Points awarded based on how close prediction is to actual position
 * - Bonus for getting all 6 drivers in top 6
 */

// Scoring point values - Hybrid position-based system
export const SCORING_POINTS = {
  /** Points awarded for predicting a driver in their exact finishing position */
  exactPosition: 6,

  /** Points awarded for predicting a driver 1 position off */
  onePositionOff: 4,

  /** Points awarded for predicting a driver 2 positions off */
  twoPositionsOff: 3,

  /** Points awarded for predicting a driver 3+ positions off (but still in top 6) */
  threeOrMoreOff: 2,

  /** Bonus points if all 6 predicted drivers finish in the top 6 (any position) */
  bonusAll6: 10,
} as const;

// GUID: LIB_SCORING_RULES-002-v03
// [Intent] Derive computed constants (max points per race, number of drivers) from
// SCORING_POINTS so they stay automatically in sync with the base point values.
// [Inbound Trigger] Referenced at import time by rules page and validation logic.
// [Downstream Impact] GAMEPLAY_RULES text references driversToPredict. Any consumer
// checking maximum possible score relies on maxPointsPerRace.

// Derived values
export const SCORING_DERIVED = {
  /** Maximum possible points per race: 6 exact (36) + bonus (10) = 46 */
  maxPointsPerRace: (SCORING_POINTS.exactPosition * 6) + SCORING_POINTS.bonusAll6,

  /** Number of drivers to predict */
  driversToPredict: 6,
} as const;

// GUID: LIB_SCORING_RULES-003-v03
// [Intent] Calculate the points a single driver prediction earns based on the
// absolute difference between predicted and actual finishing position.
// Implements the four-tier proximity model: exact / 1-off / 2-off / 3+-off.
// [Inbound Trigger] Called per-driver by calculateRaceScores in scoring.ts during
// score computation for each user prediction.
// [Downstream Impact] Return value is summed into the user's total race score.
// If this function's logic changes, every race score in the system changes.

/**
 * Calculate points for a single driver prediction based on position difference
 * @param predictedPosition - The position where the driver was predicted (0-5)
 * @param actualPosition - The actual finishing position (0-5), or -1 if not in top 6
 * @returns Points awarded for this prediction
 */
export function calculateDriverPoints(predictedPosition: number, actualPosition: number): number {
  // Not in top 6 = 0 points
  if (actualPosition === -1 || actualPosition < 0 || actualPosition > 5) {
    return 0;
  }

  const positionDiff = Math.abs(predictedPosition - actualPosition);

  if (positionDiff === 0) {
    return SCORING_POINTS.exactPosition;
  } else if (positionDiff === 1) {
    return SCORING_POINTS.onePositionOff;
  } else if (positionDiff === 2) {
    return SCORING_POINTS.twoPositionsOff;
  } else {
    // 3+ positions off but still in top 6
    return SCORING_POINTS.threeOrMoreOff;
  }
}

// GUID: LIB_SCORING_RULES-004-v03
// [Intent] Provide human-readable rule descriptions for display on the rules page.
// Each entry pairs a point value with a title and prose explanation so the UI can
// render the scoring table without hardcoded strings.
// [Inbound Trigger] Imported by the /rules page component at render time.
// [Downstream Impact] Changing titles or descriptions alters what users see on the
// rules page. Point values are sourced from SCORING_POINTS (single source of truth).

// Rule descriptions for the rules page
export const SCORING_RULES = [
  {
    points: SCORING_POINTS.exactPosition,
    pointsDisplay: `+${SCORING_POINTS.exactPosition}`,
    title: 'Exact Position',
    description: 'For each driver you correctly predict in their exact finishing position.',
  },
  {
    points: SCORING_POINTS.onePositionOff,
    pointsDisplay: `+${SCORING_POINTS.onePositionOff}`,
    title: '1 Position Off',
    description: 'For each driver you predict who finishes 1 position away from your prediction.',
  },
  {
    points: SCORING_POINTS.twoPositionsOff,
    pointsDisplay: `+${SCORING_POINTS.twoPositionsOff}`,
    title: '2 Positions Off',
    description: 'For each driver you predict who finishes 2 positions away from your prediction.',
  },
  {
    points: SCORING_POINTS.threeOrMoreOff,
    pointsDisplay: `+${SCORING_POINTS.threeOrMoreOff}`,
    title: '3+ Positions Off',
    description: 'For each driver you predict who finishes in the top 6, but 3 or more positions away from your prediction.',
  },
  {
    points: 0,
    pointsDisplay: '0',
    title: 'Not in Top 6',
    description: 'If a driver you predicted does not finish in the top 6, you receive no points for that prediction.',
  },
  {
    points: SCORING_POINTS.bonusAll6,
    pointsDisplay: `+${SCORING_POINTS.bonusAll6}`,
    title: 'Perfect 6 Bonus',
    description: 'BONUS points if you correctly predict all 6 drivers who finish in the top 6, regardless of their positions.',
  },
] as const;

// GUID: LIB_SCORING_RULES-005-v03
// [Intent] Provide human-readable gameplay rule descriptions for the rules page,
// covering objective, deadlines, defaults, validation, and late-joiner policy.
// [Inbound Trigger] Imported by the /rules page component at render time.
// [Downstream Impact] Changing these descriptions alters what users see on the
// rules page. driversToPredict is sourced from SCORING_DERIVED.

// Gameplay rules for the rules page
export const GAMEPLAY_RULES = [
  {
    title: 'The Objective',
    description: `Predict the top ${SCORING_DERIVED.driversToPredict} finishing drivers for each race (Sprint and Grand Prix).`,
  },
  {
    title: 'Prediction Deadline',
    description: 'All predictions must be submitted before the official start of the weekend\'s first qualifying session. A countdown timer is available on the dashboard. Once qualifying begins, predictions are locked.',
  },
  {
    title: 'Default Predictions',
    description: 'If you do not submit a new prediction for a race, your prediction from the previous race will be used automatically. Your grid will only be empty for your very first race.',
  },
  {
    title: 'Validation',
    description: `You must select exactly ${SCORING_DERIVED.driversToPredict} unique drivers. A driver cannot be selected for more than one position.`,
  },
  {
    title: 'Late Joiners',
    description: 'Any team who joins after the season starts will begin in last place, 5 points behind the current last-place team.',
  },
] as const;

// GUID: LIB_SCORING_RULES-006-v03
// [Intent] Define the tiebreaker rule text for end-of-season standings disputes.
// [Inbound Trigger] Imported by the /rules page component at render time.
// [Downstream Impact] Changing this alters the displayed tiebreaker rule only;
// no scoring logic depends on this constant.

export const TIEBREAKER_RULE = {
  title: 'End of Season Tie',
  description: 'In the event of a tie in the final standings, the winner will be the team principal who has correctly predicted the most 1st, 2nd, and 3rd place finishes throughout the season, including quali sessions.',
} as const;

// GUID: LIB_SCORING_RULES-007-v03
// [Intent] Export TypeScript types derived from the SCORING_RULES and GAMEPLAY_RULES
// arrays so consuming components can be type-safe when iterating over rules.
// [Inbound Trigger] Imported by any TypeScript consumer that needs to type-check
// against individual rule entries.
// [Downstream Impact] Removing or restructuring SCORING_RULES or GAMEPLAY_RULES
// will break these types and any consumer depending on them.

// Type exports for TypeScript
export type ScoringRule = typeof SCORING_RULES[number];
export type GameplayRule = typeof GAMEPLAY_RULES[number];
