'use client';

import { useMemo } from 'react';
import { useDoc, useFirestore, useAuth } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  HardDrive,
  ShieldCheck,
  FlaskConical,
  Lock,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useState } from 'react';
import { createAppError, generateClientCorrelationId, formatErrorForDisplay } from '@/lib/error-codes';

interface BackupStatus {
  id: string;
  lastBackupTimestamp?: { seconds: number; nanoseconds: number };
  lastBackupStatus?: 'SUCCESS' | 'FAILED';
  lastBackupPath?: string | null;
  lastBackupError?: string | null;
  backupCorrelationId?: string;
  lastSmokeTestTimestamp?: { seconds: number; nanoseconds: number };
  lastSmokeTestStatus?: 'SUCCESS' | 'FAILED';
  lastSmokeTestError?: string | null;
  smokeTestCorrelationId?: string;
  bucketRetentionLockEnabled?: boolean;
  bucketRetentionDays?: number;
  updatedAt?: { seconds: number; nanoseconds: number };
}

function TimestampDisplay({ ts }: { ts?: { seconds: number; nanoseconds: number } }) {
  if (!ts) return <span className="text-muted-foreground">Never</span>;
  const date = new Date(ts.seconds * 1000);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            {formatDistanceToNow(date, { addSuffix: true })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-mono text-xs">{format(date, 'yyyy-MM-dd HH:mm:ss.SSS')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function StatusBadge({ status }: { status?: 'SUCCESS' | 'FAILED' }) {
  if (!status) {
    return <Badge variant="outline" className="text-muted-foreground">No data</Badge>;
  }
  if (status === 'SUCCESS') {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Success
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-500/10 text-red-500 border-red-500/30">
      <XCircle className="w-3 h-3 mr-1" />
      Failed
    </Badge>
  );
}

export function BackupHealthDashboard() {
  const firestore = useFirestore();
  const { user } = useAuth();

  const statusRef = useMemo(() => {
    if (!firestore || !user?.isAdmin) return null;
    return doc(firestore, 'backup_status', 'latest');
  }, [firestore, user?.isAdmin]);

  const { data, isLoading, error } = useDoc<BackupStatus>(statusRef);

  // Loading state
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    const correlationId = generateClientCorrelationId();
    const appError = createAppError('BACKUP_STATUS_READ_FAILED', correlationId, error.message);
    const display = formatErrorForDisplay(appError);

    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{display.title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{display.description}</p>
          <code className="text-xs select-all block bg-muted p-2 rounded">
            {display.copyableText}
          </code>
        </AlertDescription>
      </Alert>
    );
  }

  // First-run state: document doesn't exist yet
  if (!data) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>No backup data yet</AlertTitle>
        <AlertDescription>
          The backup system has not run yet. Once <code>dailyBackup</code> executes
          for the first time, status will appear here. Deploy Cloud Functions and
          verify with: <code className="text-xs">gcloud functions call dailyBackup</code>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Normal state: render three-column dashboard ──────────────
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* ── Backup Status Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-sky-500" />
              Backup Status
            </CardTitle>
            <StatusBadge status={data.lastBackupStatus} />
          </div>
          <CardDescription>Daily Firestore + Auth export</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last run
            </span>
            <TimestampDisplay ts={data.lastBackupTimestamp} />
          </div>

          {data.lastBackupPath && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Path</span>
              <span className="font-mono text-xs truncate max-w-[180px]" title={data.lastBackupPath}>
                {data.lastBackupPath}
              </span>
            </div>
          )}

          {data.backupCorrelationId && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Correlation</span>
              <span className="flex items-center gap-1">
                <code className="text-xs font-mono truncate max-w-[140px]">
                  {data.backupCorrelationId}
                </code>
                <CopyButton text={data.backupCorrelationId} />
              </span>
            </div>
          )}

          {data.lastBackupError && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-500">
              {data.lastBackupError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Immutability Lock Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-sky-500" />
              Immutability Lock
            </CardTitle>
            {data.bucketRetentionLockEnabled ? (
              <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Locked
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not reported
              </Badge>
            )}
          </div>
          <CardDescription>Object Retention Lock on backup bucket</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bucket</span>
            <span className="font-mono text-xs">gs://prix6-backups</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Retention</span>
            <span>{data.bucketRetentionDays ? `${data.bucketRetentionDays} days` : '7 days (configured)'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lock type</span>
            <span>Object Retention Lock</span>
          </div>
          <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-600 dark:text-amber-400">
            Retention lock is irreversible. Backups cannot be deleted before the retention period expires.
          </div>
        </CardContent>
      </Card>

      {/* ── Smoke Test Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-sky-500" />
              Smoke Test
            </CardTitle>
            <StatusBadge status={data.lastSmokeTestStatus} />
          </div>
          <CardDescription>Sunday recovery verification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last run
            </span>
            <TimestampDisplay ts={data.lastSmokeTestTimestamp} />
          </div>

          {data.smokeTestCorrelationId && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Correlation</span>
              <span className="flex items-center gap-1">
                <code className="text-xs font-mono truncate max-w-[140px]">
                  {data.smokeTestCorrelationId}
                </code>
                <CopyButton text={data.smokeTestCorrelationId} />
              </span>
            </div>
          )}

          {data.lastSmokeTestError && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-500">
              {data.lastSmokeTestError}
            </div>
          )}

          {!data.lastSmokeTestTimestamp && (
            <div className="mt-2 p-2 bg-muted rounded text-xs text-muted-foreground">
              Smoke test runs every Sunday at 04:00 UTC. It imports the latest backup into a recovery project and verifies key documents exist.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
