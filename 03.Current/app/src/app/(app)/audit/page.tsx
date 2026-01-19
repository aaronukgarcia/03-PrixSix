"use client";

import { useMemo, useState, useEffect } from "react";
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
import { collection, query, orderBy } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { History, CalendarClock } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";

interface PredictionSubmission {
  id: string;
  userId: string;
  teamName: string;
  raceName: string;
  raceId: string;
  predictions: {
    P1: string;
    P2: string;
    P3: string;
    P4: string;
    P5: string;
    P6: string;
  };
  submittedAt: any;
}

export default function AuditPage() {
  const firestore = useFirestore();

  // Query all prediction_submissions (full history)
  const submissionsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(
      collection(firestore, "prediction_submissions"),
      orderBy("submittedAt", "desc")
    );
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const usersQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, "users"));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: submissions, isLoading: isLoadingSubmissions } =
    useCollection<PredictionSubmission>(submissionsQuery);
  const { data: users, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);

  // Track when data was last loaded
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    if (submissions && !isLoadingSubmissions) {
      setLastUpdated(new Date());
    }
  }, [submissions, isLoadingSubmissions]);

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

  const formatPredictions = (predictions: PredictionSubmission["predictions"]) => {
    if (!predictions) return "N/A";
    return `${predictions.P1}, ${predictions.P2}, ${predictions.P3}, ${predictions.P4}, ${predictions.P5}, ${predictions.P6}`;
  };

  const submissionsWithTeamNames = useMemo(() => {
    if (!submissions) return [];
    return submissions.map((submission) => {
      const user = users?.find((u) => u.id === submission.userId);
      return {
        ...submission,
        displayTeamName: submission.teamName || user?.teamName || "Unknown Team",
      };
    });
  }, [submissions, users]);

  const isLoading = isLoadingSubmissions || isLoadingUsers;

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
              </CardDescription>
            </div>
            <LastUpdated timestamp={lastUpdated} />
          </div>
        </CardHeader>
        <CardContent>
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
              {isLoading ? (
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
                    <TableCell>{submission.raceName || "N/A"}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {formatPredictions(submission.predictions)}
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
                    colSpan={4}
                    className="text-center h-24 text-muted-foreground"
                  >
                    No submissions have been recorded yet.
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
