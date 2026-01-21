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

// Derived values
export const SCORING_DERIVED = {
  /** Maximum possible points per race: 6 exact (36) + bonus (10) = 46 */
  maxPointsPerRace: (SCORING_POINTS.exactPosition * 6) + SCORING_POINTS.bonusAll6,

  /** Number of drivers to predict */
  driversToPredict: 6,
} as const;

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

export const TIEBREAKER_RULE = {
  title: 'End of Season Tie',
  description: 'In the event of a tie in the final standings, the winner will be the team principal who has correctly predicted the most 1st, 2nd, and 3rd place finishes throughout the season, including quali sessions.',
} as const;

// Type exports for TypeScript
export type ScoringRule = typeof SCORING_RULES[number];
export type GameplayRule = typeof GAMEPLAY_RULES[number];
