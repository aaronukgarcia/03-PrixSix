'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import { useFirestore } from "@/firebase";
import { useLeague } from "@/contexts/league-context";
import { LeagueSelector } from "@/components/league/LeagueSelector";
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
import { collection, query, orderBy, limit, startAfter, getDocs, where, DocumentSnapshot, getCountFromServer, Timestamp } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import { useSmartLoader } from "@/components/ui/smart-loader";

interface TeamBasic {
  teamName: string;
  oduserId: string;
  isSecondary?: boolean;
  createdAt?: any; // Firestore timestamp of when user joined
}

interface TeamWithPrediction extends TeamBasic {
  predictions: (typeof F1Drivers[number] | null)[] | null; // null = not loaded, array = loaded
  isLoadingPredictions?: boolean;
  joinedAfterRace?: boolean; // true if team joined after this race
}

const PAGE_SIZE = 25;

// Helper to find the most recent race that has results
function findMostRecentRaceWithResults(raceResults: { raceId: string }[]): string | null {
  if (!raceResults || raceResults.length === 0) return null;

  // Get unique raceIds that have results
  const racesWithResults = new Set(raceResults.map(r => r.raceId));

  // Find the most recent race in the schedule that has results
  // Go through schedule in reverse order (most recent first)
  for (let i = RaceSchedule.length - 1; i >= 0; i--) {
    const race = RaceSchedule[i];
    const raceId = race.name.replace(/\s+/g, '-');
    if (racesWithResults.has(raceId)) {
      return race.name;
    }
  }
  return null;
}

