// GUID: ADMIN_PITWALL-000-v01
// [Intent] Admin Pit Wall manager — operational dashboard for the Pit Wall module.
//          Shows OpenF1 health, cache status, replay data management, circuit maps,
//          and cache/replay purge controls.
// [Inbound Trigger] Rendered when admin selects the "Pit Wall" tab on the admin page.
// [Downstream Impact] Reads replay_sessions via onSnapshot. Calls admin health/purge endpoints.
//                     Purge actions write to audit_logs.

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFirestore, useAuth, useCollection, useFunctions } from '@/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Activity, Database, Download, HardDrive, Map, RefreshCw, Trash2, Loader2,
  CheckCircle2, XCircle, Clock, Zap, Radio, AlertTriangle, Server,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateClientCorrelationId } from '@/lib/error-codes';

// ---------- Types ----------

interface HealthData {
  openf1: {
    reachable: boolean;
    latencyMs: number | null;
    sessionKey: number | null;
    sessionName: string | null;
  };
  cache: {
    liveData: { active: boolean; sessionKey: number | null; ageMs: number | null; expiresIn: number | null };
    detail: { active: boolean; sessionKey: number | null; ageMs: number | null; expiresIn: number | null };
    token: { valid: boolean; expiresIn: number | null };
  };
  collections: {
    replay_sessions: number;
    replay_chunks: number;
    replay_meta: number;
  };
  metrics?: {
    process: {
      heapUsedMB: number;
      heapTotalMB: number;
      heapUsedPct: number;
      rssMB: number;
      externalMB: number;
      arrayBuffersMB: number;
      uptimeSeconds: number;
      eventLoopLagMs: number;
    };
    highWaterMarks: {
      peakHeapUsedMB: number;
      peakRssMB: number;
      peakEventLoopLagMs: number;
      peakActiveRequests: number;
    };
    cache: {
      coreHits: number;
      coreMisses: number;
      coreCoalesced: number;
      detailHits: number;
      detailMisses: number;
      detailCoalesced: number;
      activeRequests: number;
      metricsAgeMs: number;
    };
    replay: {
      totalAccesses: number;
      uniqueUsers: number;
      byUser: Array<{ userId: string; count: number; lastAccessedAt: number }>;
    };
  };
  correlationId: string;
}

interface ReplaySession {
  id: string;
  sessionKey?: number;
  sessionName?: string;
  meetingName?: string;
  circuitKey?: number;
  dateStart?: string;
  durationMs?: number;
  totalDrivers?: number;
  firestoreStatus?: 'none' | 'ingesting' | 'complete' | 'failed';
  firestoreChunkCount?: number;
  firestoreTotalFrames?: number;
  firestoreError?: string | null;
  firestoreIngestStartedAt?: { _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number };
  firestoreIngestedAt?: { _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number };
  firestoreIngestCurrentEndpoint?: string;
  firestoreIngestCurrentLabel?: string;
  firestoreIngestRecordCount?: number | null;
  fileSizeBytesRaw?: number;
  fileSizeBytesGzip?: number;
  status?: string;
}

interface CircuitMapEntry {
  circuitKey: number;
  pointCount: number;
}

// GUID: ADMIN_PITWALL-001-v01
// [Intent] Pit Wall known circuits — from CIRCUIT_COORDS in live-data/route.ts.
//          Used to show which circuits have cached track paths.
const KNOWN_CIRCUITS: Record<number, string> = {
  55: 'Melbourne', 17: 'Shanghai', 63: 'Yas Marina', 6: 'Bahrain',
  73: 'Monaco', 13: 'Silverstone', 14: 'Paul Ricard', 23: 'Hungaroring',
  10: 'Spa', 33: 'Zandvoort', 22: 'Monza', 71: 'Baku',
  61: 'Singapore', 39: 'Suzuka', 66: 'Mexico City', 69: 'COTA',
  18: 'Interlagos', 80: 'Imola (approx)', 48: 'Imola', 76: 'Portimao',
};

const CIRCUIT_PATH_KEY = 'prix6_pw_circuit_path_v2';

// ---------- Component ----------

