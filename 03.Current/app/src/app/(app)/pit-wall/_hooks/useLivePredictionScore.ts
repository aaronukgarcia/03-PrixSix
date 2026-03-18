// GUID: HOOK_LIVE_PREDICTION_SCORE-000-v01
// [Intent] Custom hook that computes a live prediction score for the logged-in user
//          by matching their submitted predictions against real-time driver positions
//          from the Pit Wall data feed. Supports primary and secondary teams.
//          Score recalculates on every poll cycle as positions change.
// [Inbound Trigger] Called by PitWallClient when activeDrivers or auth state changes.
// [Downstream Impact] Returns score data consumed by LiveScoreBanner component.
//          Reads from Firestore: users/{uid}/predictions/{teamId}_{raceId}.

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, getDoc, Firestore } from 'firebase/firestore';
import { useAuth, useFirestore } from '@/firebase';
import { getDriverCode, RaceSchedule } from '@/lib/data';
import { calculateDriverPoints, SCORING_POINTS, SCORING_DERIVED } from '@/lib/scoring-rules';
import { generateRaceId } from '@/lib/normalize-race-id';
import type { DriverRaceState } from '../_types/pit-wall.types';

// GUID: HOOK_LIVE_PREDICTION_SCORE-001-v01
// [Intent] Per-driver score breakdown for the banner display.
export interface DriverScoreBreakdown {
  driverId: string;
  driverCode: string;
  predictedPosition: number;   // 0-based index in predictions array
  actualPosition: number | null; // 1-based race position, null if not on track
  points: number;
  isExact: boolean;
  inTopSix: boolean;
}

// GUID: HOOK_LIVE_PREDICTION_SCORE-002-v01
// [Intent] Full score state returned by the hook.
export interface LivePredictionScore {
  totalPoints: number;
  maxPoints: number;
  bonusEarned: boolean;
  breakdown: DriverScoreBreakdown[];
  teamName: string | null;
  raceName: string | null;
  isLoading: boolean;
  hasPredictions: boolean;
  selectedTeamType: 'primary' | 'secondary';
  setSelectedTeamType: (type: 'primary' | 'secondary') => void;
  hasSecondaryTeam: boolean;
}

// GUID: HOOK_LIVE_PREDICTION_SCORE-003-v01
// [Intent] Build a lookup from 3-letter driver code to their current race position.
//          OpenF1 driverCode ("VER") matches getDriverCode("verstappen") → "VER".
function buildCodeToPositionMap(drivers: DriverRaceState[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of drivers) {
    if (d.driverCode && d.position > 0) {
      map.set(d.driverCode.toUpperCase(), d.position);
    }
  }
  return map;
}

// GUID: HOOK_LIVE_PREDICTION_SCORE-004-v01
// [Intent] Match an OpenF1 meeting name to a 2026 RaceSchedule entry.
//          Returns null if no match (e.g. 2025 replay with no 2026 equivalent).
function findMatchingRace(meetingName: string): typeof RaceSchedule[number] | null {
  const lower = meetingName.toLowerCase();
  return RaceSchedule.find(r => r.name.toLowerCase() === lower) ?? null;
}

