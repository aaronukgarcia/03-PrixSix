"use client";

// GUID: COMPONENT_LIVE_TIMING_CLIENT-000-v05
// [Intent] Client component for the /live (PubChat) page. Shows the ThePaddockPubChat
//          widget with Leaderboard, Team Lens, Comparison, and Chatter tabs, plus
//          auto-refresh every 2 minutes.
//          Chatter tab: calls /api/ai/pit-chatter to generate paddock commentary
//          from the current live timing snapshot. Rate-limited to 5/hour per user.
// [Inbound Trigger] Mounted by LivePage server component (page.tsx) with optional
//                   initialTimingData prop to avoid first-paint loading flash.
// [Downstream Impact] Reads and displays app-settings/pub-chat-timing. Calls
//                     /api/live/refresh-timing to trigger OpenF1 fetch when stale.
// @FIX(v05) Added Chatter tab with AI-generated pit-side commentary.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw, Radio, CalendarClock, Mic2, RotateCcw, Flag } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ThePaddockPubChat from "@/components/ThePaddockPubChat";
import { useAuth, useFirestore } from "@/firebase";
import { getPubChatTimingData } from "@/firebase/firestore/settings";
import type { PubChatTimingData } from "@/firebase/firestore/settings";
import { getOfficialTeams } from "@/firebase/firestore/official-teams";
import type { OfficialTeam } from "@/firebase/firestore/official-teams";
import { findNextRace } from "@/lib/data";

// Auto-refresh interval: re-check every 2 minutes
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_TEAM = 'Williams';

type ViewTab = 'leaderboard' | 'team-lens' | 'comparison' | 'chatter';

interface ChatterState {
  text: string;
  persona: string;
  personaTitle: string;
}

interface LiveTimingClientProps {
  initialTimingData: PubChatTimingData | null;
}

// GUID: COMPONENT_LIVE_TIMING_CLIENT-003-v01
// [Intent] Derive the next expected FP1 session label from the race schedule.
//          FP1 is approximately 1 day before qualifying (2 days for sprint weekends).
// [Inbound Trigger] Called inline in the render pass of LiveTimingClient.
// [Downstream Impact] Used to render "Next expected: [location] FP1 · [day]" hint.
function getNextTracksideLabel(): { location: string; dayLabel: string } | null {
  const next = findNextRace();
  if (!next) return null;
  const fp1 = new Date(
    new Date(next.qualifyingTime).getTime() - (next.hasSprint ? 2 : 1) * 24 * 60 * 60 * 1000
  );
  const dayLabel = fp1.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return { location: next.location, dayLabel };
}

