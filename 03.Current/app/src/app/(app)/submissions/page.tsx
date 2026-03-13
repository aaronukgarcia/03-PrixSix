// GUID: PAGE_SUBMISSIONS-000-v04
// [Intent] Submissions page — displays effective predictions for ALL teams for a selected race,
//   combining explicit (manual) submissions and carry-forward (auto) predictions for teams that
//   did not submit for this specific race. Defaults to the first unscored race.
//   Supports league filtering via LeagueSelector and client-side sort by date or team name.
// [Inbound Trigger] User navigates to /submissions in the app layout.
// [Downstream Impact] Reads from Firestore "race_results", "users", and per-user "predictions" subcollections.
//   Two-phase fetch: Phase 1 loads all users + explicit race predictions in parallel;
//   Phase 2 fetches the latest prediction for each team with no explicit submission (carry-forward).

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useFirestore } from "@/firebase";
import { useLeague } from "@/contexts/league-context";
import { LeagueSelector } from "@/components/league/LeagueSelector";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, collectionGroup, query, orderBy, where, limit, getDocs } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileCheck, CalendarClock, Loader2, ArrowUpDown, Clock, Users, RotateCcw, PenLine } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";
import { RaceSchedule, findNextRace, formatDriverPredictions } from "@/lib/data";
import { Button } from "@/components/ui/button";
// @SECURITY_FIX: GEMINI-AUDIT-058 — Import from client-safe registry (no internal metadata).
import { CLIENT_ERRORS as ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { generateRaceId, generateRaceIdLowercase } from "@/lib/normalize-race-id";

// GUID: PAGE_SUBMISSIONS-001-v04
// [Intent] Defines the display shape for a single submission row in the table.
// [Inbound Trigger] Constructed during fetchSubmissions from Firestore prediction documents.
// [Downstream Impact] Drives table row rendering including team name, formatted predictions, timestamp, and carry-forward badge.
interface SubmissionDisplay {
  id: string;
  userId: string;
  teamName: string;
  predictions: string;
  submittedAt: any;
  isCarryForward: boolean;
}

// GUID: PAGE_SUBMISSIONS-002-v04
// [Intent] Union type for the two sortable columns: submission date or team name.
// [Inbound Trigger] Used by sortField state and the sort toggle buttons.
// [Downstream Impact] Controls client-side sort order in the sortedSubmissions memo.
type SortField = "submittedAt" | "teamName";

// GUID: PAGE_SUBMISSIONS-003-v04
// [Intent] Main page component that orchestrates the submissions table with race selection, sorting,
//   and league filtering. Shows ALL teams' effective predictions including carry-forwards.
// [Inbound Trigger] Rendered by Next.js router when user visits /submissions.
// [Downstream Impact] Consumes useFirestore, useLeague hooks and RaceSchedule data.
//   UI changes here affect the primary submission browsing experience for all users.
export default function SubmissionsPage() {
  const firestore = useFirestore();
  const { selectedLeague } = useLeague();

  // Build race list with separate entries for Sprint weekends
  const races = RaceSchedule.flatMap((r) => {
    if (r.hasSprint) {
      return [`${r.name} - Sprint`, r.name];
    }
    return [r.name];
  });

  const nextRace = findNextRace();
  const [selectedRace, setSelectedRace] = useState(nextRace.name);
  const [nextRaceName, setNextRaceName] = useState<string | null>(null);

  // Determine if this is a Sprint race selection
  const isSprintRace = selectedRace.endsWith(' - Sprint');
  const baseRaceName = isSprintRace ? selectedRace.replace(' - Sprint', '') : selectedRace;

  // For submissions, always query for -GP race ID since all predictions are stored with -GP suffix
  // The same prediction is used for both Sprint and GP scoring
  const selectedRaceId = generateRaceId(baseRaceName, 'gp');

  // GUID: PAGE_SUBMISSIONS-004-v04
  // [Intent] Determines the first unscored race by comparing race_results docs against the RaceSchedule,
  //   then defaults the dropdown to that race and marks it for green highlighting.
  // [Inbound Trigger] Runs once when firestore is available on page mount.
  // [Downstream Impact] Sets selectedRace and nextRaceName state. nextRaceName drives the green CSS class on the dropdown item.
  useEffect(() => {
    if (!firestore) return;
    const determineNextUnscored = async () => {
      try {
        const resultsSnapshot = await getDocs(collection(firestore, "race_results"));
        const scoredRaceIds = new Set<string>();
        resultsSnapshot.forEach((doc) => {
          scoredRaceIds.add(doc.id.toLowerCase());
        });

        for (const race of RaceSchedule) {
          const gpId = generateRaceIdLowercase(race.name, 'gp');
          if (!scoredRaceIds.has(gpId)) {
            setNextRaceName(race.name);
            setSelectedRace(race.name);
            return;
          }
        }
        setNextRaceName(null);
      } catch (error) {
        console.error("Error determining next unscored race:", error);
      }
    };
    determineNextUnscored();
  }, [firestore]);

  const [sortField, setSortField] = useState<SortField>("submittedAt");

  // GUID: PAGE_SUBMISSIONS-005-v04
  // [Intent] Raw unsorted submission data. Separated from sorted/filtered views so sort changes
  //   do not trigger a re-fetch — only race changes trigger a network round-trip.
  // [Inbound Trigger] Populated by fetchSubmissions.
  // [Downstream Impact] Source for sortedSubmissions and filteredSubmissions memos.
  const [rawSubmissions, setRawSubmissions] = useState<SubmissionDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GUID: PAGE_SUBMISSIONS-006-v04
  // [Intent] Formats a Firestore timestamp or Date into a human-readable en-GB date/time string.
  // [Inbound Trigger] Called per table row to display the "Submitted At" column.
  // [Downstream Impact] Purely presentational; no downstream data dependencies.
  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // GUID: PAGE_SUBMISSIONS-007-v04
  // [Intent] Delegates to the centralised formatDriverPredictions utility for consistent driver name formatting.
  // [Inbound Trigger] Called per submission document during fetchSubmissions mapping.
  // [Downstream Impact] Output displayed in the "Prediction (P1-P6)" column.
  const formatPredictions = (predictions: any) => {
    return formatDriverPredictions(predictions);
  };

  // GUID: PAGE_SUBMISSIONS-008-v04
  // [Intent] Two-phase fetch that resolves the effective prediction for every team for the selected race.
  //   Phase 1 (parallel): fetches all users and all explicit predictions for this race.
  //   Phase 2 (parallel): for each team with no explicit submission, fetches their most recent
  //   prediction from any prior race as a carry-forward.
  //   This mirrors the scoring engine's carry-forward logic (API_CALCULATE_SCORES-012) but at
  //   display time, so users can see all effective picks before scoring runs.
  // [Inbound Trigger] Fires when firestore or selectedRaceId changes (race dropdown selection).
  // [Downstream Impact] Populates rawSubmissions state. Error display uses PX error codes per Golden Rule #1.
  const fetchSubmissions = useCallback(async () => {
    if (!firestore) return;
    setIsLoading(true);
    setRawSubmissions([]);
    setError(null);

    try {
      // Both stored raceId formats must be checked:
      //   generateRaceId produces "Australian-Grand-Prix-GP" (user submissions)
      //   base form "Australian-Grand-Prix" (carry-forward stored format)
      const raceIdBase = baseRaceName.replace(/\s+/g, '-');

      // Find qualifying time for this race to skip teams that joined after it
      const raceInfo = RaceSchedule.find(r => r.name === baseRaceName);
      const qualifyingTime = raceInfo?.qualifyingTime ? new Date(raceInfo.qualifyingTime) : null;

      // Phase 1 (parallel): all users + explicit race predictions
      const [usersSnapshot, explicitPredSnapshot] = await Promise.all([
        getDocs(collection(firestore, 'users')),
        getDocs(query(
          collectionGroup(firestore, 'predictions'),
          where('raceId', 'in', [selectedRaceId, raceIdBase])
        )),
      ]);

      // Index explicit predictions by userId for O(1) lookup
      const explicitByUserId = new Map<string, any>();
      explicitPredSnapshot.docs.forEach(d => {
        const data = d.data();
        const uid = data.userId || data.teamId;
        if (uid && !explicitByUserId.has(uid)) {
          explicitByUserId.set(uid, data);
        }
      });

      // Partition users into explicit submissions vs carry-forward candidates
      const explicitRows: SubmissionDisplay[] = [];
      const missingUsers: { uid: string; teamName: string }[] = [];

      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        if (!userData.teamName) continue; // Skip accounts without a team

        const uid = userDoc.id;
        const createdAt = userData.createdAt?.toDate?.() || null;

        // Skip teams that joined after this race's qualifying — they had no valid window to submit
        if (qualifyingTime && createdAt && createdAt > qualifyingTime) continue;

        if (explicitByUserId.has(uid)) {
          const data = explicitByUserId.get(uid);
          explicitRows.push({
            id: `${uid}_explicit`,
            userId: uid,
            teamName: data.teamName || userData.teamName,
            predictions: formatPredictions(data.predictions),
            submittedAt: data.submittedAt,
            isCarryForward: false,
          });
        } else {
          missingUsers.push({ uid, teamName: userData.teamName });
        }
      }

      // Phase 2 (parallel): fetch latest prediction for each team with no explicit submission
      const carryForwardRows: SubmissionDisplay[] = [];
      if (missingUsers.length > 0) {
        const cfResults = await Promise.all(
          missingUsers.map(async ({ uid, teamName }) => {
            try {
              const cfSnap = await getDocs(query(
                collection(firestore, `users/${uid}/predictions`),
                orderBy('submittedAt', 'desc'),
                limit(1)
              ));
              if (!cfSnap.empty) {
                const data = cfSnap.docs[0].data();
                return {
                  id: `${uid}_cf`,
                  userId: uid,
                  teamName: data.teamName || teamName,
                  predictions: formatPredictions(data.predictions),
                  submittedAt: data.submittedAt,
                  isCarryForward: true,
                } as SubmissionDisplay;
              }
              return null;
            } catch {
              return null; // Team exists but has no predictions yet
            }
          })
        );
        cfResults.forEach(cf => { if (cf) carryForwardRows.push(cf); });
      }

      setRawSubmissions([...explicitRows, ...carryForwardRows]);
      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching submissions:", error);
      const correlationId = generateClientCorrelationId();
      let errorMsg: string;
      if (error?.code === 'failed-precondition') {
        errorMsg = `Database index required. Please contact an administrator. [${ERRORS.FIRESTORE_INDEX_REQUIRED.code}] (Ref: ${correlationId})`;
      } else if (error?.code === 'permission-denied') {
        errorMsg = `Permission denied. Please sign in again. [${ERRORS.AUTH_PERMISSION_DENIED.code}] (Ref: ${correlationId})`;
      } else {
        errorMsg = `Error loading submissions: ${error?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
      }
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [firestore, selectedRaceId, baseRaceName]);

  // GUID: PAGE_SUBMISSIONS-009-v04
  // [Intent] Triggers fetchSubmissions when firestore or selected race changes.
  //   Sort changes do NOT trigger a re-fetch — sorting is client-side (see PAGE_SUBMISSIONS-010).
  // [Inbound Trigger] firestore availability or selectedRaceId change.
  // [Downstream Impact] Resets and reloads rawSubmissions from Firestore.
  useEffect(() => {
    fetchSubmissions();
  }, [firestore, selectedRaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // GUID: PAGE_SUBMISSIONS-010-v04
  // [Intent] Client-side sort of rawSubmissions by the active sortField.
  //   Sorting here avoids a re-fetch when the user toggles between Date and Team sort.
  // [Inbound Trigger] Recomputed when rawSubmissions or sortField changes.
  // [Downstream Impact] sortedSubmissions feeds into filteredSubmissions.
  const sortedSubmissions = useMemo(() => {
    return [...rawSubmissions].sort((a, b) => {
      if (sortField === 'teamName') {
        return a.teamName.localeCompare(b.teamName);
      }
      // Date sort: most recent first; carry-forwards (original submittedAt) sort last naturally
      const aTime = a.submittedAt?.toDate?.()?.getTime?.() ?? 0;
      const bTime = b.submittedAt?.toDate?.()?.getTime?.() ?? 0;
      return bTime - aTime;
    });
  }, [rawSubmissions, sortField]);

  // GUID: PAGE_SUBMISSIONS-011-v04
  // [Intent] Filters the sorted submissions list to only members of the selected league (or shows all if global).
  // [Inbound Trigger] Recomputed when sortedSubmissions or selectedLeague changes.
  // [Downstream Impact] filteredSubmissions is the array rendered in the table.
  const filteredSubmissions = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return sortedSubmissions;
    }
    return sortedSubmissions.filter(sub => selectedLeague.memberUserIds.includes(sub.userId));
  }, [sortedSubmissions, selectedLeague]);

  const manualCount = filteredSubmissions.filter(s => !s.isCarryForward).length;
  const autoCount = filteredSubmissions.filter(s => s.isCarryForward).length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Current Submissions
        </h1>
        <p className="text-muted-foreground">
          View locked-in predictions for each team.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="w-5 h-5" />
                Locked-In Predictions
              </CardTitle>
              <CardDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span>Current predictions for each team.</span>
                <LastUpdated timestamp={lastUpdated} />
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <LeagueSelector className="w-full sm:w-[180px]" />
              <div className="relative w-full sm:w-[220px]">
                <Select value={selectedRace} onValueChange={setSelectedRace}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a race" />
                  </SelectTrigger>
                  <SelectContent>
                    {races.map((race) => (
                      <SelectItem key={race} value={race} className={race === nextRaceName ? "text-green-600 font-semibold" : ""}>
                        {race}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isLoading && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant={sortField === "submittedAt" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setSortField("submittedAt")}
                >
                  <Clock className="h-3 w-3" />
                  Date
                </Button>
                <Button
                  variant={sortField === "teamName" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setSortField("teamName")}
                >
                  <Users className="h-3 w-3" />
                  Team
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error display */}
          {error && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-destructive text-sm select-all cursor-text">{error}</p>
            </div>
          )}

          {/* Summary counts */}
          {!isLoading && !error && filteredSubmissions.length > 0 && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{filteredSubmissions.length} team{filteredSubmissions.length !== 1 ? 's' : ''}</span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <PenLine className="h-3 w-3 text-green-600" />
                {manualCount} manual
              </span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3 text-amber-600" />
                {autoCount} carry-forward
              </span>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className={`cursor-pointer hover:bg-muted/50 ${sortField === "teamName" ? "text-foreground" : ""}`}
                  onClick={() => setSortField("teamName")}
                >
                  <span className="flex items-center gap-1">
                    Team
                    {sortField === "teamName" && <ArrowUpDown className="h-3 w-3" />}
                  </span>
                </TableHead>
                <TableHead>Prediction (P1-P6)</TableHead>
                <TableHead
                  className={`cursor-pointer hover:bg-muted/50 ${sortField === "submittedAt" ? "text-foreground" : ""}`}
                  onClick={() => setSortField("submittedAt")}
                >
                  <span className="flex items-center gap-1">
                    Submitted At
                    {sortField === "submittedAt" && <ArrowUpDown className="h-3 w-3" />}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredSubmissions.length > 0 ? (
                filteredSubmissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="font-semibold">
                      <div className="flex items-center gap-2">
                        {submission.teamName}
                        {submission.isCarryForward ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700">
                            <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
                            Auto
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700">
                            <PenLine className="h-2.5 w-2.5 mr-0.5" />
                            Manual
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {submission.predictions}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        {formatTimestamp(submission.submittedAt)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center h-24 text-muted-foreground"
                  >
                    No submissions for this race yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