// GUID: HOOK_LIVE_PREDICTION_SCORE-005-v01
// [Intent] Core hook — fetches predictions from Firestore when race/user changes,
//          then recalculates score on every activeDrivers update.
export function useLivePredictionScore(
  activeDrivers: DriverRaceState[],
  meetingName: string | null,
  sessionType: string | null,
): LivePredictionScore {
  const { user } = useAuth();
  const firestore = useFirestore();
  const [predictions, setPredictions] = useState<string[] | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTeamType, setSelectedTeamType] = useState<'primary' | 'secondary'>('primary');

  const lastFetchKey = useRef<string | null>(null);
  const hasSecondaryTeam = !!user?.secondaryTeamName;

  // GUID: HOOK_LIVE_PREDICTION_SCORE-006-v01
  // [Intent] Fetch user's prediction document from Firestore when race or team selection changes.
  //          Determines sprint vs GP from sessionType. Matches meetingName to RaceSchedule.
  useEffect(() => {
    if (!firestore || !user || !meetingName) {
      setPredictions(null);
      setTeamName(null);
      return;
    }

    const race = findMatchingRace(meetingName);
    if (!race) {
      setPredictions(null);
      setTeamName(null);
      return;
    }

    const isSprint = sessionType?.toLowerCase().includes('sprint') ?? false;
    const raceId = generateRaceId(race.name, isSprint ? 'sprint' : 'gp');
    const teamId = selectedTeamType === 'secondary' ? `${user.id}-secondary` : user.id;
    const predDocId = `${teamId}_${raceId}`;
    const fetchKey = predDocId;

    if (fetchKey === lastFetchKey.current) return;
    lastFetchKey.current = fetchKey;

    setIsLoading(true);
    const predRef = doc(firestore as Firestore, 'users', user.id, 'predictions', predDocId);
    getDoc(predRef)
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          setPredictions(data.predictions ?? null);
          setTeamName(
            data.teamName
            ?? (selectedTeamType === 'secondary' ? user.secondaryTeamName : user.teamName)
            ?? null
          );
        } else {
          setPredictions(null);
          setTeamName(
            (selectedTeamType === 'secondary' ? user.secondaryTeamName : user.teamName) ?? null
          );
        }
        setIsLoading(false);
      })
      .catch(() => {
        setPredictions(null);
        setIsLoading(false);
      });
  }, [firestore, user, meetingName, sessionType, selectedTeamType]);

  // Reset fetch key when team type changes to force re-fetch
  const handleSetTeamType = useCallback((type: 'primary' | 'secondary') => {
    lastFetchKey.current = null;
    setSelectedTeamType(type);
  }, []);

  // GUID: HOOK_LIVE_PREDICTION_SCORE-007-v01
  // [Intent] Compute live score by matching predictions against current driver positions.
  //          Runs on every activeDrivers change (every poll cycle) for real-time scoring.
  const scoreResult = useMemo(() => {
    if (!predictions || predictions.length === 0 || activeDrivers.length === 0) {
      return {
        totalPoints: 0,
        maxPoints: SCORING_DERIVED.maxPointsPerRace,
        bonusEarned: false,
        breakdown: [] as DriverScoreBreakdown[],
        hasPredictions: !!predictions && predictions.length > 0,
      };
    }

    const codeToPos = buildCodeToPositionMap(activeDrivers);
    const breakdown: DriverScoreBreakdown[] = [];
    let totalPoints = 0;
    let allInTopSix = true;

    for (let i = 0; i < predictions.length; i++) {
      const driverId = predictions[i];
      const code = getDriverCode(driverId);
      const actualPos = codeToPos.get(code) ?? null;

      // calculateDriverPoints uses 0-based indices.
      // predictedPosition (i) is 0-based (index 0 = P1 prediction).
      // actualPosition from OpenF1 is 1-based, convert to 0-based: (actualPos - 1).
      // If not in top 6, pass -1.
      const actualIndex = actualPos !== null && actualPos >= 1 && actualPos <= 6
        ? actualPos - 1
        : -1;

      const points = calculateDriverPoints(i, actualIndex);
      const inTopSix = actualIndex !== -1;
      if (!inTopSix) allInTopSix = false;

      totalPoints += points;
      breakdown.push({
        driverId,
        driverCode: code,
        predictedPosition: i,
        actualPosition: actualPos,
        points,
        isExact: actualPos !== null && (actualPos - 1) === i,
        inTopSix,
      });
    }

    const bonusEarned = allInTopSix && predictions.length === 6;
    if (bonusEarned) {
      totalPoints += SCORING_POINTS.bonusAll6;
    }

    return {
      totalPoints,
      maxPoints: SCORING_DERIVED.maxPointsPerRace,
      bonusEarned,
      breakdown,
      hasPredictions: true,
    };
  }, [predictions, activeDrivers]);

  return {
    ...scoreResult,
    teamName,
    raceName: meetingName,
    isLoading,
    selectedTeamType,
    setSelectedTeamType: handleSetTeamType,
    hasSecondaryTeam,
  };
}
