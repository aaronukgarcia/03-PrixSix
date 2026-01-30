// GUID: PAGE_AUDIT-000-v03
// [Intent] Submission audit page — displays a paginated table of all prediction submissions
//          across the league. Fetches from audit_logs collection filtered to prediction_submitted actions.
// [Inbound Trigger] User navigates to /audit from navigation.
// [Downstream Impact] Reads audit_logs (paginated) and users collections from Firestore.
//                     Displays team names, race names, predictions, and timestamps.

"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useCollection, useFirestore } from "@/firebase";
import type { User } from "@/firebase/provider";
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
import { Button } from "@/components/ui/button";
import { collection, query, orderBy, where, limit, startAfter, getDocs, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { History, CalendarClock, AlertCircle, ChevronRight, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LastUpdated } from "@/components/ui/last-updated";
import { formatDriverPredictions } from "@/lib/data";

// GUID: PAGE_AUDIT-001-v03
// [Intent] Page size constant for paginated audit log queries.
// [Inbound Trigger] Used by fetchAuditLogs query and "Load More" button label.
// [Downstream Impact] Controls how many audit_logs documents are fetched per page.
const PAGE_SIZE = 100;

// GUID: PAGE_AUDIT-002-v03
// [Intent] TypeScript interface for audit log entries — defines the shape of prediction_submitted events.
// [Inbound Trigger] Used as type parameter in state and mapped results.
// [Downstream Impact] Provides type safety for audit log rendering and team name resolution.
interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  details: {
    teamName?: string;
    raceName?: string;
    raceId?: string;
    predictions?: string[];
    submittedAt?: string;
  };
  timestamp: any;
}

