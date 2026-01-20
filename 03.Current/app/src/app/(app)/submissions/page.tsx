"use client";

import { useState, useEffect, useCallback } from "react";
import { useFirestore } from "@/firebase";
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
import { collection, query, orderBy, where, limit, startAfter, getDocs, getCountFromServer, DocumentSnapshot } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck, CalendarClock, ChevronDown, Loader2, ArrowUpDown, Clock, Users } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";
import { RaceSchedule, findNextRace } from "@/lib/data";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface SubmissionDisplay {
  id: string;
  teamName: string;
  predictions: string;
  submittedAt: any;
}

const PAGE_SIZE = 25;

type SortField = "submittedAt" | "teamName";

export default function SubmissionsPage() {
  const firestore = useFirestore();
  const races = RaceSchedule.map((r) => r.name);
  const nextRace = findNextRace();
  const [selectedRace, setSelectedRace] = useState(nextRace.name);
  const selectedRaceId = selectedRace.replace(/\s+/g, '-');

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

  const formatPredictions = (predictions: any) => {
    if (!predictions) return "N/A";
    // Handle both object format {P1, P2, ...} and array format
    if (Array.isArray(predictions)) {
      return predictions.join(", ");
    }
    return `${predictions.P1 || '?'}, ${predictions.P2 || '?'}, ${predictions.P3 || '?'}, ${predictions.P4 || '?'}, ${predictions.P5 || '?'}, ${predictions.P6 || '?'}`;
  };

  // Fetch count for selected race
  useEffect(() => {
    if (!firestore || !selectedRaceId) return;

    const fetchCount = async () => {
      try {
        const countQuery = query(
          collection(firestore, "prediction_submissions"),
          where("raceId", "==", selectedRaceId)
        );
        const countSnapshot = await getCountFromServer(countQuery);
        setTotalCount(countSnapshot.data().count);
      } catch (error) {
        console.error("Error fetching count:", error);
        setTotalCount(null);
      }
    };
    fetchCount();
  }, [firestore, selectedRaceId]);

  // Fetch submissions with pagination
  const fetchSubmissions = useCallback(async (isLoadMore = false) => {
    if (!firestore) return;

    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setSubmissions([]);
      setLastDoc(null);
    }

    try {
      // Determine sort direction: descending for date (newest first), ascending for team name
      const sortDirection = sortField === "submittedAt" ? "desc" : "asc";

      // Query submissions for selected race only
      let submissionsQuery = query(
        collection(firestore, "prediction_submissions"),
        where("raceId", "==", selectedRaceId),
        orderBy(sortField, sortDirection),
        limit(PAGE_SIZE)
      );

      if (isLoadMore && lastDoc) {
        submissionsQuery = query(
          collection(firestore, "prediction_submissions"),
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
          teamName: data.teamName || "Unknown Team",
          predictions: formatPredictions(data.predictions),
          submittedAt: data.submittedAt,
        };
      });

      if (isLoadMore) {
        setSubmissions((prev) => [...prev, ...newSubmissions]);
      } else {
        setSubmissions(newSubmissions);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error fetching submissions:", error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [firestore, selectedRaceId, lastDoc, sortField]);

  // Initial load and race/sort change
  useEffect(() => {
    fetchSubmissions(false);
  }, [firestore, selectedRaceId, sortField]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    fetchSubmissions(true);
  };

  const progressPercent = totalCount && totalCount > 0
    ? Math.round((submissions.length / totalCount) * 100)
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
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={selectedRace} onValueChange={setSelectedRace}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Select a race" />
                </SelectTrigger>
                <SelectContent>
                  {races.map((race) => (
                    <SelectItem key={race} value={race}>
                      {race}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          {/* Progress indicator */}
          {!isLoading && totalCount && totalCount > PAGE_SIZE && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {submissions.length} of {totalCount} teams</span>
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
              ) : submissions.length > 0 ? (
                submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="font-semibold">
                      {submission.teamName}
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
          {hasMore && !isLoading && submissions.length > 0 && (
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
