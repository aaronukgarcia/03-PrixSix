// GUID: LIB_RESULTS_UTILS-000-v02
// @BUG_FIX: GEMINI-AUDIT-122 — getBaseRaceId now preserves -Sprint suffix for Sprint races.
//   Previously: getBaseRaceId("Chinese-Grand-Prix-Sprint") returned "Chinese-Grand-Prix" (baseName
//   has no Sprint suffix) → results page queried wrong raceId → 0 Sprint predictions found.
//   Fixed by checking event.isSprint and appending "-Sprint" when true.
// [Intent] Shared types, constants, and pure functions for race results display.
//   Extracted from results/page.tsx so both /results and /my-results pages can
//   share scoring display logic without duplication.
// [Inbound Trigger] Imported by results/page.tsx and my-results/page.tsx.
// [Downstream Impact] Changes to scoring display logic or colour coding propagate
//   to both pages simultaneously.

import { RaceSchedule, F1Drivers } from "@/lib/data";
import { calculateDriverPoints, SCORING_POINTS } from "@/lib/scoring-rules";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal } from "lucide-react";
import { generateRaceId } from "@/lib/normalize-race-id";

// GUID: LIB_RESULTS_UTILS-001-v01
// [Intent] Score type enum for colour-coded display — maps position difference to grade (A=exact, E=miss).
export type ScoreType = 'A' | 'B' | 'C' | 'D' | 'E';

// GUID: LIB_RESULTS_UTILS-002-v01
// [Intent] Type for a single driver within a team's prediction — includes predicted/actual positions,
//   points scored, and the score type grade for colour coding.
export interface DriverPrediction {
    driverId: string;
    driverName: string;
    position: number;
    actualPosition: number;
    isCorrect: boolean;
    isExactPosition: boolean;
    points: number;
    scoreType: ScoreType;
}

// GUID: LIB_RESULTS_UTILS-003-v01
// [Intent] Type for the official race result document — stores the actual top-6 driver finish order.
export interface RaceResult {
    id: string;
    raceId: string;
    driver1: string;
    driver2: string;
    driver3: string;
    driver4: string;
    driver5: string;
    driver6: string;
    submittedAt: any;
}

// GUID: LIB_RESULTS_UTILS-004-v02
// [Intent] Type for a score document associated with a team's race performance.
// Golden Rule #3: Removed breakdown field (denormalized data) - calculate in real-time instead.
export interface Score {
    id: string;
    oduserId: string;
    teamName: string;
    raceId: string;
    totalPoints: number;
}

// GUID: LIB_RESULTS_UTILS-005-v02
// [Intent] Type for a team's complete result for a race.
// Golden Rule #3: Removed breakdown field - use predictions array for display instead.
export interface TeamResult {
    teamName: string;
    oduserId: string;
    predictions: DriverPrediction[];
    totalPoints: number | null;
    hasScore: boolean;
    bonusPoints: number;
    rank?: number;
}

// GUID: LIB_RESULTS_UTILS-006-v01
// [Intent] Type for a race event entry in the events list (GP or Sprint).
export interface RaceEvent {
    id: string;
    label: string;
    baseName: string;
    isSprint: boolean;
    raceTime: string;
}

// GUID: LIB_RESULTS_UTILS-007-v01
// [Intent] Build a flat list of all race events (GP + Sprint) from the RaceSchedule.
export function buildRaceEvents(): RaceEvent[] {
    return RaceSchedule.flatMap(race => {
        const events: RaceEvent[] = [];
        if (race.hasSprint) {
            events.push({
                id: generateRaceId(race.name, 'sprint'),
                label: `${race.name} - Sprint`,
                baseName: race.name,
                isSprint: true,
                raceTime: race.qualifyingTime,
            });
        }
        events.push({
            id: generateRaceId(race.name, 'gp'),
            label: `${race.name} - GP`,
            baseName: race.name,
            isSprint: false,
            raceTime: race.raceTime,
        });
        return events;
    });
}

// GUID: LIB_RESULTS_UTILS-008-v01
// [Intent] Module-level constant of all race events — avoids recomputation on every render.
export const allRaceEvents = buildRaceEvents();

// GUID: LIB_RESULTS_UTILS-009-v01
// [Intent] Map a predicted vs actual position difference to a score type grade (A-E).
export function getScoreType(predictedPosition: number, actualPosition: number): ScoreType {
    if (actualPosition === -1) return 'E';
    const diff = Math.abs(predictedPosition - actualPosition);
    if (diff === 0) return 'A';
    if (diff === 1) return 'B';
    if (diff === 2) return 'C';
    return 'D';
}

// GUID: LIB_RESULTS_UTILS-010-v01
// [Intent] Map score type grades (A-E) to Tailwind CSS colour classes.
export function getScoreTypeColor(scoreType: ScoreType): string {
    switch (scoreType) {
        case 'A': return 'text-green-500';
        case 'B': return 'text-emerald-400';
        case 'C': return 'text-yellow-400';
        case 'D': return 'text-orange-500';
        case 'E': return 'text-red-500';
        default: return 'text-muted-foreground';
    }
}