// GUID: COMPONENT_LIVE_TIMING_CLIENT-001-v04
// [Intent] Main client component. Manages timing data state, tab selection,
//          team lens selection (defaults to Williams), auto-refresh interval,
//          and renders the PubChat widget with all three view modes.
// [Inbound Trigger] Mounted by server page component on /live route.
// [Downstream Impact] Triggers /api/live/refresh-timing on mount and every
//                     2 minutes. Re-reads Firestore when server signals new data.
export default function LiveTimingClient({ initialTimingData }: LiveTimingClientProps) {
  const { firebaseUser } = useAuth();
  const db = useFirestore();

  const [timingData, setTimingData] = useState<PubChatTimingData | null>(initialTimingData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('leaderboard');
  const [officialTeams, setOfficialTeams] = useState<OfficialTeam[]>([]);
  const [selectedTeamName, setSelectedTeamName] = useState<string>(DEFAULT_TEAM);
  const [chatter, setChatter] = useState<ChatterState | null>(null);
  const [isGeneratingChatter, setIsGeneratingChatter] = useState(false);
  const [chatterError, setChatterError] = useState<string | null>(null);

  // Ref so the interval callback always has access to the latest firebaseUser
  const firebaseUserRef = useRef(firebaseUser);
  useEffect(() => { firebaseUserRef.current = firebaseUser; }, [firebaseUser]);

  // Load official teams once on mount for Team Lens
  useEffect(() => {
    if (!db) return;
    getOfficialTeams(db).then(setOfficialTeams);
  }, [db]);

  // GUID: COMPONENT_LIVE_TIMING_CLIENT-002-v01
  // [Intent] POST to /api/live/refresh-timing to trigger an OpenF1 refresh.
  //          Rate gate is enforced server-side — if data is fresh (<15 min),
  //          server returns { fresh: true } and we skip the Firestore re-read.
  //          If stale, server fetches from OpenF1 and we re-read from Firestore.
  // [Inbound Trigger] Called on mount and by the setInterval tick.
  // [Downstream Impact] Updates timingData state and lastChecked timestamp.
  const checkAndRefresh = useCallback(async () => {
    const currentUser = firebaseUserRef.current;
    if (!currentUser || !db) return;

    setIsRefreshing(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/live/refresh-timing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setStatusMessage(json.error || `Refresh failed (${res.status})`);
      } else {
        const json = await res.json();
        if (json.success) {
          // Always re-read Firestore to get the latest data (whether fresh or just updated)
          const freshData = await getPubChatTimingData(db, true);
          setTimingData(freshData);
          if (!json.fresh && json.sessionName) {
            setStatusMessage(`Updated: ${json.sessionName}${json.location ? ` · ${json.location}` : ''}`);
          } else {
            setStatusMessage(null);
          }
        }
      }
    } catch {
      // Network error — non-fatal, keep showing existing data
      setStatusMessage('Connection error — showing last known data');
    } finally {
      setLastChecked(new Date());
      setIsRefreshing(false);
    }
  }, [db]);

  // GUID: COMPONENT_LIVE_TIMING_CLIENT-004-v01
  // [Intent] POST current timing snapshot to /api/ai/pit-chatter and store the
  //          returned commentary in state. Rate-limited server-side (5/hour).
  // [Inbound Trigger] User clicks "Generate Chatter" or "New Take" button.
  // [Downstream Impact] Calls Vertex AI (Gemini). Chatter lives in component state only.
  const generateChatter = useCallback(async () => {
    const currentUser = firebaseUserRef.current;
    if (!currentUser || !timingData) return;

    setIsGeneratingChatter(true);
    setChatterError(null);
    try {
      const token = await currentUser.getIdToken();
      const payload = {
        session: {
          name: timingData.session.sessionName,
          meeting: timingData.session.meetingName,
          location: timingData.session.location,
        },
        drivers: timingData.drivers.slice(0, 10).map(d => ({
          position: d.position,
          name: d.driver,
          team: d.team,
          time: d.time,
          tyre: d.tyreCompound ?? null,
          laps: d.laps,
        })),
      };
      const res = await fetch('/api/ai/pit-chatter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setChatter({ text: json.chatter, persona: json.persona, personaTitle: json.personaTitle });
      } else if (res.status === 429) {
        setChatterError('Rate limit reached — try again in an hour.');
      } else {
        setChatterError('Could not generate chatter. Try again.');
      }
    } catch {
      setChatterError('Connection error — try again.');
    } finally {
      setIsGeneratingChatter(false);
    }
  }, [timingData]);

  // Trigger on mount
  useEffect(() => {
    checkAndRefresh();
  }, [checkAndRefresh]);

  // Set up auto-refresh interval
  useEffect(() => {
    const intervalId = setInterval(checkAndRefresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [checkAndRefresh]);

  const sessionLabel = timingData
    ? [
        timingData.session.meetingName,
        timingData.session.sessionName,
        timingData.session.location,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  // Resolve Team Lens props from selected team name
  const selectedTeam = officialTeams.find(t => t.teamName === selectedTeamName);
  const officialDrivers = selectedTeam?.drivers ?? [];
  const officialTeamColour = selectedTeam?.teamColour;

  // Sorted team names for the selector
  const teamNames = officialTeams.map(t => t.teamName).sort();

  // GUID: COMPONENT_LIVE_TIMING_CLIENT-005-v01
  // [Intent] Detect "between race weekends" state — the stored timing data is from a
  //          completed session (>6h since start) AND the next race qualifying is still
  //          in the future. When true, show a next-race countdown panel instead of stale
  //          lap data leaderboard. Prevents PubChat from being stuck on last week's race.
  // [Inbound Trigger] Recomputed whenever timingData changes.
  // [Downstream Impact] Replaces the leaderboard/tabs with a "Next Race" panel in the UI.
  const nextRace = findNextRace();
  const isBetweenRaces = useMemo(() => {
    if (!timingData?.session?.dateStart || !nextRace) return false;
    const hoursSinceSessionStart =
      (Date.now() - new Date(timingData.session.dateStart).getTime()) / (1000 * 60 * 60);
    const nextQualifyingInFuture = new Date(nextRace.qualifyingTime) > new Date();
    return hoursSinceSessionStart > 6 && nextQualifyingInFuture;
  }, [timingData, nextRace]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight">PubChat</h1>
            {sessionLabel && (
              <p className="text-sm text-muted-foreground truncate">{sessionLabel}</p>
            )}
            {statusMessage && (
              <p className="text-xs text-muted-foreground mt-0.5">{statusMessage}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <RefreshCw className="h-4 w-4 text-muted-foreground/40" />
            )}
            {lastChecked && (
              <p className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                {formatDistanceToNow(lastChecked, { addSuffix: true })}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Auto-refresh · 2 min
          </Badge>
          {timingData?.fetchedBy && (
            <Badge
              variant={timingData.fetchedBy === 'auto' ? 'secondary' : 'outline'}
              className="text-[10px] px-1.5 py-0"
            >
              {timingData.fetchedBy === 'auto' ? 'Live' : 'Admin fetch'}
            </Badge>
          )}
        </div>

        <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
          {timingData && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Radio className="h-3 w-3 flex-shrink-0" />
              Last from track: {timingData.session.sessionName} · {timingData.session.location}
            </p>
          )}
          {(() => {
            const n = getNextTracksideLabel();
            return n ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <CalendarClock className="h-3 w-3 flex-shrink-0" />
                Next expected: {n.location} FP1 · {n.dayLabel}
              </p>
            ) : null;
          })()}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Between race weekends — show next race info instead of stale lap data */}
        {isBetweenRaces && nextRace && (
          <div className="px-4 py-8 space-y-5 text-center">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Between Races</p>
              <h2 className="text-lg font-bold">{nextRace.name}</h2>
              <p className="text-sm text-muted-foreground">{nextRace.location}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Qualifying</p>
                <p className="text-sm font-semibold">
                  {new Date(nextRace.qualifyingTime).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(nextRace.qualifyingTime), { addSuffix: true })}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Race</p>
                <p className="text-sm font-semibold">
                  {new Date(nextRace.raceTime).toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(nextRace.raceTime), { addSuffix: true })}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border/40 p-3 space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <Flag className="h-3 w-3 text-muted-foreground/60" />
                <p className="text-[11px] text-muted-foreground">
                  Live timing available from{' '}
                  {(() => {
                    const n = getNextTracksideLabel();
                    return n ? `${n.location} FP1 · ${n.dayLabel}` : 'FP1';
                  })()}
                </p>
              </div>
              {timingData && (
                <p className="text-[10px] text-muted-foreground/50">
                  Last session: {timingData.session.sessionName} · {timingData.session.location}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Active race weekend — show leaderboard tabs */}
        {!isBetweenRaces && <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ViewTab)}>
          <div className="px-4 pb-0 border-b border-border/60">
            <TabsList className="h-8 bg-transparent p-0 gap-4">
              <TabsTrigger
                value="leaderboard"
                className="h-8 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs"
              >
                Leaderboard
              </TabsTrigger>
              <TabsTrigger
                value="team-lens"
                className="h-8 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs"
              >
                Team Lens
              </TabsTrigger>
              <TabsTrigger
                value="comparison"
                className="h-8 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs"
              >
                Comparison
              </TabsTrigger>
              <TabsTrigger
                value="chatter"
                className="h-8 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs flex items-center gap-1"
              >
                <Mic2 className="h-3 w-3" />
                Chatter
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="leaderboard" className="mt-0 flex justify-center">
            <ThePaddockPubChat
              timingData={timingData}
              viewMode="leaderboard"
            />
          </TabsContent>

          <TabsContent value="team-lens" className="mt-0">
            {teamNames.length > 0 && (
              <div className="px-4 pt-3 pb-1">
                <Select value={selectedTeamName} onValueChange={setSelectedTeamName}>
                  <SelectTrigger className="h-8 text-xs w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teamNames.map(name => (
                      <SelectItem key={name} value={name} className="text-xs">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-center">
              <ThePaddockPubChat
                timingData={timingData}
                viewMode="team-lens"
                selectedTeam={selectedTeamName}
                officialDrivers={officialDrivers}
                officialTeamColour={officialTeamColour}
              />
            </div>
          </TabsContent>

          <TabsContent value="comparison" className="mt-0 flex justify-center">
            <ThePaddockPubChat
              timingData={timingData}
              viewMode="comparison"
            />
          </TabsContent>

          <TabsContent value="chatter" className="mt-0">
            <div className="px-4 py-5 space-y-4">
              {/* Empty state / Generate button */}
              {!chatter && !isGeneratingChatter && (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Mic2 className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Get a live take from the paddock
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    AI commentary based on the current session data · 5 generates/hour
                  </p>
                  <Button
                    size="sm"
                    onClick={generateChatter}
                    disabled={!timingData}
                    className="mt-1"
                  >
                    Generate Chatter
                  </Button>
                </div>
              )}

              {/* Loading */}
              {isGeneratingChatter && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Listening in from the pitwall…</p>
                </div>
              )}

              {/* Error */}
              {chatterError && !isGeneratingChatter && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-xs text-destructive">{chatterError}</p>
                  <Button size="sm" variant="outline" onClick={generateChatter}>
                    Try again
                  </Button>
                </div>
              )}

              {/* Chatter result */}
              {chatter && !isGeneratingChatter && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold">{chatter.persona}</p>
                      <p className="text-[10px] text-muted-foreground">{chatter.personaTitle}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 text-xs text-muted-foreground"
                      onClick={generateChatter}
                    >
                      <RotateCcw className="h-3 w-3" />
                      New take
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{chatter.text}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 text-right">AI generated · not real quotes</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>}
      </CardContent>
    </Card>
  );
}
