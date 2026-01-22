'use client';

import { useState, useEffect, useCallback } from "react";
import { useFirestore } from "@/firebase";
import type { User } from "@/firebase/provider";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RaceSchedule, getDriverImage, F1Drivers, findNextRace } from "@/lib/data";
import { collection, query, orderBy, limit, startAfter, getDocs, where, DocumentSnapshot, getCountFromServer } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";

interface Prediction {
  id: string;
  oduserId: string;
  teamName: string;
  raceId: string;
  driver1: string;
  driver2: string;
  driver3: string;
  driver4: string;
  driver5: string;
  driver6: string;
}

interface TeamWithPrediction {
  teamName: string;
  oduserId: string;
  predictions: (typeof F1Drivers[number] | null)[];
}

const PAGE_SIZE = 25;

export default function TeamsPage() {
  const firestore = useFirestore();
  const races = RaceSchedule.map((r) => r.name);
  const nextRace = findNextRace();
  const [selectedRace, setSelectedRace] = useState(nextRace.name);
  const selectedRaceId = selectedRace.replace(/\s+/g, '-');

  // Pagination state
  const [teams, setTeams] = useState<TeamWithPrediction[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch total count once (using aggregation - no document download)
  // Count includes both primary and secondary teams
  useEffect(() => {
    if (!firestore) return;

    const fetchCount = async () => {
      try {
        // Get user count - secondary teams are counted during data fetch
        const userCountSnapshot = await getCountFromServer(collection(firestore, "users"));
        const userCount = userCountSnapshot.data().count;
        // Store just user count - secondary teams counted client-side
        setTotalCount(userCount);
      } catch (error) {
        console.error("Error fetching count:", error);
        // Fallback: don't show total count
        setTotalCount(null);
      }
    };
    fetchCount();
  }, [firestore]);

  // Format prediction data
  const formatPrediction = useCallback((predData: any) => {
    if (!predData) return Array(6).fill(null);
    const driverIds = [
      predData.driver1, predData.driver2, predData.driver3,
      predData.driver4, predData.driver5, predData.driver6
    ];
    return driverIds.map(id => F1Drivers.find(d => d.id === id) || null);
  }, []);

  // Fetch users and their predictions with pagination
  const fetchTeams = useCallback(async (isLoadMore = false) => {
    if (!firestore) return;

    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setTeams([]);
      setLastDoc(null);
      setError(null);
    }

    try {
      // Build paginated query for users
      let usersQuery = query(
        collection(firestore, "users"),
        orderBy("teamName"),
        limit(PAGE_SIZE * 2) // Fetch extra to account for filtering
      );

      if (isLoadMore && lastDoc) {
        usersQuery = query(
          collection(firestore, "users"),
          orderBy("teamName"),
          startAfter(lastDoc),
          limit(PAGE_SIZE * 2)
        );
      }

      const usersSnapshot = await getDocs(usersQuery);
      console.log(`[Teams] Fetched ${usersSnapshot.size} users from Firestore`);

      // Filter to only users with valid teamName
      const validUserDocs = usersSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.teamName && typeof data.teamName === 'string' && data.teamName.trim() !== '';
      });

      console.log(`[Teams] ${validUserDocs.length} users have valid teamName`);

      if (validUserDocs.length === 0 && usersSnapshot.size === 0) {
        setHasMore(false);
        if (!isLoadMore) {
          setError("No teams found in the database.");
        }
        return;
      }

      if (validUserDocs.length === 0) {
        // We got results but none had valid teamName - might be more pages
        setHasMore(usersSnapshot.size >= PAGE_SIZE * 2);
        if (!isLoadMore) {
          setError("No teams with valid names found. Users may not have completed registration.");
        }
        return;
      }

      // Update last doc for next pagination (use the last doc from original query for correct pagination)
      setLastDoc(usersSnapshot.docs[usersSnapshot.docs.length - 1]);
      setHasMore(usersSnapshot.docs.length >= PAGE_SIZE);

      // Fetch predictions for valid users only
      const newTeams: TeamWithPrediction[] = [];

      for (const userDoc of validUserDocs) {
        const userData = userDoc.data() as User;

        // Get prediction for this user and race
        const predQuery = query(
          collection(firestore, `users/${userDoc.id}/predictions`),
          where("raceId", "==", selectedRaceId)
        );
        const predSnapshot = await getDocs(predQuery);

        // Main team
        const mainPred = predSnapshot.docs.find(d =>
          d.data().teamName === userData.teamName || !d.data().teamName
        );
        newTeams.push({
          teamName: userData.teamName,
          oduserId: userDoc.id,
          predictions: formatPrediction(mainPred?.data()),
        });

        // Secondary team if exists
        if (userData.secondaryTeamName) {
          const secondaryPred = predSnapshot.docs.find(d =>
            d.data().teamName === userData.secondaryTeamName
          );
          newTeams.push({
            teamName: userData.secondaryTeamName,
            oduserId: userDoc.id,
            predictions: formatPrediction(secondaryPred?.data()),
          });
        }
      }

      if (isLoadMore) {
        setTeams(prev => [...prev, ...newTeams]);
      } else {
        setTeams(newTeams);
      }

      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching teams:", error);
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      let errorMsg: string;
      if (error?.code === 'failed-precondition') {
        errorMsg = `Database index required. Please contact an administrator. [PX-4003] (Ref: ${correlationId})`;
        console.error(`[Teams Index Error ${correlationId}]`, error?.message);
      } else if (error?.code === 'permission-denied') {
        errorMsg = `Permission denied. Please sign in again. [PX-1001] (Ref: ${correlationId})`;
      } else {
        errorMsg = `Error loading teams: ${error?.message || 'Unknown error'} [PX-9001] (Ref: ${correlationId})`;
      }
      setError(errorMsg);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [firestore, selectedRaceId, lastDoc, formatPrediction]);

  // Initial load and race change
  useEffect(() => {
    fetchTeams(false);
  }, [firestore, selectedRaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    fetchTeams(true);
  };

  const progressPercent = totalCount && totalCount > 0
    ? Math.min(100, Math.round((teams.length / totalCount) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Team Predictions
        </h1>
        <p className="text-muted-foreground">
          See what your rivals are predicting for each race.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>All Team Submissions</CardTitle>
              <CardDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span>Select a race to view predictions.</span>
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
        <CardContent className="space-y-4">
          {/* Progress indicator */}
          {!isLoading && totalCount && totalCount > PAGE_SIZE && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {teams.length} of {totalCount} teams</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          <Accordion type="single" collapsible className="w-full">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full mb-2" />
              ))
            ) : teams.length > 0 ? (
              teams.map((team, index) => (
                <AccordionItem value={`${team.teamName}-${index}`} key={`${team.teamName}-${index}`}>
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                    {team.teamName}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 pt-4">
                      {team.predictions.map((driver, idx) => (
                        <div key={idx} className="flex flex-col items-center gap-2 p-2 rounded-lg border bg-card-foreground/5">
                          <div className="font-bold text-accent text-2xl">P{idx + 1}</div>
                          {driver ? (
                            <>
                              <Avatar className="w-16 h-16 border-2 border-primary">
                                <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait" />
                                <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
                              </Avatar>
                              <div className="text-center">
                                <p className="font-semibold">{driver.name}</p>
                                <p className="text-xs text-muted-foreground">{driver.team}</p>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center gap-2">
                              <Avatar className="w-16 h-16 border-2 border-dashed">
                                <AvatarFallback>?</AvatarFallback>
                              </Avatar>
                              <div className="text-center">
                                <p className="font-semibold text-muted-foreground">Empty</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                {error}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No teams found.
              </div>
            )}
          </Accordion>

          {/* Load more button */}
          {hasMore && !isLoading && teams.length > 0 && (
            <div className="flex justify-center pt-4">
              {isLoadingMore ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading more teams...</span>
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
