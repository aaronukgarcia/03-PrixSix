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
 */

// Scoring point values
export const SCORING_POINTS = {
  /** Points awarded for predicting a driver in their exact finishing position */
  exactPosition: 5,

  /** Points awarded for predicting a driver who finishes in top 6, but in wrong position */
  wrongPosition: 3,

  /** Bonus points if all 6 predicted drivers finish in the top 6 (any position) */
  bonusAll6: 10,
} as const;

// Derived values
export const SCORING_DERIVED = {
  /** Maximum possible points per race: 6 exact (30) + bonus (10) = 40 */
  maxPointsPerRace: (SCORING_POINTS.exactPosition * 6) + SCORING_POINTS.bonusAll6,

  /** Number of drivers to predict */
  driversToPredict: 6,
} as const;

// Rule descriptions for the rules page
export const SCORING_RULES = [
  {
    points: SCORING_POINTS.exactPosition,
    pointsDisplay: `+${SCORING_POINTS.exactPosition}`,
    title: 'Exact Position',
    description: 'For each driver you correctly predict in their exact finishing position.',
  },
  {
    points: SCORING_POINTS.wrongPosition,
    pointsDisplay: `+${SCORING_POINTS.wrongPosition}`,
    title: 'In Top 6',
    description: 'For each driver you correctly predict who finishes in the top 6, but in a different position than you predicted.',
  },
  {
    points: SCORING_POINTS.bonusAll6,
    pointsDisplay: `+${SCORING_POINTS.bonusAll6}`,
    title: 'Perfect 6 Bonus',
    description: 'BONUS points if you correctly predict all 6 drivers who finish in the top 6, regardless of their position.',
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
