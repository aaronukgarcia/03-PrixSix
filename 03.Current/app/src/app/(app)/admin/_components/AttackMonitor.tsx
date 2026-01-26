'use client';

import { useMemo, useState } from 'react';
import { useCollection, useFirestore, useAuth } from '@/firebase';
import { collection, query, where, orderBy, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldX, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface AttackAlert {
  id: string;
  timestamp: {
    seconds: number;
    nanoseconds: number;
  };
  type: 'bot_attack' | 'credential_stuffing' | 'distributed_attack';
  severity: 'warning' | 'critical';
  details: {
    ip?: string;
    targetEmail?: string;
    failedAttempts: number;
    uniqueIPs?: number;
    uniqueAccounts?: number;
    timeWindowMinutes: number;
  };
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: {
    seconds: number;
    nanoseconds: number;
  };
}

const ATTACK_TYPE_LABELS: Record<string, string> = {
  bot_attack: 'Bot Attack',
  credential_stuffing: 'Credential Stuffing',
  distributed_attack: 'Distributed Attack',
};

const ATTACK_TYPE_DESCRIPTIONS: Record<string, string> = {
  bot_attack: 'Multiple failed login attempts from a single IP address',
  credential_stuffing: 'Single IP trying multiple different accounts',
  distributed_attack: 'Multiple IPs targeting a single account',
};

export function AttackMonitor() {
  const firestore = useFirestore();
  const { user } = useAuth();
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Query unacknowledged attack alerts
  const alertsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(
      collection(firestore, 'attack_alerts'),
      where('acknowledged', '==', false),
      orderBy('timestamp', 'desc')
    );
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: alerts, isLoading, error } = useCollection<AttackAlert>(alertsQuery);

  const handleAcknowledge = async (alertId: string) => {
    if (!firestore || !user) return;
    setAcknowledging(alertId);
    try {
      const alertRef = doc(firestore, 'attack_alerts', alertId);
      await updateDoc(alertRef, {
        acknowledged: true,
        acknowledgedBy: user.id,
        acknowledgedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    } finally {
      setAcknowledging(null);
    }
  };

  const handleAcknowledgeAll = async () => {
    if (!firestore || !user || !alerts?.length) return;
    setAcknowledging('all');
    try {
      await Promise.all(
        alerts.map(alert => {
          const alertRef = doc(firestore, 'attack_alerts', alert.id);
          return updateDoc(alertRef, {
            acknowledged: true,
            acknowledgedBy: user.id,
            acknowledgedAt: Timestamp.now(),
          });
        })
      );
    } catch (err) {
      console.error('Failed to acknowledge all alerts:', err);
    } finally {
      setAcknowledging(null);
    }
  };

  // No alerts or loading - don't render anything
  if (isLoading || error || !alerts?.length) {
    return null;
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');
  const hasCritical = criticalAlerts.length > 0;

  return (
    <div className="space-y-2">
      {/* Summary bar - always visible */}
      <Alert
        variant="destructive"
        className={cn(
          'border-2 cursor-pointer transition-all',
          hasCritical
            ? 'bg-red-500/10 border-red-500 animate-pulse'
            : 'bg-amber-500/10 border-amber-500'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            {hasCritical ? (
              <ShieldX className="h-5 w-5 text-red-500" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            )}
            <div>
              <AlertTitle className={hasCritical ? 'text-red-600' : 'text-amber-600'}>
                {hasCritical ? 'UNDER ATTACK' : 'Security Warning'}
              </AlertTitle>
              <AlertDescription className="text-sm">
                {criticalAlerts.length > 0 && (
                  <span className="text-red-600 font-medium">{criticalAlerts.length} critical</span>
                )}
                {criticalAlerts.length > 0 && warningAlerts.length > 0 && ', '}
                {warningAlerts.length > 0 && (
                  <span className="text-amber-600 font-medium">{warningAlerts.length} warning</span>
                )}
                {' '}alert{alerts.length !== 1 ? 's' : ''} detected
              </AlertDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-current"
              onClick={(e) => {
                e.stopPropagation();
                handleAcknowledgeAll();
              }}
              disabled={acknowledging === 'all'}
            >
              <Check className="h-4 w-4 mr-1" />
              {acknowledging === 'all' ? 'Acknowledging...' : 'Acknowledge All'}
            </Button>
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </div>
      </Alert>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2 pl-4">
          {alerts.map((alert) => (
            <AttackAlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={() => handleAcknowledge(alert.id)}
              isAcknowledging={acknowledging === alert.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttackAlertCard({
  alert,
  onAcknowledge,
  isAcknowledging,
}: {
  alert: AttackAlert;
  onAcknowledge: () => void;
  isAcknowledging: boolean;
}) {
  const isCritical = alert.severity === 'critical';
  const timestamp = alert.timestamp?.seconds
    ? new Date(alert.timestamp.seconds * 1000)
    : null;

  return (
    <div
      className={cn(
        'p-4 rounded-lg border-2',
        isCritical
          ? 'bg-red-500/5 border-red-500/50'
          : 'bg-amber-500/5 border-amber-500/50'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                isCritical
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-amber-500 text-white border-amber-500'
              )}
            >
              {alert.severity.toUpperCase()}
            </Badge>
            <span className="font-semibold">
              {ATTACK_TYPE_LABELS[alert.type] || alert.type}
            </span>
            {timestamp && (
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(timestamp, { addSuffix: true })}
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {ATTACK_TYPE_DESCRIPTIONS[alert.type]}
          </p>

          <div className="flex flex-wrap gap-4 text-sm">
            {alert.details.ip && (
              <div>
                <span className="text-muted-foreground">Source IP: </span>
                <code className="bg-muted px-1 rounded font-mono text-xs">
                  {alert.details.ip}
                </code>
              </div>
            )}
            {alert.details.targetEmail && (
              <div>
                <span className="text-muted-foreground">Target: </span>
                <code className="bg-muted px-1 rounded font-mono text-xs">
                  {alert.details.targetEmail}
                </code>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Failed attempts: </span>
              <span className="font-medium">{alert.details.failedAttempts}</span>
            </div>
            {alert.details.uniqueIPs && (
              <div>
                <span className="text-muted-foreground">Unique IPs: </span>
                <span className="font-medium">{alert.details.uniqueIPs}</span>
              </div>
            )}
            {alert.details.uniqueAccounts && (
              <div>
                <span className="text-muted-foreground">Accounts tried: </span>
                <span className="font-medium">{alert.details.uniqueAccounts}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Time window: </span>
              <span className="font-medium">{alert.details.timeWindowMinutes} min</span>
            </div>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={onAcknowledge}
          disabled={isAcknowledging}
          className={cn(
            'shrink-0',
            isCritical
              ? 'border-red-500 text-red-500 hover:bg-red-50'
              : 'border-amber-500 text-amber-500 hover:bg-amber-50'
          )}
        >
          <Check className="h-4 w-4 mr-1" />
          {isAcknowledging ? 'Acknowledging...' : 'Acknowledge'}
        </Button>
      </div>
    </div>
  );
}
