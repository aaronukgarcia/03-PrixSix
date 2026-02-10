// GUID: ADMIN_ATTACK_MONITOR-000-v04
// @SECURITY_FIX: Replaced direct Firestore writes with API endpoint for attack acknowledgement (ADMINCOMP-013).
// [Intent] Admin security component that displays unacknowledged attack alerts (bot attacks, credential stuffing, distributed attacks) with severity-coded UI and acknowledgement controls.
// [Inbound Trigger] Rendered on the admin dashboard; only visible when there are unacknowledged attack_alerts in Firestore.
// [Downstream Impact] Reads from attack_alerts Firestore collection. Calls /api/admin/acknowledge-attack endpoint when acknowledging alerts.

'use client';

import { useMemo, useState } from 'react';
import { useCollection, useFirestore, useAuth } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldX, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

// GUID: ADMIN_ATTACK_MONITOR-001-v03
// [Intent] Type definition for an attack alert document from the attack_alerts Firestore collection.
// [Inbound Trigger] Used to type-check all attack alert data flowing through this component.
// [Downstream Impact] Schema changes to attack_alerts must be reflected here; affects rendering and acknowledgement logic.
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

// GUID: ADMIN_ATTACK_MONITOR-002-v03
// [Intent] Human-readable labels for attack type codes, used in alert card headings.
// [Inbound Trigger] Looked up by AttackAlertCard during rendering.
// [Downstream Impact] Adding a new attack type requires a corresponding label entry here.
const ATTACK_TYPE_LABELS: Record<string, string> = {
  bot_attack: 'Bot Attack',
  credential_stuffing: 'Credential Stuffing',
  distributed_attack: 'Distributed Attack',
};

// GUID: ADMIN_ATTACK_MONITOR-003-v03
// [Intent] Descriptive text for each attack type, shown as secondary detail in alert cards.
// [Inbound Trigger] Looked up by AttackAlertCard during rendering.
// [Downstream Impact] Adding a new attack type requires a corresponding description entry here.
const ATTACK_TYPE_DESCRIPTIONS: Record<string, string> = {
  bot_attack: 'Multiple failed login attempts from a single IP address',
  credential_stuffing: 'Single IP trying multiple different accounts',
  distributed_attack: 'Multiple IPs targeting a single account',
};

// GUID: ADMIN_ATTACK_MONITOR-004-v03
// [Intent] Main exported component that queries unacknowledged attack alerts and renders a severity-coded summary bar with expandable detail cards.
// [Inbound Trigger] Mounted by the admin dashboard; renders nothing if no unacknowledged alerts exist.
// [Downstream Impact] Reads attack_alerts where acknowledged==false; writes acknowledgement updates. The summary bar pulses when critical alerts are present.
export function AttackMonitor() {
  const firestore = useFirestore();
  const { user } = useAuth();
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // GUID: ADMIN_ATTACK_MONITOR-005-v03
  // [Intent] Memoised Firestore query for unacknowledged attack alerts, gated on admin status to prevent permission errors.
  // [Inbound Trigger] Re-created when firestore or user.isAdmin changes.
  // [Downstream Impact] Provides the real-time dataset of active alerts; null query prevents Firestore permission errors for non-admins.
  // Query unacknowledged attack alerts - only if user is admin
  const alertsQuery = useMemo(() => {
    // Don't query until we confirm user is admin to avoid permission errors
    if (!firestore || !user?.isAdmin) return null;
    const q = query(
      collection(firestore, 'attack_alerts'),
      where('acknowledged', '==', false),
      orderBy('timestamp', 'desc')
    );
    (q as any).__memo = true;
    return q;
  }, [firestore, user?.isAdmin]);

  const { data: alerts, isLoading, error } = useCollection<AttackAlert>(alertsQuery);

  // Log errors but don't crash - this component is non-critical
  if (error) {
    console.error('[AttackMonitor] Firestore error:', error);
  }

  // GUID: ADMIN_ATTACK_MONITOR-006-v04
  // @SECURITY_FIX: Replaced direct Firestore write with API endpoint call (ADMINCOMP-013).
  // [Intent] Acknowledges a single attack alert by calling the server-side API endpoint with proper authentication.
  // [Inbound Trigger] Called when the admin clicks "Acknowledge" on an individual alert card.
  // [Downstream Impact] Calls /api/admin/acknowledge-attack endpoint; real-time listener removes it from the unacknowledged list.
  const handleAcknowledge = async (alertId: string) => {
    if (!user) return;
    setAcknowledging(alertId);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/acknowledge-attack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ alertId }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to acknowledge alert');
      }
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    } finally {
      setAcknowledging(null);
    }
  };

  // GUID: ADMIN_ATTACK_MONITOR-007-v04
  // @SECURITY_FIX: Replaced direct Firestore writes with API endpoint call (ADMINCOMP-013).
  // [Intent] Acknowledges all currently visible attack alerts by calling the server-side API endpoint with an array of IDs.
  // [Inbound Trigger] Called when the admin clicks "Acknowledge All" on the summary bar.
  // [Downstream Impact] Calls /api/admin/acknowledge-attack endpoint with alertIds array; component will render nothing once all are acknowledged.
  const handleAcknowledgeAll = async () => {
    if (!user || !alerts?.length) return;
    setAcknowledging('all');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/acknowledge-attack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ alertIds: alerts.map(a => a.id) }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to acknowledge alerts');
      }
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

  // GUID: ADMIN_ATTACK_MONITOR-008-v03
  // [Intent] Splits alerts into critical and warning groups to drive severity-based UI styling (pulsing red vs amber).
  // [Inbound Trigger] Computed on each render from the alerts data.
  // [Downstream Impact] Determines the summary bar colour, icon, and text; controls whether the animate-pulse class is applied.
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

// GUID: ADMIN_ATTACK_MONITOR-009-v03
// [Intent] Renders a single attack alert card with severity-coded styling, attack details (IP, target, attempts), and an acknowledge button.
// [Inbound Trigger] Rendered by AttackMonitor for each unacknowledged alert in the expanded details section.
// [Downstream Impact] Calls onAcknowledge callback which triggers a Firestore update; visual-only otherwise.
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
