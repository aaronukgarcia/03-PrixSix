import { F1Drivers, RaceSchedule, type Driver, type Race } from './data';
import { SCORING_POINTS, SCORING_DERIVED, calculateDriverPoints } from './scoring-rules';

// --- Types ---

export type CheckCategory = 'users' | 'drivers' | 'races' | 'predictions' | 'results' | 'scores' | 'standings' | 'leagues';
export type IssueSeverity = 'error' | 'warning';
export type CheckStatus = 'pass' | 'warning' | 'error';

export interface Issue {
  severity: IssueSeverity;
  entity: string;
  field?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CheckResult {
  category: CheckCategory;
  status: CheckStatus;
  total: number;
  valid: number;
  issues: Issue[];
}

export interface ConsistencyCheckSummary {
  correlationId: string;
  timestamp: Date;
  results: CheckResult[];
  totalChecks: number;
  passed: number;
  warnings: number;
  errors: number;
}

// --- User Interfaces ---

export interface UserData {
  id: string;
  email?: string;
  teamName?: string;
  isAdmin?: boolean;
  secondaryTeamName?: string;
}

// --- Prediction Interfaces ---

export interface PredictionData {
  id: string;
  userId?: string;
  teamId?: string;
  teamName?: string;
  raceId?: string;
  predictions?: string[];
}

// --- Race Result Interfaces ---

export interface RaceResultData {
  id: string;
  raceId?: string;
  driver1?: string;
  driver2?: string;
  driver3?: string;
  driver4?: string;
  driver5?: string;
  driver6?: string;
}

// --- Score Interfaces ---

export interface ScoreData {
  id: string;
  userId?: string;
  raceId?: string;
  totalPoints?: number;
  breakdown?: string;
}

// --- League Interfaces ---

export interface LeagueData {
  id: string;
  name?: string;
  ownerId?: string;
  memberUserIds?: string[];
  isGlobal?: boolean;
  inviteCode?: string;
}

// --- Validation Functions ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generate a correlation ID for consistency checks
 */
export function generateConsistencyCorrelationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `cc_${timestamp}_${random}`;
}

/**
 * Normalize a race name to the ID format (lowercase with hyphens)
 */