// GUID: ADMIN_PITWALL-002-v01
// [Intent] Main PitWallManager component exported for the admin tab.
export function PitWallManager() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();

  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [replaySessions, setReplaySessions] = useState<ReplaySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const [circuitMaps, setCircuitMaps] = useState<CircuitMapEntry[]>([]);

  const [purgingSession, setPurgingSession] = useState<number | null>(null);
  const [purgingAll, setPurgingAll] = useState(false);
  const [purgingCache, setPurgingCache] = useState(false);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState('');
  const [ingestingSession, setIngestingSession] = useState<number | null>(null);

  const firestore = useFirestore();
  const functions = useFunctions();

  // GUID: ADMIN_PITWALL-003-v01
  // [Intent] Fetch health data from admin endpoint.
  const fetchHealth = useCallback(async () => {
    if (!firebaseUser) return;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/pit-wall-health', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HealthData = await res.json();
      setHealth(data);
    } catch (err: any) {
      setHealthError(err.message || 'Health check failed');
    } finally {
      setHealthLoading(false);
    }
  }, [firebaseUser]);

  // GUID: ADMIN_PITWALL-004-v01
  // [Intent] Subscribe to replay_sessions collection in real-time.
  useEffect(() => {
    if (!firestore) return;
    const q = query(collection(firestore, 'replay_sessions'), orderBy('dateStart', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const sessions: ReplaySession[] = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as ReplaySession));
      setReplaySessions(sessions);
      setSessionsLoading(false);
    }, () => {
      setSessionsLoading(false);
    });
    return unsub;
  }, [firestore]);

  // GUID: ADMIN_PITWALL-005-v01
  // [Intent] Scan localStorage for cached circuit paths on mount.
  useEffect(() => {
    const maps: CircuitMapEntry[] = [];
    try {
      for (const key of Object.keys(KNOWN_CIRCUITS)) {
        const circuitKey = parseInt(key, 10);
        const stored = localStorage.getItem(`${CIRCUIT_PATH_KEY}_${circuitKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            maps.push({ circuitKey, pointCount: parsed.length });
          }
        }
      }
    } catch { /* localStorage may be unavailable */ }
    setCircuitMaps(maps);
  }, []);

  // Fetch health on mount
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // GUID: ADMIN_PITWALL-006-v01
  // [Intent] Purge replay data for a single session.
  const handlePurgeSession = useCallback(async (sessionKey: number) => {
    if (!firebaseUser) return;
    setPurgingSession(sessionKey);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/admin/purge-replay?session_key=${sessionKey}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purge failed');
      toast({ title: 'Replay purged', description: `Deleted ${data.deletedChunks} chunks for session ${sessionKey}` });
      fetchHealth(); // Refresh collection counts
    } catch (err: any) {
      toast({ title: 'Purge failed', description: err.message, variant: 'destructive' });
    } finally {
      setPurgingSession(null);
    }
  }, [firebaseUser, toast, fetchHealth]);

  // GUID: ADMIN_PITWALL-007-v01
  // [Intent] Purge all replay data — requires type-to-confirm.
  const handlePurgeAll = useCallback(async () => {
    if (confirmPurgeAll !== 'PURGE ALL' || !firebaseUser) return;
    setPurgingAll(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/purge-replay?all=true', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purge failed');
      toast({ title: 'All replay data purged', description: `Deleted ${data.deletedChunks} chunks across ${data.sessionsReset} sessions` });
      setConfirmPurgeAll('');
      fetchHealth();
    } catch (err: any) {
      toast({ title: 'Purge all failed', description: err.message, variant: 'destructive' });
    } finally {
      setPurgingAll(false);
    }
  }, [confirmPurgeAll, firebaseUser, toast, fetchHealth]);

  // GUID: ADMIN_PITWALL-008-v01
  // [Intent] Purge server-side live data cache.
  const handlePurgeCache = useCallback(async () => {
    if (!firebaseUser) return;
    setPurgingCache(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/pit-wall-cache-purge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cache purge failed');
      toast({ title: 'Cache purged', description: 'Live data, detail, and token caches cleared' });
      fetchHealth();
    } catch (err: any) {
      toast({ title: 'Cache purge failed', description: err.message, variant: 'destructive' });
    } finally {
      setPurgingCache(false);
    }
  }, [firebaseUser, toast, fetchHealth]);

  // GUID: ADMIN_PITWALL-010-v02
  // [Intent] Trigger replay ingest for a session via Cloud Function. Fire-and-forget —
  //          the onSnapshot listener on replay_sessions picks up progress automatically.
  const handleIngestSession = useCallback(async (sessionKey: number) => {
    if (!firebaseUser) return;
    setIngestingSession(sessionKey);
    try {
      const ingestFn = httpsCallable(functions, 'ingestReplaySession', { timeout: 600000 });
      // Fire-and-forget — don't await. The onSnapshot listener on replay_sessions
      // will pick up progress automatically.
      ingestFn({ sessionKey }).catch((err) => {
        console.error('[admin-ingest] Cloud Function error:', err);
      });
      toast({ title: 'Ingest started', description: 'Cloud Function triggered. Watch progress below.' });
    } catch (err: any) {
      toast({ title: 'Ingest failed', description: err.message, variant: 'destructive' });
    } finally {
      setIngestingSession(null);
    }
  }, [firebaseUser, functions, toast]);

  // GUID: ADMIN_PITWALL-011-v02
  // [Intent] Re-ingest a completed session: purge first, then trigger Cloud Function ingest.
  const handleReingestSession = useCallback(async (sessionKey: number) => {
    if (!firebaseUser) return;
    setIngestingSession(sessionKey);
    try {
      const token = await firebaseUser.getIdToken();
      // Step 1: Purge existing data
      const purgeRes = await fetch(`/api/admin/purge-replay?session_key=${sessionKey}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const purgeData = await purgeRes.json();
      if (!purgeRes.ok) throw new Error(purgeData.error || 'Purge step failed');
      // Step 2: Trigger ingest via Cloud Function (fire-and-forget)
      const ingestFn = httpsCallable(functions, 'ingestReplaySession', { timeout: 600000 });
      ingestFn({ sessionKey }).catch((err) => {
        console.error('[admin-reingest] Cloud Function error:', err);
      });
      toast({ title: 'Re-ingest started', description: `Purged ${purgeData.deletedChunks} chunks, Cloud Function ingest triggered.` });
      fetchHealth();
    } catch (err: any) {
      toast({ title: 'Re-ingest failed', description: err.message, variant: 'destructive' });
    } finally {
      setIngestingSession(null);
    }
  }, [firebaseUser, functions, toast, fetchHealth]);

  // ---------- Derived ----------

  const cachedCircuitKeys = new Set(circuitMaps.map(m => m.circuitKey));
  const missingCircuits = Object.entries(KNOWN_CIRCUITS)
    .filter(([key]) => !cachedCircuitKeys.has(parseInt(key, 10)))
    .map(([key, name]) => ({ circuitKey: parseInt(key, 10), name }));

  const totalChunks = health?.collections.replay_chunks ?? 0;
  const totalSessions = health?.collections.replay_sessions ?? 0;
  const totalMeta = health?.collections.replay_meta ?? 0;

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Section 1: Health & Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* OpenF1 Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio className="w-4 h-4" />
              OpenF1
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : healthError ? (
              <div className="flex items-center gap-2 text-red-500">
                <XCircle className="w-4 h-4" />
                <span className="text-sm">{healthError}</span>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {health?.openf1.reachable ? (
                    <Badge variant="outline" className="border-green-500 text-green-600">Reachable</Badge>
                  ) : (
                    <Badge variant="destructive">Unreachable</Badge>
                  )}
                  {health?.openf1.latencyMs != null && (
                    <span className="text-xs text-muted-foreground">{health.openf1.latencyMs}ms</span>
                  )}
                </div>
                {health?.openf1.sessionName && (
                  <p className="text-xs text-muted-foreground truncate">{health.openf1.sessionName}</p>
                )}
                <div className="flex items-center gap-1 mt-1">
                  {health?.cache.token.valid ? (
                    <Badge variant="outline" className="border-green-500 text-green-600 text-xs">Token OK</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs">No Token</Badge>
                  )}
                  {health?.cache.token.expiresIn != null && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(health.cache.token.expiresIn / 60000)}m
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live Data Cache */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Live Cache
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {health?.cache.liveData.active ? (
                    <Badge variant="outline" className="border-green-500 text-green-600">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-slate-400 text-slate-500">Empty</Badge>
                  )}
                  {health?.cache.liveData.ageMs != null && (
                    <span className="text-xs text-muted-foreground">
                      {(health.cache.liveData.ageMs / 1000).toFixed(1)}s old
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {health?.cache.detail.active ? (
                    <Badge variant="outline" className="border-blue-500 text-blue-600 text-xs">Detail Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-slate-400 text-slate-500 text-xs">Detail Empty</Badge>
                  )}
                  {health?.cache.detail.ageMs != null && (
                    <span className="text-xs text-muted-foreground">
                      {(health.cache.detail.ageMs / 1000).toFixed(1)}s old
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Collection Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4" />
              Replay Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sessions</span>
                  <span className="font-mono">{totalSessions}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chunks</span>
                  <span className="font-mono">{totalChunks}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Meta docs</span>
                  <span className="font-mono">{totalMeta}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Circuit Maps */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Map className="w-4 h-4" />
              Circuit Maps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cached</span>
                <span className="font-mono">{circuitMaps.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Missing</span>
                <span className="font-mono">{missingCircuits.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total known</span>
                <span className="font-mono">{Object.keys(KNOWN_CIRCUITS).length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Refresh button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={healthLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${healthLoading ? 'animate-spin' : ''}`} />
          Refresh Health
        </Button>
      </div>

      {/* Section 2: Replay Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Replay Sessions
          </CardTitle>
          <CardDescription>
            Durable Firestore telemetry — each session stores full-resolution GPS replay data in chunks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : replaySessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No replay sessions found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Meeting</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead className="text-right">Frames</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replaySessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div>
                        <span className="font-mono text-sm">{session.sessionKey}</span>
                        {session.sessionName && (
                          <p className="text-xs text-muted-foreground">{session.sessionName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{session.meetingName ?? '—'}</TableCell>
                    <TableCell>
                      <div>
                        <StatusBadge status={
                          ingestingSession === session.sessionKey ? 'ingesting' : (session.firestoreStatus ?? session.status ?? 'none')
                        } />
                        {/* Ingest detail: current endpoint + elapsed for ingesting sessions */}
                        {(session.firestoreStatus === 'ingesting' || ingestingSession === session.sessionKey) && (
                          <div className="text-[10px] mt-0.5 space-y-0.5">
                            {session.firestoreIngestCurrentLabel && (
                              <p className="text-cyan-400 animate-pulse">
                                Fetching: {session.firestoreIngestCurrentLabel}
                                {session.firestoreIngestRecordCount != null && session.firestoreIngestRecordCount > 0 && (
                                  <span className="text-cyan-600 ml-1">({session.firestoreIngestRecordCount.toLocaleString()} records)</span>
                                )}
                              </p>
                            )}
                            {(() => {
                              const ts = session.firestoreIngestStartedAt;
                              const secs = ts?.seconds ?? ts?._seconds;
                              if (!secs) return null;
                              const startMs = secs * 1000;
                              return (
                                <p className="text-blue-400">
                                  Started {new Date(startMs).toLocaleTimeString()}
                                  {' — '}
                                  {Math.round((Date.now() - startMs) / 1000)}s elapsed
                                </p>
                              );
                            })()}
                          </div>
                        )}
                        {/* Completed detail: ingest time + size */}
                        {session.firestoreStatus === 'complete' && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
                            {(() => {
                              const endSecs = session.firestoreIngestedAt?.seconds ?? session.firestoreIngestedAt?._seconds;
                              const startSecs = session.firestoreIngestStartedAt?.seconds ?? session.firestoreIngestStartedAt?._seconds;
                              if (!endSecs || !startSecs) return null;
                              return <p>Ingested in {Math.round(endSecs - startSecs)}s</p>;
                            })()}
                            {(session.fileSizeBytesRaw || session.fileSizeBytesGzip) && (
                              <p>
                                {session.fileSizeBytesRaw ? `${(session.fileSizeBytesRaw / 1024 / 1024).toFixed(1)} MB` : ''}
                                {session.fileSizeBytesGzip ? ` (${(session.fileSizeBytesGzip / 1024 / 1024).toFixed(1)} MB gz)` : ''}
                              </p>
                            )}
                          </div>
                        )}
                        {session.firestoreError && session.firestoreStatus === 'failed' && (
                          <p className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={session.firestoreError}>
                            {session.firestoreError}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {session.firestoreChunkCount ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {session.firestoreTotalFrames?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {session.durationMs
                        ? `${Math.round(session.durationMs / 60000)}m`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Ingest button — shown for sessions with no data or failed */}
                        {(!session.firestoreStatus || session.firestoreStatus === 'none' || session.firestoreStatus === 'failed') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Ingest replay data from OpenF1"
                            onClick={() => session.sessionKey && handleIngestSession(session.sessionKey)}
                            disabled={ingestingSession === session.sessionKey}
                          >
                            {ingestingSession === session.sessionKey ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4 text-green-500" />
                            )}
                          </Button>
                        )}
                        {/* Re-ingest button — shown for completed sessions */}
                        {session.firestoreStatus === 'complete' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Purge and re-ingest replay data"
                            onClick={() => session.sessionKey && handleReingestSession(session.sessionKey)}
                            disabled={ingestingSession === session.sessionKey}
                          >
                            {ingestingSession === session.sessionKey ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4 text-blue-500" />
                            )}
                          </Button>
                        )}
                        {/* Purge button — shown for complete or failed */}
                        {(session.firestoreStatus === 'complete' || session.firestoreStatus === 'failed') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Purge replay data"
                            onClick={() => session.sessionKey && handlePurgeSession(session.sessionKey)}
                            disabled={purgingSession === session.sessionKey}
                          >
                            {purgingSession === session.sessionKey ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4 text-red-500" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Purge All */}
          {replaySessions.some(s => s.firestoreStatus === 'complete') && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-mono font-bold">PURGE ALL</span> to delete all replay data:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={confirmPurgeAll}
                  onChange={(e) => setConfirmPurgeAll(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm font-mono w-40"
                  placeholder="PURGE ALL"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handlePurgeAll}
                  disabled={confirmPurgeAll !== 'PURGE ALL' || purgingAll}
                >
                  {purgingAll ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-2" />
                  )}
                  Purge All Replay Data
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Circuit Maps Detail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Map className="w-5 h-5" />
            Circuit Map Cache
          </CardTitle>
          <CardDescription>
            Track outlines cached in localStorage (key: {CIRCUIT_PATH_KEY}). Built by P1 sequential GPS tracking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cached circuits */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Cached ({circuitMaps.length})
              </h4>
              {circuitMaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No circuits cached in this browser.</p>
              ) : (
                <div className="space-y-1">
                  {circuitMaps.map(m => (
                    <div key={m.circuitKey} className="flex justify-between text-sm">
                      <span>{KNOWN_CIRCUITS[m.circuitKey] ?? `Circuit ${m.circuitKey}`}</span>
                      <span className="font-mono text-muted-foreground">{m.pointCount} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Missing circuits */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Not Cached ({missingCircuits.length})
              </h4>
              {missingCircuits.length === 0 ? (
                <p className="text-sm text-muted-foreground">All known circuits are cached.</p>
              ) : (
                <div className="space-y-1">
                  {missingCircuits.map(m => (
                    <div key={m.circuitKey} className="text-sm text-muted-foreground">
                      {m.name} <span className="font-mono">({m.circuitKey})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Cache Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Cache Control
          </CardTitle>
          <CardDescription>
            Server-side caches for OpenF1 live data. Purging forces a fresh fetch on the next poll cycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Live data TTL:</span>{' '}
                <span className="font-mono">2s</span> (active) / <span className="font-mono">60s</span> (idle)
              </p>
              <p>
                <span className="text-muted-foreground">Detail TTL:</span>{' '}
                <span className="font-mono">10s</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Cache auto-regenerates on next user request. Zero data loss risk.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handlePurgeCache}
              disabled={purgingCache}
            >
              {purgingCache ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Purge Cache
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* GUID: ADMIN_PITWALL-009-v01 */}
      {/* [Intent] Performance Metrics card — cache hit/coalesce rates, process health, replay usage. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" />
            Performance Metrics
          </CardTitle>
          <CardDescription>
            Cache efficiency, process health, and replay usage since last reset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {health?.metrics ? (
            <>
              {/* Cache Performance */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cache Performance</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {(() => {
                    const m = health.metrics.cache;
                    const coreTotal = m.coreHits + m.coreMisses + m.coreCoalesced;
                    const coreHitRate = coreTotal > 0 ? Math.round((m.coreHits / coreTotal) * 100) : 0;
                    const coreCoalesceRate = coreTotal > 0 ? Math.round((m.coreCoalesced / coreTotal) * 100) : 0;
                    const detailTotal = m.detailHits + m.detailMisses + m.detailCoalesced;
                    const detailHitRate = detailTotal > 0 ? Math.round((m.detailHits / detailTotal) * 100) : 0;
                    return (
                      <>
                        <p>
                          <span className="text-muted-foreground">Core hit rate:</span>{' '}
                          <Badge variant="outline" className={coreHitRate > 80 ? 'border-green-500 text-green-600' : coreHitRate > 50 ? 'border-amber-500 text-amber-600' : 'border-red-500 text-red-600'}>
                            {coreHitRate}%
                          </Badge>
                          <span className="text-xs text-muted-foreground ml-1">({m.coreHits}/{coreTotal})</span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Detail hit rate:</span>{' '}
                          <Badge variant="outline" className={detailHitRate > 80 ? 'border-green-500 text-green-600' : 'border-amber-500 text-amber-600'}>
                            {detailHitRate}%
                          </Badge>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Core coalesced:</span>{' '}
                          <span className="font-mono">{m.coreCoalesced}</span>
                          {coreCoalesceRate > 0 && <span className="text-xs text-cyan-500 ml-1">({coreCoalesceRate}% saved)</span>}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Active / Peak:</span>{' '}
                          <span className="font-mono">{m.activeRequests}</span>
                          {' / '}
                          <span className="font-mono">{health.metrics!.highWaterMarks.peakActiveRequests}</span>
                        </p>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Process Health */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Process Health</p>
                <div className="space-y-1.5">
                  {/* Heap bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                      <span>Heap</span>
                      <span>{health.metrics.process.heapUsedMB} / {health.metrics.process.heapTotalMB} MB ({health.metrics.process.heapUsedPct}%)</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${health.metrics.process.heapUsedPct > 85 ? 'bg-red-500' : health.metrics.process.heapUsedPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(100, health.metrics.process.heapUsedPct)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-sm">
                    <p>
                      <span className="text-muted-foreground">RSS:</span>{' '}
                      <span className="font-mono">{health.metrics.process.rssMB} MB</span>
                      <span className="text-xs text-muted-foreground ml-1">(peak {health.metrics.highWaterMarks.peakRssMB})</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Event loop:</span>{' '}
                      <span className={`font-mono ${health.metrics.process.eventLoopLagMs > 50 ? 'text-red-400' : health.metrics.process.eventLoopLagMs > 10 ? 'text-amber-400' : 'text-green-400'}`}>
                        {health.metrics.process.eventLoopLagMs}ms
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">(peak {health.metrics.highWaterMarks.peakEventLoopLagMs}ms)</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Uptime:</span>{' '}
                      <span className="font-mono">{Math.round(health.metrics.process.uptimeSeconds / 60)}m</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Metrics age:</span>{' '}
                      <span className="font-mono">{Math.round(health.metrics.cache.metricsAgeMs / 60000)}m</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Replay Usage */}
              {health.metrics.replay.totalAccesses > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Replay Usage ({health.metrics.replay.totalAccesses} total, {health.metrics.replay.uniqueUsers} users)
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead>
                        <TableHead className="text-xs text-right">Count</TableHead>
                        <TableHead className="text-xs text-right">Last Access</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {health.metrics.replay.byUser.slice(0, 10).map(u => (
                        <TableRow key={u.userId}>
                          <TableCell className="text-xs font-mono">{u.userId.slice(0, 12)}…</TableCell>
                          <TableCell className="text-xs text-right">{u.count}</TableCell>
                          <TableCell className="text-xs text-right">{new Date(u.lastAccessedAt).toLocaleTimeString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Reset button */}
              <div className="flex justify-end pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      if (!firebaseUser) return;
                      const idToken = await firebaseUser.getIdToken();
                      await fetch('/api/admin/pit-wall-cache-purge?resetMetrics=true', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${idToken}` },
                      });
                      toast({ title: 'Metrics reset', description: 'Counters and high-water marks cleared.' });
                      fetchHealth();
                    } catch {
                      toast({ title: 'Failed to reset metrics', variant: 'destructive' });
                    }
                  }}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Reset Metrics
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Metrics unavailable — refresh health check.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Sub-components ----------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <Badge variant="outline" className="border-green-500 text-green-600">Complete</Badge>;
    case 'ingesting':
      return <Badge variant="outline" className="border-blue-500 text-blue-600">Ingesting</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    case 'available':
      return <Badge variant="outline" className="border-cyan-500 text-cyan-600">Available</Badge>;
    default:
      return <Badge variant="outline" className="border-slate-400 text-slate-500">None</Badge>;
  }
}
