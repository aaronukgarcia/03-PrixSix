// GUID: PAGE_SUBMISSIONS-000-v03
// [Intent] Submissions page — displays locked-in predictions for all teams for a selected race in a sortable,
//   paginated table. Defaults to the first unscored race (highlighted green in the dropdown).
//   Supports league filtering via LeagueSelector and sort toggle between date and team name.
// [Inbound Trigger] User navigates to /submissions in the app layout.
// [Downstream Impact] Reads from Firestore "scores" collection and "predictions" collectionGroup.
//   Changes to prediction document schema or collectionGroup indexes will break data fetching.

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
import { collection, collectionGroup, query, orderBy, where, limit, startAfter, getDocs, getCountFromServer, DocumentSnapshot } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileCheck, CalendarClock, ChevronDown, Loader2, ArrowUpDown, Clock, Users, RotateCcw, PenLine } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";
import { RaceSchedule, findNextRace, formatDriverPredictions } from "@/lib/data";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { generateRaceId, generateRaceIdLowercase } from "@/lib/normalize-race-id";

// GUID: PAGE_SUBMISSIONS-001-v03
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

const PAGE_SIZE = 25;

// GUID: PAGE_SUBMISSIONS-002-v03
// [Intent] Union type for the two sortable columns: submission date or team name.
// [Inbound Trigger] Used by sortField state and the sort toggle buttons.
// [Downstream Impact] Controls the Firestore orderBy clause in fetchSubmissions — changing allowed values requires index updates.
type SortField = "submittedAt" | "teamName";