export default function TeamsPage() {
  const firestore = useFirestore();
  const { selectedLeague } = useLeague();
  const { startLoading, stopLoading } = useSmartLoader();
  const races = RaceSchedule.map((r) => r.name);
  const nextRace = findNextRace();
  const [selectedRace, setSelectedRace] = useState<string | null>(null); // Will be set after loading results
  const [defaultRaceLoaded, setDefaultRaceLoaded] = useState(false);
  const selectedRaceId = selectedRace?.replace(/\s+/g, '-') || '';

  // Pagination state
  const [teams, setTeams] = useState<TeamWithPrediction[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track which accordion item is open
  const [openAccordion, setOpenAccordion] = useState<string | undefined>(undefined);

  // Cache for predictions by race
  const [predictionCache, setPredictionCache] = useState<Record<string, Record<string, (typeof F1Drivers[number] | null)[]>>>({});

  // Fetch race results to determine default race selection
  useEffect(() => {
    if (!firestore || defaultRaceLoaded) return;

    const fetchDefaultRace = async () => {
      try {
        const resultsQuery = query(collection(firestore, "race_results"), orderBy("submittedAt", "desc"));
        const resultsSnapshot = await getDocs(resultsQuery);
        const raceResults = resultsSnapshot.docs.map(doc => ({ raceId: doc.data().raceId }));

        const mostRecentWithResults = findMostRecentRaceWithResults(raceResults);
        if (mostRecentWithResults) {
          setSelectedRace(mostRecentWithResults);
        } else {
          // No results yet, default to next race
          setSelectedRace(nextRace.name);
        }
      } catch (error) {
        console.error("Error fetching race results:", error);
        setSelectedRace(nextRace.name);
      } finally {
        setDefaultRaceLoaded(true);
      }
    };
    fetchDefaultRace();
  }, [firestore, defaultRaceLoaded, nextRace.name]);

  // Fetch total count once (using aggregation - no document download)
  useEffect(() => {
    if (!firestore) return;

    const fetchCount = async () => {
      try {
        const userCountSnapshot = await getCountFromServer(collection(firestore, "users"));
        const userCount = userCountSnapshot.data().count;
        setTotalCount(userCount);
      } catch (error) {
        console.error("Error fetching count:", error);
        setTotalCount(null);
      }
    };
    fetchCount();
  }, [firestore]);

  // Format prediction data
  const formatPrediction = useCallback((predData: any) => {
    if (!predData) return Array(6).fill(null);
    const driverIds = predData.predictions || [
      predData.driver1, predData.driver2, predData.driver3,
      predData.driver4, predData.driver5, predData.driver6
    ];
    if (!Array.isArray(driverIds)) return Array(6).fill(null);
    return driverIds.map(id => F1Drivers.find(d => d.id === id) || null);
  }, []);

  // Fetch just the teams (no predictions) - FAST
  const fetchTeams = useCallback(async (isLoadMore = false) => {
    if (!firestore) return;

    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      startLoading('teams-initial');
      setTeams([]);
      setLastDoc(null);
      setError(null);
    }

    try {
      // Build paginated query for users
      let usersQuery = query(
        collection(firestore, "users"),
        orderBy("teamName"),
        limit(PAGE_SIZE * 2)
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
        setHasMore(usersSnapshot.size >= PAGE_SIZE * 2);
        if (!isLoadMore) {
          setError("No teams with valid names found. Users may not have completed registration.");
        }
        return;
      }

      // Update last doc for pagination
      setLastDoc(usersSnapshot.docs[usersSnapshot.docs.length - 1]);
      setHasMore(usersSnapshot.docs.length >= PAGE_SIZE);

      // Build team list WITHOUT predictions (fast)
      const newTeams: TeamWithPrediction[] = [];

      for (const userDoc of validUserDocs) {
        const userData = userDoc.data() as User & { createdAt?: any };

        // Main team - predictions loaded on-demand
        newTeams.push({
          teamName: userData.teamName,
          oduserId: userDoc.id,
          createdAt: userData.createdAt,
          predictions: null, // Not loaded yet
        });

        // Secondary team if exists
        if (userData.secondaryTeamName) {
          newTeams.push({
            teamName: userData.secondaryTeamName,
            oduserId: userDoc.id,
            isSecondary: true,
            createdAt: userData.createdAt,
            predictions: null, // Not loaded yet
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
        errorMsg = `Database index required. Please contact an administrator. [PX-4004] (Ref: ${correlationId})`;
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
      stopLoading('teams-initial');
    }
  }, [firestore, lastDoc, startLoading, stopLoading]);

  // Check if team joined after the selected race
  const didTeamJoinAfterRace = useCallback((team: TeamWithPrediction): boolean => {
    if (!team.createdAt || !selectedRace) return false;

    const race = RaceSchedule.find(r => r.name === selectedRace);
    if (!race) return false;

    const raceQualifyingTime = new Date(race.qualifyingTime);
    const teamCreatedAt = team.createdAt.toDate ? team.createdAt.toDate() : new Date(team.createdAt);

    return teamCreatedAt > raceQualifyingTime;
  }, [selectedRace]);

  // Fetch prediction for a specific team on-demand
  const fetchPredictionForTeam = useCallback(async (teamKey: string, team: TeamWithPrediction) => {
    if (!firestore || !selectedRaceId) return;

    // Check if team joined after this race
    const joinedAfterRace = didTeamJoinAfterRace(team);
    if (joinedAfterRace) {
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${prev.indexOf(t)}` === teamKey
          ? { ...t, predictions: [], joinedAfterRace: true, isLoadingPredictions: false }
          : t
      ));
      return;
    }

    // Check cache first
    const cacheKey = `${team.oduserId}_${team.teamName}`;
    if (predictionCache[selectedRaceId]?.[cacheKey]) {
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${prev.indexOf(t)}` === teamKey
          ? { ...t, predictions: predictionCache[selectedRaceId][cacheKey], joinedAfterRace: false }
          : t
      ));
      return;
    }

    // Mark as loading
    setTeams(prev => prev.map(t =>
      `${t.teamName}-${prev.indexOf(t)}` === teamKey
        ? { ...t, isLoadingPredictions: true }
        : t
    ));

    try {
      const predQuery = query(
        collection(firestore, `users/${team.oduserId}/predictions`),
        where("raceId", "==", selectedRaceId)
      );
      const predSnapshot = await getDocs(predQuery);

      // Find the right prediction
      let pred;
      if (team.isSecondary) {
        pred = predSnapshot.docs.find(d => d.data().teamName === team.teamName);
      } else {
        pred = predSnapshot.docs.find(d =>
          d.data().teamName === team.teamName || !d.data().teamName
        );
      }

      const predictions = formatPrediction(pred?.data());

      // Update cache
      setPredictionCache(prev => ({
        ...prev,
        [selectedRaceId]: {
          ...(prev[selectedRaceId] || {}),
          [cacheKey]: predictions
        }
      }));

      // Update team with predictions
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${prev.indexOf(t)}` === teamKey
          ? { ...t, predictions, joinedAfterRace: false, isLoadingPredictions: false }
          : t
      ));
    } catch (error) {
      console.error(`Error fetching prediction for ${team.teamName}:`, error);
      // Set empty predictions on error
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${prev.indexOf(t)}` === teamKey
          ? { ...t, predictions: Array(6).fill(null), joinedAfterRace: false, isLoadingPredictions: false }
          : t
      ));
    }
  }, [firestore, selectedRaceId, predictionCache, formatPrediction, didTeamJoinAfterRace]);

  // Handle accordion open - fetch prediction on-demand
  const handleAccordionChange = useCallback((value: string | undefined) => {
    setOpenAccordion(value);

    if (value) {
      // Find the team and check if we need to load predictions
      const teamIndex = teams.findIndex((t, i) => `${t.teamName}-${i}` === value);
      if (teamIndex >= 0) {
        const team = teams[teamIndex];
        if (team.predictions === null && !team.isLoadingPredictions) {
          fetchPredictionForTeam(value, team);
        }
      }
    }
  }, [teams, fetchPredictionForTeam]);

  // Initial load - wait for default race to be determined first
  useEffect(() => {
    if (defaultRaceLoaded && selectedRace) {
      fetchTeams(false);
    }
  }, [firestore, defaultRaceLoaded, selectedRace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear predictions when race changes (they'll be loaded on-demand)
  useEffect(() => {
    if (selectedRaceId) {
      setTeams(prev => prev.map(t => ({ ...t, predictions: null, joinedAfterRace: undefined, isLoadingPredictions: false })));
      setOpenAccordion(undefined);
    }
  }, [selectedRaceId]);

  const loadMore = () => {
    fetchTeams(true);
  };

  const progressPercent = totalCount && totalCount > 0
    ? Math.min(100, Math.round((teams.length / totalCount) * 100))
    : 0;

  // Filter teams by selected league
  const filteredTeams = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return teams;
    }
    return teams.filter(team =>
      selectedLeague.memberUserIds.includes(team.oduserId)
    );
  }, [teams, selectedLeague]);

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
            <div className="flex flex-col sm:flex-row gap-2">
              <LeagueSelector />
              <Select value={selectedRace || ""} onValueChange={setSelectedRace}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder={defaultRaceLoaded ? "Select a race" : "Loading..."} />
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
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress indicator */}
          {!isLoading && totalCount && totalCount > PAGE_SIZE && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Showing {filteredTeams.length}{selectedLeague && !selectedLeague.isGlobal ? ` (filtered from ${teams.length})` : ''} of {totalCount} teams</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}

          <Accordion
            type="single"
            collapsible
            className="w-full"
            value={openAccordion}
            onValueChange={handleAccordionChange}
          >
            {!defaultRaceLoaded || isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full mb-2" />
              ))
            ) : filteredTeams.length > 0 ? (
              filteredTeams.map((team, index) => (
                <AccordionItem value={`${team.teamName}-${index}`} key={`${team.teamName}-${index}`}>
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                    {team.teamName}
                  </AccordionTrigger>
                  <AccordionContent>
                    {team.isLoadingPredictions ? (
                      <div className="flex items-center justify-center py-8 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Loading predictions...</span>
                      </div>
                    ) : team.joinedAfterRace ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground italic">
                        Team {team.teamName} joined after this race
                      </div>
                    ) : team.predictions === null ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        Click to load predictions
                      </div>
                    ) : (
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
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                {error}
              </div>
            ) : teams.length > 0 && filteredTeams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No teams in this league. Try selecting a different league.
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No teams found.
              </div>
            )}
          </Accordion>

          {/* Load more button */}
          {hasMore && !isLoading && filteredTeams.length > 0 && (
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