// GUID: LIB_RESULTS_UTILS-011-v01
// [Intent] Parse a team's raw predictions and compare against actual top-6 results
//   to produce per-driver scoring with points and score types. Pure function — no hooks.
export function parsePredictions(predictions: any, actualTop6: string[] | null): DriverPrediction[] {
    if (!predictions) return [];

    let driverIds: string[] = [];

    if (predictions.P1 !== undefined) {
        driverIds = [
            predictions.P1, predictions.P2, predictions.P3,
            predictions.P4, predictions.P5, predictions.P6
        ].filter(Boolean);
    } else if (Array.isArray(predictions)) {
        driverIds = predictions;
    }

    const normalizedActual = actualTop6 ? actualTop6.map(d => d?.toLowerCase()) : null;

    return driverIds.map((driverId, index) => {
        const normalizedDriverId = driverId?.toLowerCase();
        const driver = F1Drivers.find(d => d.id === normalizedDriverId);
        const actualIndex = normalizedActual ? normalizedActual.indexOf(normalizedDriverId) : -1;
        const isCorrect = actualIndex !== -1;
        const isExactPosition = actualIndex === index;

        const points = calculateDriverPoints(index, actualIndex);
        const scoreType = getScoreType(index, actualIndex);

        return {
            driverId: normalizedDriverId,
            driverName: driver?.name || driverId,
            position: index + 1,
            actualPosition: actualIndex,
            isCorrect,
            isExactPosition,
            points,
            scoreType,
        };
    });
}

// GUID: LIB_RESULTS_UTILS-012-v01
// [Intent] Calculate bonus points — awards 10 points if all 6 predicted drivers are in the top 6.
export function calculateBonus(correctCount: number): number {
    if (correctCount === 6) return SCORING_POINTS.bonusAll6;
    return 0;
}

// GUID: LIB_RESULTS_UTILS-013-v01
// [Intent] Calculate effective points for a team — uses stored score if available,
//   otherwise calculates from predictions + bonus when race results exist.
export function getEffectivePoints(team: TeamResult, hasRaceResult: boolean): number {
    if (team.hasScore && team.totalPoints !== null) {
        return team.totalPoints;
    }
    if (hasRaceResult) {
        return team.predictions.reduce((sum, p) => sum + p.points, 0) + team.bonusPoints;
    }
    return -1;
}

// GUID: LIB_RESULTS_UTILS-014-v01
// [Intent] Format a Firestore timestamp into a human-readable UK date-time string.
export function formatResultTimestamp(timestamp: any): string | null {
    if (!timestamp) return null;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// GUID: LIB_RESULTS_UTILS-015-v02
// @BUG_FIX: GEMINI-AUDIT-122 — Sprint races now return "Base-Name-Sprint" instead of just "Base-Name".
//   Previously event.baseName had no Sprint suffix, so Sprint predictions were never found.
//   Sprint predictions are stored with "-Sprint" suffix (via generateRaceId/normalizeRaceId);
//   the query raceId must match. GP races strip -GP to match pre-case-fix stored predictions.
//   Fallback: strip -GP only, preserve -Sprint for consistency.
// [Intent] Convert a full event ID (with -GP or -Sprint suffix) to the base race ID
//   matching how predictions are stored in Firestore. Sprint races preserve the -Sprint suffix;
//   GP races strip -GP. This matches how submit-prediction and calculate-scores store raceId.
// [Inbound Trigger] Called from results/page.tsx and my-results/page.tsx before querying predictions.
// [Downstream Impact] Drives collectionGroup query for predictions — wrong value returns 0 results.
export function getBaseRaceId(eventId: string): string {
    const event = allRaceEvents.find(e => e.id.toLowerCase() === eventId.toLowerCase());
    if (event) {
        const baseId = event.baseName.replace(/\s+/g, '-');
        // Sprint races: append -Sprint so predictions can be found (stored as "Name-Sprint")
        // GP races: return base name only (stored without -GP suffix)
        return event.isSprint ? `${baseId}-Sprint` : baseId;
    }
    // Fallback: strip -GP only, preserve -Sprint
    return eventId.replace(/-GP$/i, '');
}

// GUID: LIB_RESULTS_UTILS-016-v01
// [Intent] Race rank badge component for 1st, 2nd, 3rd place finishers. Pure presentational.
export const RaceRankBadge = ({ rank }: { rank: number }) => {
    if (rank === 1) {
        return (
            <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700">
                <Trophy className="h-3 w-3 mr-0.5" />
                1st
            </Badge>
        );
    }
    if (rank === 2) {
        return (
            <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600">
                <Medal className="h-3 w-3 mr-0.5" />
                2nd
            </Badge>
        );
    }
    if (rank === 3) {
        return (
            <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px] bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700">
                <Medal className="h-3 w-3 mr-0.5" />
                3rd
            </Badge>
        );
    }
    return null;
};
