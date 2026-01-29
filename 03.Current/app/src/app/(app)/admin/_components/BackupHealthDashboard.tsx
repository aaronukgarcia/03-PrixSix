// GUID: BACKUP_DASHBOARD-000-v03
// [Intent] Admin-only dashboard tab showing backup health across three cards:
//          daily backup status, bucket immutability lock info, and Sunday smoke
//          test results. Subscribes in real-time to backup_status/latest via useDoc.
// [Inbound Trigger] Rendered when the admin selects the "Backups" tab on the admin page.
// [Downstream Impact] Read-only — displays data written by Cloud Functions
//                     (dailyBackup and runRecoveryTest). No writes to Firestore.
'use client';

import { useMemo, useState, useCallback } from 'react';
import { useDoc, useFirestore, useAuth, useFunctions } from '@/firebase';
import { doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
  Play,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { createAppError, generateClientCorrelationId, formatErrorForDisplay } from '@/lib/error-codes';
import { useToast } from '@/hooks/use-toast';

// GUID: BACKUP_DASHBOARD-001-v03
// [Intent] Type definition mirroring the Firestore document shape written by
//          Cloud Functions. All fields are optional because the doc may be
//          partially populated (e.g. smoke test hasn't run yet) or missing
//          entirely on first-run.
// [Inbound Trigger] N/A — type definition.
// [Downstream Impact] Used by useDoc<BackupStatus>() to type the real-time
//                     subscription result throughout this component.
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

// GUID: BACKUP_DASHBOARD-002-v03
/**
 * TimestampDisplay — Renders a Firestore Timestamp as relative time with
 *                    an absolute tooltip on hover.
 *
 * [Intent] Show "3 hours ago" for quick scanning, with full ISO timestamp
 *          available on hover for precise debugging.
 * [Inbound Trigger] Rendered by the Backup Status and Smoke Test cards
 *                   whenever a timestamp field is present.
 * [Downstream Impact] Read-only display component. No side effects.
 */
function TimestampDisplay({ ts }: { ts?: { seconds: number; nanoseconds: number } }) {
  // If no timestamp exists (e.g. smoke test has never run), show placeholder
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

// GUID: BACKUP_DASHBOARD-003-v03
/**
 * CopyButton — One-click clipboard copy for correlation IDs.
 *
 * [Intent] Let ops copy a correlation ID with a single click for pasting
 *          into Cloud Logging search or incident reports.
 * [Inbound Trigger] Rendered next to every correlation ID in the dashboard.
 * [Downstream Impact] Writes to system clipboard. Shows a green check for
 *                     2 seconds as visual confirmation, then reverts to copy icon.
 */
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

// GUID: BACKUP_DASHBOARD-004-v03
/**
 * StatusBadge — Renders a colour-coded badge for SUCCESS / FAILED / No data.
 *
 * [Intent] Provide instant visual feedback on backup or smoke test health.
 *          Green = success, red = failure, outline = no data yet.
 * [Inbound Trigger] Rendered in Backup Status card header and Smoke Test card header.
 * [Downstream Impact] Read-only display. No side effects.
 */
function StatusBadge({ status }: { status?: 'SUCCESS' | 'FAILED' }) {
  // No status = the backup/smoke test hasn't run yet
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
  // status === 'FAILED'
  return (
    <Badge className="bg-red-500/10 text-red-500 border-red-500/30">
      <XCircle className="w-3 h-3 mr-1" />
      Failed
    </Badge>
  );
}

// GUID: BACKUP_DASHBOARD-010-v03
/**
 * BackupHealthDashboard — Main exported component for the admin "Backups" tab.
 *
 * [Intent] Provide admins with a single-glance overview of backup system health.
 *          Three cards: (1) daily backup status, (2) bucket immutability info,
 *          (3) Sunday smoke test results. Handles four states: loading, error,
 *          first-run (no data), and normal operation.
 *
 * [Inbound Trigger] Mounted when user clicks the "Backups" TabsTrigger in
 *                   admin/page.tsx. Re-renders in real-time via useDoc subscription.
 *
 * [Downstream Impact] Read-only — subscribes to backup_status/latest via useDoc.
 *                     On error, creates PX-7001 (BACKUP_STATUS_READ_FAILED) for
 *                     display via the standard error code system.
 */
export function BackupHealthDashboard() {
  const firestore = useFirestore();
  const functions = useFunctions();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleBackupNow = useCallback(async () => {
    setIsBackingUp(true);
    try {
      const manualBackup = httpsCallable(functions, 'manualBackup');
      const result = await manualBackup();
      const data = result.data as { success: boolean; correlationId?: string; backupPath?: string; error?: string };

      if (data.success) {
        toast({
          title: 'Backup Complete',
          description: `Backup saved to ${data.backupPath}`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Backup Failed',
          description: data.error || 'Unknown error',
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Backup Failed',
        description: err.message || 'Failed to trigger backup',
      });
    } finally {
      setIsBackingUp(false);
    }
  }, [functions, toast]);

  // GUID: BACKUP_DASHBOARD-011-v03
  // [Intent] Memoize the DocumentReference to prevent useDoc from re-subscribing
  //          on every render. Returns null if Firestore isn't ready or the user
  //          isn't an admin (guards against non-admin rendering edge cases).
  // [Inbound Trigger] Component mount or firestore/user state change.
  // [Downstream Impact] Passed to useDoc — null ref means no subscription is created.
  const statusRef = useMemo(() => {
    if (!firestore || !user?.isAdmin) return null;
    return doc(firestore, 'backup_status', 'latest');
  }, [firestore, user?.isAdmin]);

  const { data, isLoading, error } = useDoc<BackupStatus>(statusRef);

  // GUID: BACKUP_DASHBOARD-012-v03
  // [Intent] Show skeleton cards while the Firestore subscription is establishing.
  //          Matches the three-column layout so the page doesn't jump on load.
  // [Inbound Trigger] useDoc isLoading = true (initial subscription).
  // [Downstream Impact] Renders 3 skeleton cards. No Firestore reads beyond useDoc.
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

  // GUID: BACKUP_DASHBOARD-013-v03
  // [Intent] Handle Firestore permission errors or network failures gracefully.
  //          Uses the standard PX-7001 error code so the error is trackable in
  //          the error log system and copyable by the admin.
  // [Inbound Trigger] useDoc returns an error (e.g. missing Firestore rules,
  //                   network timeout, or permission denied).
  // [Downstream Impact] Renders a destructive Alert with copyable error details.
  //                     Does NOT write to error_logs — this is a client-side display.
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

  // GUID: BACKUP_DASHBOARD-014-v03
  // [Intent] Handle first-run state: the backup_status/latest document doesn't
  //          exist yet because dailyBackup hasn't executed for the first time.
  //          Show an informational alert instead of empty/broken cards.
  // [Inbound Trigger] useDoc returns data = null (document doesn't exist).
  // [Downstream Impact] Displays setup instructions. Will auto-update when the
  //                     document is created (useDoc subscription is still active).
  if (!data) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>No backup data yet</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            The backup system has not run yet. Once <code>dailyBackup</code> executes
            for the first time, status will appear here.
          </p>
          {/* 7a3f1d2e — surface Backup Now in empty state so admins can seed
              the first backup from the UI without needing CLI access */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleBackupNow}
            disabled={isBackingUp}
            className="h-7 text-xs"
          >
            {isBackingUp ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            {isBackingUp ? 'Backing up…' : 'Backup Now'}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // GUID: BACKUP_DASHBOARD-020-v03
  // [Intent] Normal state — render the three-column card dashboard showing
  //          backup status, immutability lock info, and smoke test results.
  // [Inbound Trigger] useDoc returns valid data from backup_status/latest.
  // [Downstream Impact] Read-only display. All data comes from the useDoc subscription.
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* GUID: BACKUP_DASHBOARD-021-v03
          [Intent] Backup Status Card — shows the last daily backup result including
                   timestamp, GCS path, correlation ID, and any error message.
          [Inbound Trigger] backup_status/latest has lastBackupTimestamp set.
          [Downstream Impact] Read-only display. Correlation ID is copyable via CopyButton. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-sky-500" />
              Backup Status
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackupNow}
                disabled={isBackingUp}
                className="h-7 text-xs"
              >
                {isBackingUp ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                {isBackingUp ? 'Backing up…' : 'Backup Now'}
              </Button>
              <StatusBadge status={data.lastBackupStatus} />
            </div>
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

          {/* Conditionally show GCS path only when a backup has succeeded */}
          {data.lastBackupPath && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Path</span>
              <span className="font-mono text-xs truncate max-w-[180px]" title={data.lastBackupPath}>
                {data.lastBackupPath}
              </span>
            </div>
          )}

          {/* Conditionally show correlation ID with copy button for ops tracing */}
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

          {/* Conditionally show error message in red box when backup failed */}
          {data.lastBackupError && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-500">
              {data.lastBackupError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* GUID: BACKUP_DASHBOARD-022-v03
          [Intent] Immutability Lock Card — displays the bucket retention lock status.
                   This is informational / static since the lock is configured at the
                   infrastructure level (provision_recovery_env.sh), not by Cloud Functions.
          [Inbound Trigger] Always rendered in normal state.
          [Downstream Impact] Read-only. Warning about irreversibility educates new admins. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-sky-500" />
              Immutability Lock
            </CardTitle>
            {/* Show "Locked" badge if Cloud Functions has reported lock status,
                otherwise "Not reported" (lock exists at infra level regardless) */}
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
          {/* Amber warning: retention lock is irreversible — admins must understand
              this is a permanent infrastructure decision */}
          <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-600 dark:text-amber-400">
            Retention lock is irreversible. Backups cannot be deleted before the retention period expires.
          </div>
        </CardContent>
      </Card>

      {/* GUID: BACKUP_DASHBOARD-023-v03
          [Intent] Smoke Test Card — shows the last Sunday recovery verification result
                   including timestamp, correlation ID, and any error. Shows an info
                   box explaining the smoke test when it hasn't run yet.
          [Inbound Trigger] backup_status/latest has lastSmokeTestTimestamp set
                            (or shows explanatory text if not).
          [Downstream Impact] Read-only display. Correlation ID is copyable. */}
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

          {/* Conditionally show correlation ID with copy button */}
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

          {/* Conditionally show error message in red box when smoke test failed */}
          {data.lastSmokeTestError && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-500">
              {data.lastSmokeTestError}
            </div>
          )}

          {/* Show explanatory text when smoke test has never run (first week) */}
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