// GUID: PAGE_SUBMISSIONS-003-v03
// [Intent] Main page component that orchestrates the submissions table with race selection, sorting,
//   pagination, and league filtering for viewing locked-in predictions.
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

  // GUID: PAGE_SUBMISSIONS-004-v03
  // [Intent] Determines the first unscored race by comparing all scores in Firestore against the RaceSchedule,
  //   then defaults the dropdown to that race and marks it for green highlighting.
  // [Inbound Trigger] Runs once when firestore is available on page mount.
  // [Downstream Impact] Sets selectedRace and nextRaceName state. nextRaceName drives the green CSS class on the dropdown item.
  useEffect(() => {
    if (!firestore) return;
    const determineNextUnscored = async () => {
      try {
        const scoresSnapshot = await getDocs(collection(firestore, "scores"));
        const scoredRaceIds = new Set<string>();
        scoresSnapshot.forEach((doc) => {
          const raceId = doc.data().raceId;
          if (raceId) scoredRaceIds.add(String(raceId).toLowerCase());
        });

        for (const race of RaceSchedule) {
          const gpId = generateRaceIdLowercase(race.name, 'gp');
          const baseId = race.name.replace(/\s+/g, "-").toLowerCase(); // Keep for backward compatibility
          if (!scoredRaceIds.has(gpId) && !scoredRaceIds.has(baseId)) {
            setNextRaceName(race.name);
            setSelectedRace(race.name);
            return;
          }
        }
        // All races scored — no green highlight, keep findNextRace() default
        setNextRaceName(null);
      } catch (error) {
        console.error("Error determining next unscored race:", error);
        // Fallback: keep findNextRace() default, no green highlight
      }
    };
    determineNextUnscored();
  }, [firestore]);

  // Sort state - default to date/time (most recent first)
  const [sortField, setSortField] = useState<SortField>("submittedAt");

  // Pagination state
  const [submissions, setSubmissions] = useState<SubmissionDisplay[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GUID: PAGE_SUBMISSIONS-005-v03
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

  // GUID: PAGE_SUBMISSIONS-006-v03
  // [Intent] Delegates to the centralised formatDriverPredictions utility for consistent driver name formatting.
  // [Inbound Trigger] Called per submission document during fetchSubmissions mapping.
  // [Downstream Impact] Output displayed in the "Prediction (P1-P6)" column. Relies on data.ts formatDriverPredictions.
  // Use centralized driver name formatting from data.ts
  // This ensures consistent driver name display (e.g., "Hamilton" not "hamilton")
  const formatPredictions = (predictions: any) => {
    return formatDriverPredictions(predictions);
  };

  // GUID: PAGE_SUBMISSIONS-007-v03
  // [Intent] Fetches the total prediction count for the selected race using Firestore server-side aggregation.
  // [Inbound Trigger] Runs whenever selectedRaceId changes (race dropdown selection).
  // [Downstream Impact] Populates totalCount used for the progress bar. Non-critical — count errors are silently ignored.
  useEffect(() => {
    if (!firestore || !selectedRaceId) return;

    const fetchCount = async () => {
      try {
        const countQuery = query(
          collectionGroup(firestore, "predictions"),
          where("raceId", "==", selectedRaceId)
        );
        const countSnapshot = await getCountFromServer(countQuery);
        setTotalCount(countSnapshot.data().count);
      } catch (error: any) {
        console.error("Error fetching count:", error);
        setTotalCount(null);
        // Count errors are non-critical, don't show to user
      }
    };
    fetchCount();
  }, [firestore, selectedRaceId]);

  // GUID: PAGE_SUBMISSIONS-008-v04
  // [Intent] Fetches paginated submission data from the "predictions" collectionGroup filtered by raceId,
  //   sorted by the current sortField. Supports both initial load and "Load More" pagination.
  // [Inbound Trigger] Called on initial load, race change, sort change, and "Load More" button click.
  // [Downstream Impact] Populates submissions state array rendered in the table. Error display uses PX error codes
  //   with correlation IDs per Golden Rule #1. Requires Firestore composite indexes on predictions collectionGroup.
  const fetchSubmissions = useCallback(async (isLoadMore = false) => {
    if (!firestore) return;

    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setSubmissions([]);
      setLastDoc(null);
      setError(null); // Clear any previous errors
    }

    try {
      // Determine sort direction: descending for date (newest first), ascending for team name
      const sortDirection = sortField === "submittedAt" ? "desc" : "asc";

      // Query predictions from user subcollections using collectionGroup
      let submissionsQuery = query(
        collectionGroup(firestore, "predictions"),
        where("raceId", "==", selectedRaceId),
        orderBy(sortField, sortDirection),
        limit(PAGE_SIZE)
      );

      if (isLoadMore && lastDoc) {
        submissionsQuery = query(
          collectionGroup(firestore, "predictions"),
          where("raceId", "==", selectedRaceId),
          orderBy(sortField, sortDirection),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const snapshot = await getDocs(submissionsQuery);

      if (snapshot.empty && !isLoadMore) {
        setHasMore(false);
        setSubmissions([]);
        setLastUpdated(new Date());
        return;
      }

      // Update pagination state
      if (snapshot.docs.length > 0) {
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      }
      setHasMore(snapshot.docs.length === PAGE_SIZE);

      // Map to display format
      const newSubmissions: SubmissionDisplay[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId || data.oduserId || "",
          teamName: data.teamName || "Unknown Team",
          predictions: formatPredictions(data.predictions),
          submittedAt: data.submittedAt,
          isCarryForward: data.isCarryForward === true,
        };
      });

      if (isLoadMore) {
        setSubmissions((prev) => [...prev, ...newSubmissions]);
      } else {
        setSubmissions(newSubmissions);
      }

      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching submissions:", error);
      const correlationId = generateClientCorrelationId();
      let errorMsg: string;
      if (error?.code === 'failed-precondition') {
        errorMsg = `Database index required. Please contact an administrator. [${ERRORS.FIRESTORE_INDEX_REQUIRED.code}] (Ref: ${correlationId})`;
        console.error(`[Submissions Index Error ${correlationId}]`, error?.message);
      } else if (error?.code === 'permission-denied') {
        errorMsg = `Permission denied. Please sign in again. [${ERRORS.AUTH_PERMISSION_DENIED.code}] (Ref: ${correlationId})`;
      } else {
        errorMsg = `Error loading submissions: ${error?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
      }
      setError(errorMsg);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [firestore, selectedRaceId, lastDoc, sortField]);

  // GUID: PAGE_SUBMISSIONS-009-v03
  // [Intent] Triggers fetchSubmissions on initial page load and whenever the race or sort field changes.
  // [Inbound Trigger] Dependency on firestore, selectedRaceId, and sortField state changes.
  // [Downstream Impact] Resets and reloads the submissions list from Firestore.
  useEffect(() => {
    fetchSubmissions(false);
  }, [firestore, selectedRaceId, sortField]); // eslint-disable-line react-hooks/exhaustive-deps

  // GUID: PAGE_SUBMISSIONS-010-v03
  // [Intent] Delegates to fetchSubmissions with isLoadMore=true for paginated loading.
  // [Inbound Trigger] User clicks "Load More Teams" button at the bottom of the table.
  // [Downstream Impact] Appends the next page of submissions to the existing array.
  const loadMore = () => {
    fetchSubmissions(true);
  };

  // GUID: PAGE_SUBMISSIONS-011-v03
  // [Intent] Filters the full submissions list to only members of the selected league (or shows all if global).
  // [Inbound Trigger] Recomputed when submissions array or selectedLeague changes.
  // [Downstream Impact] filteredSubmissions is the array rendered in the table; league filtering affects visible row count.
  const filteredSubmissions = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return submissions;
    }
    return submissions.filter(sub => selectedLeague.memberUserIds.includes(sub.userId));
  }, [submissions, selectedLeague]);

  const progressPercent = totalCount && totalCount > 0
    ? Math.round((filteredSubmissions.length / totalCount) * 100)
    : 0;

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

          {/* Progress indicator */}
          {!isLoading && !error && totalCount && totalCount > PAGE_SIZE && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {filteredSubmissions.length} of {totalCount} teams</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
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

          {/* Load more button */}
          {hasMore && !isLoading && filteredSubmissions.length > 0 && (
            <div className="flex justify-center pt-4">
              {isLoadingMore ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : (
                <Button variant="outline" onClick={loadMore} className="gap-2">
                  <ChevronDown className="h-4 w-4" />
                  Load More Teams
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
