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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { collection, query, orderBy } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck, CalendarClock } from "lucide-react";
import { LastUpdated } from "@/components/ui/last-updated";
import { RaceSchedule, findNextRace } from "@/lib/data";

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

export default function SubmissionsPage() {
  const firestore = useFirestore();
  const races = RaceSchedule.map((r) => r.name);
  const nextRace = findNextRace();
  const [selectedRace, setSelectedRace] = useState(nextRace.name);
  const selectedRaceId = selectedRace.replace(/\s+/g, '-');

  // Query all prediction_submissions
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

  // Get only the current/latest submission per team for the selected race
  const currentSubmissions = useMemo(() => {
    if (!submissions) return [];

    // Filter to selected race
    const raceSubmissions = submissions.filter(
      (s) => s.raceId === selectedRaceId || s.raceName === selectedRace
    );

    // Group by team name and keep only the latest (first since ordered desc)
    const latestByTeam = new Map<string, PredictionSubmission & { displayTeamName: string }>();

    raceSubmissions.forEach((submission) => {
      const user = users?.find((u) => u.id === submission.userId);
      const teamName = submission.teamName || user?.teamName || "Unknown Team";

      // Only keep the first (most recent) submission for each team
      if (!latestByTeam.has(teamName)) {
        latestByTeam.set(teamName, {
          ...submission,
          displayTeamName: teamName,
        });
      }
    });

    // Convert to array and sort by team name
    return Array.from(latestByTeam.values()).sort((a, b) =>
      a.displayTeamName.localeCompare(b.displayTeamName)
    );
  }, [submissions, users, selectedRaceId, selectedRace]);

  const isLoading = isLoadingSubmissions || isLoadingUsers;

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
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Prediction (P1-P6)</TableHead>
                <TableHead>Submitted At</TableHead>
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
              ) : currentSubmissions.length > 0 ? (
                currentSubmissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="font-semibold">
                      {submission.displayTeamName}
                    </TableCell>
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