export function normalizeRaceId(raceName: string): string {
  return raceName
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/**
 * Get valid driver IDs from static data
 */
export function getValidDriverIds(): Set<string> {
  return new Set(F1Drivers.map(d => d.id));
}

/**
 * Get valid race names from static data
 */
export function getValidRaceNames(): Set<string> {
  return new Set(RaceSchedule.map(r => r.name));
}

/**
 * Get valid normalized race IDs from static data
 */
export function getValidRaceIds(): Set<string> {
  return new Set(RaceSchedule.map(r => normalizeRaceId(r.name)));
}

// --- Check Functions ---

/**
 * Validate users collection
 */
export function checkUsers(users: UserData[]): CheckResult {
  const issues: Issue[] = [];
  const seenTeamNames = new Map<string, string>(); // teamName -> userId
  const seenSecondaryTeamNames = new Map<string, string>();
  let validCount = 0;

  for (const user of users) {
    let isValid = true;

    // Check required fields
    if (!user.id) {
      issues.push({
        severity: 'error',
        entity: `User ${user.email || 'unknown'}`,
        field: 'id',
        message: 'Missing required field: id',
      });
      isValid = false;
    }

    if (!user.email) {
      issues.push({
        severity: 'error',
        entity: `User ${user.id}`,
        field: 'email',
        message: 'Missing required field: email',
      });
      isValid = false;
    } else if (!EMAIL_REGEX.test(user.email)) {
      issues.push({
        severity: 'warning',
        entity: `User ${user.id}`,
        field: 'email',
        message: `Invalid email format: ${user.email}`,
      });
    }

    if (!user.teamName) {
      issues.push({
        severity: 'error',
        entity: `User ${user.id}`,
        field: 'teamName',
        message: 'Missing required field: teamName',
      });
      isValid = false;
    } else if (user.teamName.trim() === '') {
      issues.push({
        severity: 'error',
        entity: `User ${user.id}`,
        field: 'teamName',
        message: 'teamName is empty',
      });
      isValid = false;
    }

    if (user.isAdmin === undefined) {
      issues.push({
        severity: 'warning',
        entity: `User ${user.id}`,
        field: 'isAdmin',
        message: 'Missing field: isAdmin (defaulting to false)',
      });
    }

    // Check for duplicate team names
    if (user.teamName) {
      const existingUserId = seenTeamNames.get(user.teamName.toLowerCase());
      if (existingUserId && existingUserId !== user.id) {
        issues.push({
          severity: 'error',
          entity: `User ${user.id}`,
          field: 'teamName',
          message: `Duplicate teamName "${user.teamName}" also used by user ${existingUserId}`,
        });
        isValid = false;
      } else {
        seenTeamNames.set(user.teamName.toLowerCase(), user.id);
      }
    }

    // Check secondary team name for duplicates
    if (user.secondaryTeamName) {
      const normalizedSecondary = user.secondaryTeamName.toLowerCase();

      // Check against primary team names
      const primaryUser = seenTeamNames.get(normalizedSecondary);
      if (primaryUser && primaryUser !== user.id) {
        issues.push({
          severity: 'error',
          entity: `User ${user.id}`,
          field: 'secondaryTeamName',
          message: `Secondary team name "${user.secondaryTeamName}" conflicts with primary team of user ${primaryUser}`,
        });
        isValid = false;
      }

      // Check against other secondary team names
      const existingSecondary = seenSecondaryTeamNames.get(normalizedSecondary);
      if (existingSecondary && existingSecondary !== user.id) {
        issues.push({
          severity: 'error',
          entity: `User ${user.id}`,
          field: 'secondaryTeamName',
          message: `Duplicate secondary team name "${user.secondaryTeamName}" also used by user ${existingSecondary}`,
        });
        isValid = false;
      } else {
        seenSecondaryTeamNames.set(normalizedSecondary, user.id);
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'users',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: users.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate static driver data
 */
export function checkDrivers(): CheckResult {
  const issues: Issue[] = [];
  const seenIds = new Set<string>();
  let validCount = 0;

  for (const driver of F1Drivers) {
    let isValid = true;

    // Check required fields
    if (!driver.id) {
      issues.push({
        severity: 'error',
        entity: `Driver ${driver.name || 'unknown'}`,
        field: 'id',
        message: 'Missing required field: id',
      });
      isValid = false;
    }

    if (!driver.name) {
      issues.push({
        severity: 'error',
        entity: `Driver ${driver.id}`,
        field: 'name',
        message: 'Missing required field: name',
      });
      isValid = false;
    }

    if (driver.number === undefined || driver.number === null) {
      issues.push({
        severity: 'error',
        entity: `Driver ${driver.id}`,
        field: 'number',
        message: 'Missing required field: number',
      });
      isValid = false;
    }

    if (!driver.team) {
      issues.push({
        severity: 'error',
        entity: `Driver ${driver.id}`,
        field: 'team',
        message: 'Missing required field: team',
      });
      isValid = false;
    }

    if (!driver.imageId) {
      issues.push({
        severity: 'warning',
        entity: `Driver ${driver.id}`,
        field: 'imageId',
        message: 'Missing field: imageId',
      });
    }

    // Check for duplicates
    if (driver.id && seenIds.has(driver.id)) {
      issues.push({
        severity: 'error',
        entity: `Driver ${driver.id}`,
        field: 'id',
        message: `Duplicate driver ID: ${driver.id}`,
      });
      isValid = false;
    } else if (driver.id) {
      seenIds.add(driver.id);
    }

    if (isValid) {
      validCount++;
    }
  }

  // Check expected count
  if (F1Drivers.length !== 22) {
    issues.push({
      severity: 'warning',
      entity: 'F1Drivers',
      message: `Expected 22 drivers, found ${F1Drivers.length}`,
    });
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'drivers',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: F1Drivers.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate static race schedule data
 */
export function checkRaces(): CheckResult {
  const issues: Issue[] = [];
  let validCount = 0;
  let previousDate: Date | null = null;

  for (const race of RaceSchedule) {
    let isValid = true;

    // Check required fields
    if (!race.name) {
      issues.push({
        severity: 'error',
        entity: `Race at index ${RaceSchedule.indexOf(race)}`,
        field: 'name',
        message: 'Missing required field: name',
      });
      isValid = false;
    }

    if (!race.qualifyingTime) {
      issues.push({
        severity: 'error',
        entity: `Race ${race.name}`,
        field: 'qualifyingTime',
        message: 'Missing required field: qualifyingTime',
      });
      isValid = false;
    }

    if (!race.raceTime) {
      issues.push({
        severity: 'error',
        entity: `Race ${race.name}`,
        field: 'raceTime',
        message: 'Missing required field: raceTime',
      });
      isValid = false;
    }

    if (!race.location) {
      issues.push({
        severity: 'error',
        entity: `Race ${race.name}`,
        field: 'location',
        message: 'Missing required field: location',
      });
      isValid = false;
    }

    if (race.hasSprint === undefined) {
      issues.push({
        severity: 'warning',
        entity: `Race ${race.name}`,
        field: 'hasSprint',
        message: 'Missing field: hasSprint',
      });
    }

    // Validate date formats and sequence
    if (race.raceTime) {
      const raceDate = new Date(race.raceTime);
      if (isNaN(raceDate.getTime())) {
        issues.push({
          severity: 'error',
          entity: `Race ${race.name}`,
          field: 'raceTime',
          message: `Invalid date format: ${race.raceTime}`,
        });
        isValid = false;
      } else {
        // Check sequence
        if (previousDate && raceDate < previousDate) {
          issues.push({
            severity: 'warning',
            entity: `Race ${race.name}`,
            field: 'raceTime',
            message: 'Race is out of chronological order',
          });
        }
        previousDate = raceDate;
      }
    }

    if (race.qualifyingTime) {
      const qualifyingDate = new Date(race.qualifyingTime);
      if (isNaN(qualifyingDate.getTime())) {
        issues.push({
          severity: 'error',
          entity: `Race ${race.name}`,
          field: 'qualifyingTime',
          message: `Invalid date format: ${race.qualifyingTime}`,
        });
        isValid = false;
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  // Check expected count
  if (RaceSchedule.length !== 24) {
    issues.push({
      severity: 'warning',
      entity: 'RaceSchedule',
      message: `Expected 24 races, found ${RaceSchedule.length}`,
    });
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'races',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: RaceSchedule.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate predictions
 */
export function checkPredictions(
  predictions: PredictionData[],
  users: UserData[]
): CheckResult {
  const issues: Issue[] = [];
  const validDriverIds = getValidDriverIds();
  const validRaceIds = getValidRaceIds();
  const userIds = new Set(users.map(u => u.id));
  let validCount = 0;

  for (const pred of predictions) {
    let isValid = true;
    const entityName = `Prediction ${pred.id}`;

    // Check user reference
    const userId = pred.userId || pred.teamId;
    if (!userId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'userId',
        message: 'Missing userId or teamId',
      });
      isValid = false;
    } else if (!userIds.has(userId)) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'userId',
        message: `Invalid userId: ${userId} (user does not exist)`,
        details: { userId },
      });
      isValid = false;
    }

    // Check race reference
    if (!pred.raceId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'raceId',
        message: 'Missing raceId',
      });
      isValid = false;
    } else if (!validRaceIds.has(normalizeRaceId(pred.raceId))) {
      issues.push({
        severity: 'warning',
        entity: entityName,
        field: 'raceId',
        message: `Unknown raceId: ${pred.raceId}`,
        details: { raceId: pred.raceId },
      });
    }

    // Check predictions array
    if (!pred.predictions) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'predictions',
        message: 'Missing predictions data',
      });
      isValid = false;
    } else {
      const driversArray = pred.predictions;

      // Check count
      if (driversArray.length !== 6) {
        issues.push({
          severity: 'error',
          entity: entityName,
          field: 'predictions',
          message: `Expected 6 drivers, found ${driversArray.length}`,
          details: { count: driversArray.length },
        });
        isValid = false;
      }

      // Check for duplicates
      const seenDrivers = new Set<string>();
      for (const driverId of driversArray) {
        if (!validDriverIds.has(driverId)) {
          issues.push({
            severity: 'error',
            entity: entityName,
            field: 'predictions',
            message: `Invalid driver ID: ${driverId}`,
            details: { driverId },
          });
          isValid = false;
        }

        if (seenDrivers.has(driverId)) {
          issues.push({
            severity: 'error',
            entity: entityName,
            field: 'predictions',
            message: `Duplicate driver in prediction: ${driverId}`,
            details: { driverId },
          });
          isValid = false;
        }
        seenDrivers.add(driverId);
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'predictions',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: predictions.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate race results
 */
export function checkRaceResults(results: RaceResultData[]): CheckResult {
  const issues: Issue[] = [];
  const validDriverIds = getValidDriverIds();
  const validRaceIds = getValidRaceIds();
  let validCount = 0;

  for (const result of results) {
    let isValid = true;
    const entityName = `Race Result ${result.id}`;

    // Check race reference
    if (!result.raceId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'raceId',
        message: 'Missing raceId',
      });
      isValid = false;
    } else {
      const normalizedId = normalizeRaceId(result.raceId);
      if (!validRaceIds.has(normalizedId)) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          field: 'raceId',
          message: `Unknown raceId: ${result.raceId}`,
          details: { raceId: result.raceId, normalizedId },
        });
      }
    }

    // Check all 6 driver positions
    const drivers = [
      result.driver1,
      result.driver2,
      result.driver3,
      result.driver4,
      result.driver5,
      result.driver6,
    ];

    const seenDrivers = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const driver = drivers[i];
      const position = `driver${i + 1}`;

      if (!driver) {
        issues.push({
          severity: 'error',
          entity: entityName,
          field: position,
          message: `Missing driver at position ${i + 1}`,
        });
        isValid = false;
      } else {
        if (!validDriverIds.has(driver)) {
          issues.push({
            severity: 'error',
            entity: entityName,
            field: position,
            message: `Invalid driver ID: ${driver}`,
            details: { driverId: driver, position: i + 1 },
          });
          isValid = false;
        }

        if (seenDrivers.has(driver)) {
          issues.push({
            severity: 'error',
            entity: entityName,
            field: position,
            message: `Duplicate driver in result: ${driver}`,
            details: { driverId: driver },
          });
          isValid = false;
        }
        seenDrivers.add(driver);
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'results',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: results.length,
    valid: validCount,
    issues,
  };
}

// Scoring constants (Prix Six rules)
// Use shared scoring constants from scoring-rules.ts
const SCORING = {
  ...SCORING_POINTS,
  maxPoints: SCORING_DERIVED.maxPointsPerRace,
};

/**
 * Calculate expected score based on Prix Six hybrid rules
 * Uses position-based scoring: exact +6, 1 off +4, 2 off +3, 3+ off +2, not in top 6 = 0
 */
function calculateExpectedScore(predictedDrivers: string[], actualTop6: string[]): { points: number; correctCount: number } {
  let points = 0;
  let correctCount = 0;

  // Normalize to lowercase for comparison
  const normalizedActual = actualTop6.map(d => d?.toLowerCase());

  for (let predictedPosition = 0; predictedPosition < predictedDrivers.length; predictedPosition++) {
    const driver = predictedDrivers[predictedPosition];
    if (!driver) continue;

    const normalizedDriver = driver.toLowerCase();
    const actualPosition = normalizedActual.indexOf(normalizedDriver);

    // Calculate points using hybrid position-based system
    const driverPoints = calculateDriverPoints(predictedPosition, actualPosition);
    points += driverPoints;

    if (actualPosition !== -1) {
      // Driver is in top 6
      correctCount++;
    }
  }

  // Bonus for all 6 in top 6
  if (correctCount === 6) {
    points += SCORING.bonusAll6;
  }

  return { points, correctCount };
}

/**
 * Validate scores against race results and predictions
 * Includes verification that score calculation is correct per Prix Six rules
 */
export function checkScores(
  scores: ScoreData[],
  raceResults: RaceResultData[],
  predictions: PredictionData[],
  users: UserData[]
): CheckResult {
  const issues: Issue[] = [];
  const userIds = new Set(users.map(u => u.id));
  // Build resultsRaceIds from both raceId field and document ID for maximum compatibility
  const resultsRaceIds = new Set<string>();
  for (const r of raceResults) {
    if (r.raceId) resultsRaceIds.add(normalizeRaceId(r.raceId));
    if (r.id) resultsRaceIds.add(normalizeRaceId(r.id));
  }

  let validCount = 0;

  // Build prediction map (normalize raceId to lowercase for consistent lookups)
  const predictionMap = new Map<string, PredictionData>();
  for (const pred of predictions) {
    const userId = pred.userId || pred.teamId;
    const normalizedRaceId = normalizeRaceId(pred.raceId || '');
    const key = `${normalizedRaceId}_${userId}`;
    predictionMap.set(key, pred);
  }

  // Build race results map (by normalized raceId)
  const resultsMap = new Map<string, RaceResultData>();
  for (const result of raceResults) {
    const normalizedId = normalizeRaceId(result.raceId || result.id || '');
    resultsMap.set(normalizedId, result);
    // Also map by document ID (lowercase)
    resultsMap.set(result.id.toLowerCase(), result);
  }

  for (const score of scores) {
    let isValid = true;
    const entityName = `Score ${score.id}`;

    // Check ID format
    const expectedIdPattern = /^.+_.+$/;
    if (!expectedIdPattern.test(score.id)) {
      issues.push({
        severity: 'warning',
        entity: entityName,
        field: 'id',
        message: `Score ID does not match expected format {raceId}_{userId}`,
        details: { id: score.id },
      });
    }

    // Check user reference
    if (!score.userId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'userId',
        message: 'Missing userId',
      });
      isValid = false;
    } else if (!userIds.has(score.userId)) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'userId',
        message: `Invalid userId: ${score.userId} (user does not exist)`,
        details: { userId: score.userId },
      });
      isValid = false;
    }

    // Check race reference
    if (!score.raceId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'raceId',
        message: 'Missing raceId',
      });
      isValid = false;
    } else {
      const normalizedScoreRaceId = normalizeRaceId(score.raceId);
      if (!resultsRaceIds.has(normalizedScoreRaceId)) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          field: 'raceId',
          message: `Orphan score: no race result exists for ${score.raceId}`,
          details: { raceId: score.raceId },
        });
      }
    }

    // Check for corresponding prediction
    if (score.raceId && score.userId) {
      const normalizedScoreRaceId = normalizeRaceId(score.raceId);
      const predKey = `${normalizedScoreRaceId}_${score.userId}`;
      if (!predictionMap.has(predKey)) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          message: `Score exists but no prediction found`,
          details: { raceId: score.raceId, userId: score.userId },
        });
      }
    }

    // Check points validity
    if (score.totalPoints === undefined || score.totalPoints === null) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'totalPoints',
        message: 'Missing totalPoints',
      });
      isValid = false;
    } else if (score.totalPoints < 0 || score.totalPoints > SCORING.maxPoints) {
      issues.push({
        severity: 'warning',
        entity: entityName,
        field: 'totalPoints',
        message: `Unusual totalPoints value: ${score.totalPoints} (expected 0-${SCORING.maxPoints})`,
        details: { totalPoints: score.totalPoints },
      });
    }

    // Verify score calculation is correct
    if (score.raceId && score.userId && score.totalPoints !== undefined) {
      // Normalize raceId to match prediction format (remove -GP or -Sprint suffix)
      const normalizedScoreRaceId = normalizeRaceId(score.raceId);

      // Try multiple key formats to find the prediction
      const predKey = `${normalizedScoreRaceId}_${score.userId}`;
      const predKeyAlt = `${score.raceId}_${score.userId}`;
      const prediction = predictionMap.get(predKey) || predictionMap.get(predKeyAlt);
      const raceResult = resultsMap.get(score.raceId) || resultsMap.get(score.raceId.toLowerCase()) || resultsMap.get(normalizedScoreRaceId);

      if (prediction && raceResult) {
        // Extract predicted drivers
        let predictedDrivers: string[] = [];
        if (Array.isArray(prediction.predictions)) {
          predictedDrivers = prediction.predictions;
        } else if (prediction.predictions && typeof prediction.predictions === 'object') {
          const preds = prediction.predictions as Record<string, string>;
          predictedDrivers = [
            preds.P1, preds.P2, preds.P3, preds.P4, preds.P5, preds.P6
          ].filter(Boolean);
        }

        // Extract actual top 6
        const actualTop6 = [
          raceResult.driver1, raceResult.driver2, raceResult.driver3,
          raceResult.driver4, raceResult.driver5, raceResult.driver6
        ].filter((d): d is string => Boolean(d));

        if (predictedDrivers.length === 6 && actualTop6.length === 6) {
          const expected = calculateExpectedScore(predictedDrivers, actualTop6);

          if (expected.points !== score.totalPoints) {
            issues.push({
              severity: 'error',
              entity: entityName,
              field: 'totalPoints',
              message: `Score calculation mismatch: stored ${score.totalPoints}, expected ${expected.points} (${expected.correctCount}/6 correct)`,
              details: {
                stored: score.totalPoints,
                expected: expected.points,
                correctCount: expected.correctCount,
                predictedDrivers,
                actualTop6,
              },
            });
            isValid = false;
          }
        }
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  // Check for missing scores (predictions with results but no score)
  for (const pred of predictions) {
    const userId = pred.userId || pred.teamId;
    const normalizedPredRaceId = normalizeRaceId(pred.raceId || '');
    if (pred.raceId && userId && resultsRaceIds.has(normalizedPredRaceId)) {
      const hasScore = scores.some(s => normalizeRaceId(s.raceId || '') === normalizedPredRaceId && s.userId === userId);
      if (!hasScore) {
        issues.push({
          severity: 'warning',
          entity: `Prediction ${pred.id}`,
          message: 'Prediction has race result but no corresponding score',
          details: { raceId: pred.raceId, userId },
        });
      }
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'scores',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: scores.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate standings consistency (sum of scores matches expected)
 */
export function checkStandings(
  scores: ScoreData[],
  users: UserData[]
): CheckResult {
  const issues: Issue[] = [];
  let validCount = 0;

  // Calculate total points per user from scores
  const userTotals = new Map<string, number>();
  for (const score of scores) {
    if (score.userId && typeof score.totalPoints === 'number') {
      const current = userTotals.get(score.userId) || 0;
      userTotals.set(score.userId, current + score.totalPoints);
    }
  }

  // Validate each user has consistent standings
  for (const user of users) {
    let isValid = true;
    const totalPoints = userTotals.get(user.id) || 0;
    const entityName = `Standings for ${user.teamName || user.id}`;

    // Check for any race scores
    const userScores = scores.filter(s => s.userId === user.id);

    if (userScores.length === 0) {
      // No scores yet is valid (user may not have predicted or no races completed)
      isValid = true;
    } else {
      // Recalculate and verify sum
      const calculatedTotal = userScores.reduce((sum, s) => sum + (s.totalPoints || 0), 0);
      if (calculatedTotal !== totalPoints) {
        issues.push({
          severity: 'error',
          entity: entityName,
          message: `Points mismatch: sum is ${calculatedTotal} but expected ${totalPoints}`,
          details: { calculated: calculatedTotal, expected: totalPoints },
        });
        isValid = false;
      }
    }

    if (isValid) {
      validCount++;
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'standings',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: users.length,
    valid: validCount,
    issues,
  };
}

/**
 * Validate leagues collection
 * Checks that each league has an owner and at least one member
 */
export function checkLeagues(
  leagues: LeagueData[],
  users: UserData[]
): CheckResult {
  const issues: Issue[] = [];
  const userIds = new Set(users.map(u => u.id));
  let validCount = 0;

  for (const league of leagues) {
    let isValid = true;
    const entityName = `League ${league.name || league.id}`;

    // Check required id
    if (!league.id) {
      issues.push({
        severity: 'error',
        entity: `League unknown`,
        field: 'id',
        message: 'Missing required field: id',
      });
      isValid = false;
    }

    // Check name
    if (!league.name) {
      issues.push({
        severity: 'warning',
        entity: entityName,
        field: 'name',
        message: 'Missing field: name',
      });
    }

    // Check ownerId exists
    if (!league.ownerId) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'ownerId',
        message: 'Missing required field: ownerId (league has no owner)',
      });
      isValid = false;
    } else if (league.ownerId !== 'system' && !userIds.has(league.ownerId)) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'ownerId',
        message: `Invalid ownerId: ${league.ownerId} (user does not exist)`,
        details: { ownerId: league.ownerId },
      });
      isValid = false;
    }

    // Check memberUserIds exists and has at least one member
    if (!league.memberUserIds) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'memberUserIds',
        message: 'Missing required field: memberUserIds',
      });
      isValid = false;
    } else if (!Array.isArray(league.memberUserIds)) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'memberUserIds',
        message: 'memberUserIds is not an array',
      });
      isValid = false;
    } else if (league.memberUserIds.length === 0) {
      issues.push({
        severity: 'error',
        entity: entityName,
        field: 'memberUserIds',
        message: 'League has no members (memberUserIds array is empty)',
      });
      isValid = false;
    } else {
      // Validate all member IDs reference existing users
      const invalidMembers = league.memberUserIds.filter(memberId => !userIds.has(memberId));
      if (invalidMembers.length > 0) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          field: 'memberUserIds',
          message: `League contains ${invalidMembers.length} invalid member ID(s) (users do not exist)`,
          details: { invalidMembers },
        });
      }

      // Check that owner is a member (unless system-owned global league)
      if (league.ownerId && league.ownerId !== 'system' && !league.memberUserIds.includes(league.ownerId)) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          field: 'memberUserIds',
          message: `Owner ${league.ownerId} is not in memberUserIds array`,
        });
      }
    }

    // Check for duplicate members
    if (Array.isArray(league.memberUserIds)) {
      const uniqueMembers = new Set(league.memberUserIds);
      if (uniqueMembers.size !== league.memberUserIds.length) {
        issues.push({
          severity: 'warning',
          entity: entityName,
          field: 'memberUserIds',
          message: `League has duplicate members (${league.memberUserIds.length} entries, ${uniqueMembers.size} unique)`,
        });
      }
    }

    // Check isGlobal field
    if (league.isGlobal === undefined) {
      issues.push({
        severity: 'warning',
        entity: entityName,
        field: 'isGlobal',
        message: 'Missing field: isGlobal (defaulting to false)',
      });
    }

    if (isValid) {
      validCount++;
    }
  }

  const hasErrors = issues.some(i => i.severity === 'error');
  const hasWarnings = issues.some(i => i.severity === 'warning');

  return {
    category: 'leagues',
    status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'pass',
    total: leagues.length,
    valid: validCount,
    issues,
  };
}

/**
 * Generate a summary of all check results
 */
export function generateSummary(results: CheckResult[]): ConsistencyCheckSummary {
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  for (const result of results) {
    if (result.status === 'pass') passed++;
    else if (result.status === 'warning') warnings++;
    else if (result.status === 'error') errors++;
  }

  return {
    correlationId: generateConsistencyCorrelationId(),
    timestamp: new Date(),
    results,
    totalChecks: results.length,
    passed,
    warnings,
    errors,
  };
}