// GUID: PAGE_AUDIT-003-v03
// [Intent] Main audit page component — manages paginated audit log fetching, user lookup,
//          and renders the submission history table with load-more pagination.
// [Inbound Trigger] Route navigation to /audit.
// [Downstream Impact] Reads audit_logs (filtered to prediction_submitted, ordered by timestamp desc)
//                     and users collection. Displays formatted predictions via formatDriverPredictions.
export default function AuditPage() {
  const firestore = useFirestore();

  // Pagination state
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // GUID: PAGE_AUDIT-004-v03
  // [Intent] Real-time query for all users — provides team name lookup for audit log entries.
  // [Inbound Trigger] firestore becomes available.
  // [Downstream Impact] Users data is joined with audit logs in submissionsWithTeamNames memo.
  const usersQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, "users"));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: users, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);

  // GUID: PAGE_AUDIT-005-v03
  // [Intent] Paginated fetch function for audit logs — queries prediction_submitted events
  //          ordered by timestamp desc with cursor-based pagination via startAfter.
  // [Inbound Trigger] Called on initial mount and when user clicks "Load More" button.
  // [Downstream Impact] Populates auditLogs state. Sets hasMore flag based on result count vs PAGE_SIZE.
  //                     Updates lastDoc cursor for subsequent page loads.
  const fetchAuditLogs = useCallback(async (loadMore = false) => {
    if (!firestore) return;

    try {
      if (loadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setAuditLogs([]);
        setLastDoc(null);
        setError(null);
      }

      let q = query(
        collection(firestore, "audit_logs"),
        where("action", "==", "prediction_submitted"),
        orderBy("timestamp", "desc"),
        limit(PAGE_SIZE)
      );

      // If loading more, start after the last document
      if (loadMore && lastDoc) {
        q = query(
          collection(firestore, "audit_logs"),
          where("action", "==", "prediction_submitted"),
          orderBy("timestamp", "desc"),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const snapshot = await getDocs(q);

      const newLogs: AuditLogEntry[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as AuditLogEntry));

      if (loadMore) {
        setAuditLogs(prev => [...prev, ...newLogs]);
      } else {
        setAuditLogs(newLogs);
      }

      // Update last document for next page
      if (snapshot.docs.length > 0) {
        setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      }

      // Check if there are more results
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setLastUpdated(new Date());

    } catch (err: any) {
      console.error("Error fetching audit logs:", err);
      setError(err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [firestore, lastDoc]);

  // GUID: PAGE_AUDIT-006-v03
  // [Intent] Initial data load — triggers fetchAuditLogs once when Firestore is ready.
  // [Inbound Trigger] firestore reference becomes available.
  // [Downstream Impact] Populates the audit log table with the first page of results.
  useEffect(() => {
    if (firestore) {
      fetchAuditLogs(false);
    }
  }, [firestore]); // Only run on mount and when firestore changes

  // GUID: PAGE_AUDIT-007-v03
  // [Intent] Load more button handler — fetches the next page of audit logs.
  // [Inbound Trigger] User clicks the "Load Next 100" button.
  // [Downstream Impact] Appends next page of results to auditLogs state.
  const handleLoadMore = () => {
    fetchAuditLogs(true);
  };

  // GUID: PAGE_AUDIT-008-v03
  // [Intent] Formats a Firestore timestamp (or date string) to en-GB locale string.
  // [Inbound Trigger] Called for each audit log entry's timestamp in the table render.
  // [Downstream Impact] Displays formatted date/time in the "Submitted At" column.
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

  // GUID: PAGE_AUDIT-009-v03
  // [Intent] Wrapper around formatDriverPredictions to convert driver ID arrays to display names.
  // [Inbound Trigger] Called for each audit log entry's predictions in the table render.
  // [Downstream Impact] Displays human-readable driver abbreviations in the "Prediction" column.
  const formatPredictions = (predictions: string[] | undefined) => {
    return formatDriverPredictions(predictions);
  };

  // GUID: PAGE_AUDIT-010-v03
  // [Intent] Joins audit log entries with user data to resolve team names. Falls back to
  //          log.details.teamName or "Unknown Team" if user lookup fails.
  // [Inbound Trigger] auditLogs or users data changes.
  // [Downstream Impact] Produces the final display data for the submissions table.
  const submissionsWithTeamNames = useMemo(() => {
    if (!auditLogs) return [];
    return auditLogs.map((log) => {
      const user = users?.find((u) => u.id === log.userId);
      return {
        id: log.id,
        userId: log.userId,
        displayTeamName: log.details.teamName || user?.teamName || "Unknown Team",
        raceName: log.details.raceName || "N/A",
        predictions: log.details.predictions,
        timestamp: log.timestamp,
      };
    });
  }, [auditLogs, users]);

  const showLoading = isLoading || isLoadingUsers;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Submission Audit
        </h1>
        <p className="text-muted-foreground">
          Complete history of all prediction submissions across the league.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                Submission History
              </CardTitle>
              <CardDescription>
                All predictions ever submitted, including edits and updates.
                {auditLogs.length > 0 && (
                  <span className="ml-1">
                    Showing {auditLogs.length} entries.
                  </span>
                )}
              </CardDescription>
            </div>
            <LastUpdated timestamp={lastUpdated} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error Loading Audit Logs</AlertTitle>
              <AlertDescription>
                <span className="select-all cursor-text">{error.message}</span>
                {error.message?.includes('index') && (
                  <span className="block mt-2 text-sm">
                    This query requires a Firestore composite index. Please check the Firebase console.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Race</TableHead>
                <TableHead>Prediction (P1-P6)</TableHead>
                <TableHead>Submitted At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                  </TableRow>
                ))
              ) : submissionsWithTeamNames.length > 0 ? (
                submissionsWithTeamNames.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="font-semibold">
                      {submission.displayTeamName}
                    </TableCell>
                    <TableCell>{submission.raceName}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {formatPredictions(submission.predictions)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        {formatTimestamp(submission.timestamp)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center h-24 text-muted-foreground"
                  >
                    No submissions have been recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Load More Button */}
          {!showLoading && hasMore && submissionsWithTeamNames.length > 0 && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-2"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    Load Next {PAGE_SIZE}
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          )}

          {/* End of results message */}
          {!showLoading && !hasMore && submissionsWithTeamNames.length > 0 && (
            <p className="text-center text-sm text-muted-foreground pt-4">
              All {auditLogs.length} entries loaded.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
