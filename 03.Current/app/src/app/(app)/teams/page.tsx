// GUID: PAGE_TEAMS-000-v04
// @UX(NEWBIE-24, v04) Copy fixes: "the other teams predictions" → "other teams' predictions"
//   (missing apostrophe), and the dead-end empty states now tell the user what to do next.
// [Intent] Teams page — displays all team predictions for a selected race in an expandable accordion.
//   Users can browse every team's P1-P6 driver selections per race, with on-demand lazy loading of
//   predictions and pagination of team lists. Supports league filtering via LeagueSelector.
// [Inbound Trigger] User navigates to /teams in the app layout.
// [Downstream Impact] Reads from Firestore "users", "race_results", and per-user "predictions" subcollections.
//   Changes to Firestore schema for users or predictions will break data fetching and display logic.

'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useFirestore, useAuth } from "@/firebase";
import { podiumLabel } from "@/lib/podium";
import { computeAllTrophies, trophyAnchorId, type Trophy as TrophyAward, type TrophyScoreRow } from "@/lib/trophies";
import { getTrophyImage, getFlagImage, getCircuitAsset } from "@/lib/trophy-assets";
import { normalizeRaceIdForComparison } from "@/lib/normalize-race-id";
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
import { generateRaceId } from "@/lib/normalize-race-id";
import { collection, query, orderBy, limit, startAfter, getDocs, doc, getDoc, where, DocumentSnapshot, getCountFromServer, Timestamp } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { LastUpdated } from "@/components/ui/last-updated";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import { useSmartLoader } from "@/components/ui/smart-loader";
// @SECURITY_FIX: GEMINI-AUDIT-058 — Import from client-safe registry (no internal metadata).
import { CLIENT_ERRORS as ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: PAGE_TEAMS-001-v03
// [Intent] Represents a basic team record with user association, used before predictions are loaded.
// [Inbound Trigger] Constructed during team list fetching from Firestore users collection.
// [Downstream Impact] Extended by TeamWithPrediction; changes to fields affect team display and prediction matching.
interface TeamBasic {
  teamName: string;
  oduserId: string;
  isSecondary?: boolean;
  createdAt?: any; // Firestore timestamp of when user joined
}

// GUID: PAGE_TEAMS-002-v03
// [Intent] Extends TeamBasic with prediction data and loading state for on-demand prediction fetching.
// [Inbound Trigger] Teams state array uses this type; predictions populated when accordion is expanded.
// [Downstream Impact] Drives conditional rendering in the accordion content (loading spinner, "joined after race", driver grid).
interface TeamWithPrediction extends TeamBasic {
  predictions: (typeof F1Drivers[number] | null)[] | null; // null = not loaded, array = loaded
  isLoadingPredictions?: boolean;
  joinedAfterRace?: boolean; // true if team joined after this race
}

const PAGE_SIZE = 25;

// PAGE_TEAMS-003 removed — default race selection now uses findNextRace() directly

// GUID: PAGE_TEAMS-004-v03
// [Intent] Main page component that orchestrates team listing, race selection, on-demand prediction loading,
//   pagination, and league filtering for the Teams view.
// [Inbound Trigger] Rendered by Next.js router when user visits /teams.
// [Downstream Impact] Consumes useFirestore, useLeague, useSmartLoader hooks and RaceSchedule/F1Drivers data.
//   UI changes here affect the primary team browsing experience for all users.
// GUID: PAGE_TEAMS-016-v01
// [Intent] FEAT-TROPHY-002 — one large trophy tile: the circuit's own artwork, the host-nation flag
//   beside the track name, and the points scored. The points figure is the hot link back to that
//   race's result, closing the loop with the podium badge on the Results page that links here.
// [Inbound Trigger] TrophyCabinet, one per award.
// [Downstream Impact] Sized to match the driver portrait tile above it (64px art, same border and
//   padding) so the cabinet reads as a continuation of the P1-P6 row rather than a separate widget.
const TrophyTile = ({ trophy, highlighted }: { trophy: TrophyAward; highlighted: boolean }) => {
  const asset = getCircuitAsset(trophy.location);
  const description = `${podiumLabel(trophy.place)} for ${trophy.label}`;
  return (
    <div
      id={trophyAnchorId(trophy.urlRaceId)}
      className={`flex flex-col items-center gap-2 p-2 rounded-lg border bg-card-foreground/5 scroll-mt-24 transition-shadow ${
        highlighted ? 'ring-2 ring-accent shadow-lg' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={getTrophyImage(trophy.location, trophy.place)} alt={description} className="w-16 h-16" />
      <div className="flex items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getFlagImage(trophy.location)}
          alt={asset.countryName}
          title={asset.countryName}
          className="w-6 h-4 rounded-[2px] border border-border/60"
        />
        <span className="text-sm font-semibold">{trophy.label}</span>
      </div>
      <a
        href={`/results?race=${trophy.urlRaceId}`}
        title={`View the ${trophy.raceName}${trophy.isSprint ? ' Sprint' : ''} result`}
        className="text-xs font-mono font-bold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
      >
        {trophy.points} pts
      </a>
    </div>
  );
};

// GUID: PAGE_TEAMS-017-v01
// [Intent] FEAT-TROPHY-002 — a team's full trophy cabinet, shown under their P1-P6 drivers. Season
//   order, oldest first, matching the mini strip on Standings.
// [Inbound Trigger] Rendered inside each team's accordion content.
// [Downstream Impact] Renders nothing at all for a team with no podium finishes, so the accordion
//   is unchanged for most of the grid.
const TrophyCabinet = ({ trophies, highlightRaceId }: { trophies: TrophyAward[] | undefined; highlightRaceId: string | null }) => {
  if (!trophies || trophies.length === 0) return null;
  const golds = trophies.filter(t => t.place === 1).length;
  const silvers = trophies.filter(t => t.place === 2).length;
  const bronzes = trophies.filter(t => t.place === 3).length;
  const summary = [
    golds ? `${golds} × 1st` : null,
    silvers ? `${silvers} × 2nd` : null,
    bronzes ? `${bronzes} × 3rd` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="pt-6 mt-6 border-t">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h3 className="font-semibold text-lg">Trophy cabinet</h3>
        <p className="text-xs text-muted-foreground font-mono">{summary}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        {trophies.map((trophy, i) => (
          <TrophyTile
            key={`${trophy.urlRaceId}-${i}`}
            trophy={trophy}
            highlighted={
              !!highlightRaceId &&
              normalizeRaceIdForComparison(trophy.urlRaceId) === normalizeRaceIdForComparison(highlightRaceId)
            }
          />
        ))}
      </div>
    </div>
  );
};

function TeamsPageContent() {
  const firestore = useFirestore();
  const { firebaseUser } = useAuth();
  const { selectedLeague } = useLeague();
  const { startLoading, stopLoading } = useSmartLoader();
  const races = RaceSchedule.map((r) => r.name);
  const nextRace = findNextRace();

  // GUID: PAGE_TEAMS-018-v01
  // [Intent] FEAT-TROPHY-002 deep link: ?team=<score-space team id>&race=<Title-Case race id>
  //   &trophy=<Title-Case race id>. Standings and Results both link here — Standings always passes
  //   the latest completed weekend, Results passes the race being viewed (Aaron, 2026-07-27).
  // [Inbound Trigger] Arriving from a team name or a podium badge.
  // [Downstream Impact] `race` preselects the weekend, `team` auto-opens the accordion (paging until
  //   the team is loaded if necessary), `trophy` scrolls to and highlights one cabinet tile.
  const searchParams = useSearchParams();
  const teamParam = searchParams.get('team');
  const raceParam = searchParams.get('race');
  const trophyParam = searchParams.get('trophy');

  // The `race` param is a Title-Case race id ("British-Grand-Prix-GP"); the race selector works in
  // race NAMES. Resolve via RaceSchedule rather than string-munging the id — the sprint/GP suffix
  // asymmetry documented in normalize-race-id.ts makes munging unsafe. A sprint id resolves to its
  // weekend, because this page shows one prediction set per weekend.
  const initialRaceFromParam = useMemo(() => {
    if (!raceParam) return null;
    const wanted = normalizeRaceIdForComparison(raceParam);
    const match = RaceSchedule.find(r =>
      normalizeRaceIdForComparison(generateRaceId(r.name, 'gp')) === wanted ||
      (r.hasSprint && normalizeRaceIdForComparison(generateRaceId(r.name, 'sprint')) === wanted)
    );
    return match?.name ?? null;
  }, [raceParam]);

  const [selectedRace, setSelectedRace] = useState<string>(initialRaceFromParam ?? nextRace.name);
  const [defaultRaceLoaded, setDefaultRaceLoaded] = useState(true);
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

  // GUID: PAGE_TEAMS-019-v01
  // [Intent] FEAT-TROPHY-002 — season scores for the trophy cabinet. Reuses /api/standings, which
  //   already returns granular per-race per-team points; no new endpoint was needed.
  // [Inbound Trigger] Mount, once the signed-in user can mint a token.
  // [Downstream Impact] Feeds computeAllTrophies. Failure is non-fatal and silent in the UI: the
  //   page's core job is showing predictions, so a scores outage hides cabinets rather than
  //   breaking the page. The error is still surfaced to the console for diagnosis.
  const [trophyScores, setTrophyScores] = useState<TrophyScoreRow[]>([]);

  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/standings', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success && Array.isArray(json.scores)) {
          setTrophyScores(json.scores as TrophyScoreRow[]);
        }
      } catch (err: any) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[teams] trophy scores fetch failed (non-fatal):', err?.message || err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUser]);

  const trophiesByTeam = useMemo(() => computeAllTrophies(trophyScores), [trophyScores]);

  // Cache for predictions by race
  const [predictionCache, setPredictionCache] = useState<Record<string, Record<string, (typeof F1Drivers[number] | null)[]>>>({});

  // PAGE_TEAMS-005 removed — default race now set directly from findNextRace() (no Firestore query needed)

  // GUID: PAGE_TEAMS-006-v03
  // [Intent] Fetches the total user count using Firestore server-side aggregation (no document downloads).
  // [Inbound Trigger] Runs once when firestore becomes available.
  // [Downstream Impact] Populates totalCount used for the progress bar percentage display.
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

  // GUID: PAGE_TEAMS-007-v03
  // [Intent] Converts raw Firestore prediction data into an array of F1Driver objects for display.
  // [Inbound Trigger] Called by fetchPredictionForTeam when a prediction document is loaded.
  // [Downstream Impact] Returns the driver array rendered in the accordion content grid. If F1Drivers data changes, driver matching may break.
  const formatPrediction = useCallback((predData: any) => {
    if (!predData) return Array(6).fill(null);
    const driverIds = predData.predictions || [
      predData.driver1, predData.driver2, predData.driver3,
      predData.driver4, predData.driver5, predData.driver6
    ];
    if (!Array.isArray(driverIds)) return Array(6).fill(null);
    return driverIds.map(id => F1Drivers.find(d => d.id === id) || null);
  }, []);

  // GUID: PAGE_TEAMS-008-v04
  // [Intent] Fetches paginated team list from Firestore users collection WITHOUT predictions (fast initial load).
  // [Inbound Trigger] Called on initial page load (via PAGE_TEAMS-012 effect) and when "Load More" button is clicked.
  // [Downstream Impact] Populates the teams state array. Predictions are loaded on-demand via PAGE_TEAMS-010.
  //   Error display uses PX error codes with correlation IDs per Golden Rule #1.
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

      // Sort all teams alphabetically A-Z (case-insensitive) so primary + secondary teams interleave correctly
      newTeams.sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' }));

      if (isLoadMore) {
        setTeams(prev => {
          const merged = [...prev, ...newTeams];
          merged.sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' }));
          return merged;
        });
      } else {
        setTeams(newTeams);
      }

      setLastUpdated(new Date());
    } catch (error: any) {
      console.error("Error fetching teams:", error);
      const correlationId = generateClientCorrelationId();
      let errorMsg: string;
      if (error?.code === 'failed-precondition') {
        errorMsg = `Database index required. Please contact an administrator. [${ERRORS.FIRESTORE_INDEX_REQUIRED.code}] (Ref: ${correlationId})`;
        console.error(`[Teams Index Error ${correlationId}]`, error?.message);
      } else if (error?.code === 'permission-denied') {
        errorMsg = `Permission denied. Please sign in again. [${ERRORS.AUTH_INVALID_TOKEN.code}] (Ref: ${correlationId})`;
      } else {
        errorMsg = `Error loading teams: ${error?.message || 'Unknown error'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
      }
      setError(errorMsg);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      stopLoading('teams-initial');
    }
  }, [firestore, lastDoc, startLoading, stopLoading]);

  // GUID: PAGE_TEAMS-009-v03
  // [Intent] Checks whether a team's createdAt timestamp is after the selected race's qualifying time.
  // [Inbound Trigger] Called by fetchPredictionForTeam to skip prediction loading for teams that joined late.
  // [Downstream Impact] Sets joinedAfterRace flag on the team, rendering "Team joined after this race" message.
  const didTeamJoinAfterRace = useCallback((team: TeamWithPrediction): boolean => {
    if (!team.createdAt || !selectedRace) return false;

    const race = RaceSchedule.find(r => r.name === selectedRace);
    if (!race) return false;

    const raceQualifyingTime = new Date(race.qualifyingTime);
    const teamCreatedAt = team.createdAt.toDate ? team.createdAt.toDate() : new Date(team.createdAt);

    return teamCreatedAt > raceQualifyingTime;
  }, [selectedRace]);

  // GUID: PAGE_TEAMS-010-v04
  // [Intent] Fetches predictions for a single team on-demand when the user expands an accordion item.
  //   v04: Uses direct document get by ID (more reliable than query-by-field). Robust carry-forward:
  //        if no prediction exists for this race, finds the most recent prediction for this team type
  //        using doc ID prefix matching (uid_ for primary, uid-secondary_ for secondary).
  //        Ensures every team that has ever submitted shows 6 drivers — never "P1 ?".
  // [Inbound Trigger] Called from handleAccordionChange when a team's accordion is opened and predictions are null.
  // [Downstream Impact] Updates the teams state array with prediction data and populates predictionCache.
  const fetchPredictionForTeam = useCallback(async (teamKey: string, team: TeamWithPrediction) => {
    if (!firestore || !selectedRaceId) return;

    // Check if team joined after this race
    const joinedAfterRace = didTeamJoinAfterRace(team);
    if (joinedAfterRace) {
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${t.oduserId}` === teamKey
          ? { ...t, predictions: [], joinedAfterRace: true, isLoadingPredictions: false }
          : t
      ));
      return;
    }

    // Check cache first
    const cacheKey = `${team.oduserId}_${team.teamName}`;
    if (predictionCache[selectedRaceId]?.[cacheKey]) {
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${t.oduserId}` === teamKey
          ? { ...t, predictions: predictionCache[selectedRaceId][cacheKey], joinedAfterRace: false }
          : t
      ));
      return;
    }

    // Mark as loading
    setTeams(prev => prev.map(t =>
      `${t.teamName}-${t.oduserId}` === teamKey
        ? { ...t, isLoadingPredictions: true }
        : t
    ));

    try {
      // ── 1. Direct document get by known doc ID ─────────────────────────
      // Primary: {uid}_{raceId}, Secondary: {uid}-secondary_{raceId}
      const teamId = team.isSecondary ? `${team.oduserId}-secondary` : team.oduserId;
      const raceIdGP = generateRaceId(selectedRace!, 'gp');
      const predDocId = `${teamId}_${raceIdGP}`;

      const predRef = doc(firestore, 'users', team.oduserId, 'predictions', predDocId);
      const predSnap = await getDoc(predRef);

      let predData = predSnap.exists() ? predSnap.data() : null;

      // ── 2. Carry-forward: no prediction for this race → find most recent ──
      if (!predData) {
        // Fetch recent predictions for this user, ordered by submittedAt desc.
        // Filter by doc ID prefix to match team type (primary vs secondary).
        const cfQuery = query(
          collection(firestore, `users/${team.oduserId}/predictions`),
          orderBy("submittedAt", "desc"),
          limit(20)
        );
        const cfSnapshot = await getDocs(cfQuery);

        const docIdPrefix = team.isSecondary
          ? `${team.oduserId}-secondary_`
          : `${team.oduserId}_`;

        // Find the most recent prediction matching this team type
        const cfDoc = cfSnapshot.docs.find(d => d.id.startsWith(docIdPrefix));
        predData = cfDoc?.data() ?? null;
      }

      const predictions = formatPrediction(predData);

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
        `${t.teamName}-${t.oduserId}` === teamKey
          ? { ...t, predictions, joinedAfterRace: false, isLoadingPredictions: false }
          : t
      ));
    } catch (error) {
      console.error(`Error fetching prediction for ${team.teamName}:`, error);
      setTeams(prev => prev.map(t =>
        `${t.teamName}-${t.oduserId}` === teamKey
          ? { ...t, predictions: Array(6).fill(null), joinedAfterRace: false, isLoadingPredictions: false }
          : t
      ));
    }
  }, [firestore, selectedRace, selectedRaceId, predictionCache, formatPrediction, didTeamJoinAfterRace]);

  // GUID: PAGE_TEAMS-011-v03
  // [Intent] Handles accordion open/close events and triggers on-demand prediction fetching for the opened team.
  // [Inbound Trigger] Fired when user clicks an accordion trigger in the team list.
  // [Downstream Impact] Calls fetchPredictionForTeam if predictions have not yet been loaded for the selected team.
  const handleAccordionChange = useCallback((value: string | undefined) => {
    setOpenAccordion(value);

    if (value) {
      // Find the team using stable key (teamName + oduserId, not position-dependent)
      const team = teams.find(t => `${t.teamName}-${t.oduserId}` === value);
      if (team && team.predictions === null && !team.isLoadingPredictions) {
        fetchPredictionForTeam(value, team);
      }
    }
  }, [teams, fetchPredictionForTeam]);

  // GUID: PAGE_TEAMS-012-v03
  // [Intent] Triggers the initial team list fetch once the default race has been determined.
  // [Inbound Trigger] Runs when defaultRaceLoaded becomes true and selectedRace is set.
  // [Downstream Impact] Calls fetchTeams to populate the team list. Guards against premature loading before race selection.
  useEffect(() => {
    if (defaultRaceLoaded && selectedRace) {
      fetchTeams(false);
    }
  }, [firestore, defaultRaceLoaded, selectedRace]); // eslint-disable-line react-hooks/exhaustive-deps

  // GUID: PAGE_TEAMS-013-v03
  // [Intent] Resets all team prediction data and closes the accordion when the selected race changes.
  // [Inbound Trigger] selectedRaceId changes due to user selecting a different race from the dropdown.
  // [Downstream Impact] Clears predictions from team state so they are re-fetched on-demand for the new race.
  useEffect(() => {
    if (selectedRaceId) {
      setTeams(prev => prev.map(t => ({ ...t, predictions: null, joinedAfterRace: undefined, isLoadingPredictions: false })));
      setOpenAccordion(undefined);
    }
  }, [selectedRaceId]);

  // GUID: PAGE_TEAMS-014-v03
  // [Intent] Delegates to fetchTeams with isLoadMore=true for paginated loading.
  // [Inbound Trigger] User clicks "Load More Teams" button at the bottom of the team list.
  // [Downstream Impact] Appends the next page of teams to the existing teams array.
  const loadMore = () => {
    fetchTeams(true);
  };

  const progressPercent = totalCount && totalCount > 0
    ? Math.min(100, Math.round((teams.length / totalCount) * 100))
    : 0;

  // GUID: PAGE_TEAMS-015-v03
  // [Intent] Filters the full teams list to only members of the selected league (or shows all if global).
  // [Inbound Trigger] Recomputed when teams array or selectedLeague changes.
  // [Downstream Impact] filteredTeams is the array rendered in the accordion; league filtering affects visible team count.
  const filteredTeams = useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return teams;
    }
    return teams.filter(team =>
      selectedLeague.memberUserIds.includes(team.oduserId)
    );
  }, [teams, selectedLeague]);

  // GUID: PAGE_TEAMS-020-v01
  // [Intent] FEAT-TROPHY-002 — honour ?team= by opening that team's accordion. Teams load 25 at a
  //   time in alphabetical order, so a deep-linked team is often NOT in the first page; this keeps
  //   paging until it appears or the list is exhausted, rather than silently doing nothing.
  // [Inbound Trigger] Arriving from a team name on Standings or Results.
  // [Downstream Impact] Fires handleAccordionChange so predictions lazy-load exactly as a click
  //   would. Runs once per `team` param — the ref stops it fighting the user if they then close the
  //   accordion, and stops it re-firing after the race-change effect clears state.
  const deepLinkAppliedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!teamParam || isLoading) return;
    if (deepLinkAppliedFor.current === teamParam) return;

    // Score-space id: `uid` for a primary team, `${uid}-secondary` for a secondary one.
    const match = filteredTeams.find(t => (t.isSecondary ? `${t.oduserId}-secondary` : t.oduserId) === teamParam);
    if (match) {
      deepLinkAppliedFor.current = teamParam;
      handleAccordionChange(`${match.teamName}-${match.oduserId}`);
      return;
    }
    if (hasMore && !isLoadingMore) loadMore();
  }, [teamParam, filteredTeams, isLoading, isLoadingMore, hasMore, handleAccordionChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // GUID: PAGE_TEAMS-021-v01
  // [Intent] FEAT-TROPHY-002 — honour ?trophy= by scrolling to that trophy once the cabinet has
  //   actually rendered. This is what a podium badge on the Results page links to.
  // [Inbound Trigger] Deep link carrying `trophy`, after the target team's predictions resolve.
  // [Downstream Impact] Purely visual. Respects reduced-motion by letting the browser decide via
  //   'smooth' only when the user has not asked otherwise.
  useEffect(() => {
    if (!trophyParam || !openAccordion) return;
    const el = document.getElementById(trophyAnchorId(trophyParam));
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }, [trophyParam, openAccordion, teams]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
          Team Predictions
        </h1>
        {/* @UX(NEWBIE-24): apostrophe fix + a fuller sentence */}
        <p className="text-muted-foreground">
          View the other teams&apos; predictions for any race.
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
                <span>Showing {filteredTeams.length}{selectedLeague && !selectedLeague.isGlobal ? ` of ${teams.length}` : ''} teams</span>
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
                <AccordionItem value={`${team.teamName}-${team.oduserId}`} key={`${team.teamName}-${team.oduserId}`}>
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
                      <>
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
                        <TrophyCabinet
                          trophies={trophiesByTeam.get(team.isSecondary ? `${team.oduserId}-secondary` : team.oduserId)}
                          highlightRaceId={trophyParam}
                        />
                      </>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                {error}
              </div>
            ) : teams.length > 0 && filteredTeams.length === 0 ? (
              // @UX(NEWBIE-24): actionable empty states — say what to do next, not just "none"
              <div className="text-center py-8 text-muted-foreground">
                No teams in this league yet. Switch the league selector to &quot;Global&quot; to see
                everyone, or invite friends to join this league from the Leagues page.
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No teams found yet — you may be the first here! Check back once more players have
                signed up, or refresh the page.
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

// GUID: PAGE_TEAMS-022-v01
// [Intent] FEAT-TROPHY-002 — useSearchParams requires a Suspense boundary in the App Router; without
//   one the whole route opts out of static rendering and the build warns. Same pattern the Results
//   page already uses for its own `race` param.
// [Inbound Trigger] Next.js route render for /teams.
// [Downstream Impact] The fallback matches the page's own loading shape so the deep link does not
//   flash an empty screen while params resolve.
export default function TeamsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      }
    >
      <TeamsPageContent />
    </Suspense>
  );
}
