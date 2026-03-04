"use client";

// GUID: COMPONENT_LIVE_TIMING_CLIENT-000-v02
// [Intent] Client component for the /live page. Shows the ThePaddockPubChat
//          leaderboard widget with auto-refresh every 2 minutes. On mount and
//          on each tick, POSTs to /api/live/refresh-timing (rate-gated on server);
//          if the server updated the data, re-reads Firestore and re-renders.
// [Inbound Trigger] Mounted by LivePage server component (page.tsx) with optional
//                   initialTimingData prop to avoid first-paint loading flash.
// [Downstream Impact] Reads and displays app-settings/pub-chat-timing. Calls
//                     /api/live/refresh-timing to trigger OpenF1 fetch when stale.

import { useState, useEffect, useCallback, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw, Radio, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ThePaddockPubChat from "@/components/ThePaddockPubChat";
import { useAuth, useFirestore } from "@/firebase";
import { getPubChatTimingData } from "@/firebase/firestore/settings";
import type { PubChatTimingData } from "@/firebase/firestore/settings";
import { findNextRace } from "@/lib/data";

// Auto-refresh interval: re-check every 2 minutes
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

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

// GUID: COMPONENT_LIVE_TIMING_CLIENT-001-v02
// [Intent] Main client component. Manages timing data state, auto-refresh
//          interval, and renders the PubChat leaderboard widget.
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

  // Ref so the interval callback always has access to the latest firebaseUser
  const firebaseUserRef = useRef(firebaseUser);
  useEffect(() => { firebaseUserRef.current = firebaseUser; }, [firebaseUser]);

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

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight">Live Timing</h1>
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

      <CardContent className="p-0 flex justify-center">
        <ThePaddockPubChat
          timingData={timingData}
          viewMode="leaderboard"
        />
      </CardContent>
    </Card>
  );
}
