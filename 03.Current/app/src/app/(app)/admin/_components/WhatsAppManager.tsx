"use client";

import { useEffect, useState, useCallback } from "react";
import { useFirestore, useAuth } from "@/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  RefreshCw,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Wifi,
  WifiOff,
  Users,
  Activity,
  Bell,
  BellOff,
  Flag,
  UserPlus,
  BarChart3,
  Megaphone,
  FlaskConical,
  Settings2,
  History,
  Save,
  QrCode,
  Smartphone,
} from "lucide-react";
import QRCode from "react-qr-code";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
  Timestamp
} from "firebase/firestore";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  WhatsAppAlertSettings,
  WhatsAppAlertToggles,
  WhatsAppAlertHistoryEntry,
  getWhatsAppAlertSettings,
  updateWhatsAppAlertSettings,
  addWhatsAppAlertHistoryEntry,
} from "@/firebase/firestore/settings";
import { logAuditEvent } from "@/lib/audit";

// WhatsApp Worker URL - Azure Container Instance
const WHATSAPP_WORKER_URL = "https://prixsix-whatsapp.uksouth.azurecontainer.io:3000";
const MAX_MESSAGE_LENGTH = 500;

interface WorkerStatus {
  connected: boolean;
  awaitingQR: boolean;
  groups: string[];
  timestamp: string;
  error?: string;
  storage?: string;
  keepAlive?: {
    lastSuccessfulPing: string | null;
    lastPingSecondsAgo: number | null;
    consecutiveFailures: number;
  };
}

interface StatusLogEntry {
  id: string;
  status: string;
  timestamp: Timestamp;
  details?: Record<string, any>;
  consecutiveFailures?: number;
}

interface QueueMessage {
  id: string;
  groupName?: string;
  chatId?: string;
  message: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  createdAt: Timestamp;
  processedAt?: Timestamp;
  error?: string;
  retryCount?: number;
}

// Alert category definitions
const ALERT_CATEGORIES = {
  raceWeekend: {
    label: "Race Weekend",
    icon: Flag,
    alerts: [
      { key: 'qualifyingReminder' as const, label: 'Qualifying Reminder', description: 'Sent before qualifying sessions' },
      { key: 'raceReminder' as const, label: 'Race Reminder', description: 'Sent before race start' },
      { key: 'resultsPublished' as const, label: 'Results Published', description: 'When race results are entered' },
    ]
  },
  playerActivity: {
    label: "Player Activity",
    icon: UserPlus,
    alerts: [
      { key: 'newPlayerJoined' as const, label: 'New Player Joined', description: 'When someone joins the league' },
      { key: 'predictionSubmitted' as const, label: 'Prediction Submitted', description: 'When a prediction is made' },
      { key: 'latePredictionWarning' as const, label: 'Late Prediction Warning', description: 'Reminder for missing predictions' },
    ]
  },
  leagueSummary: {
    label: "League Summary",
    icon: BarChart3,
    alerts: [
      { key: 'weeklyStandingsUpdate' as const, label: 'Weekly Standings Update', description: 'Weekly league standings summary' },
      { key: 'endOfSeasonSummary' as const, label: 'End of Season Summary', description: 'Final standings and awards' },
    ]
  },
  adminManual: {
    label: "Admin / Manual",
    icon: Megaphone,
    alerts: [
      { key: 'hotNewsPublished' as const, label: 'Hot News Published', description: 'When hot news is updated' },
      { key: 'adminAnnouncements' as const, label: 'Admin Announcements', description: 'General admin messages' },
      { key: 'customMessages' as const, label: 'Custom Messages', description: 'Manual messages from this panel' },
    ]
  },
};

export function WhatsAppManager() {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();

  // Worker status state
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Alert settings state
  const [alertSettings, setAlertSettings] = useState<WhatsAppAlertSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Local settings for editing
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [targetGroup, setTargetGroup] = useState("");
  const [alertToggles, setAlertToggles] = useState<WhatsAppAlertToggles>({
    qualifyingReminder: true,
    raceReminder: true,
    resultsPublished: true,
    newPlayerJoined: true,
    predictionSubmitted: false,
    latePredictionWarning: true,
    weeklyStandingsUpdate: true,
    endOfSeasonSummary: true,
    hotNewsPublished: true,
    adminAnnouncements: true,
    customMessages: true,
  });

  // Message form state
  const [message, setMessage] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [isSending, setIsSending] = useState(false);

  // Queue state
  const [recentMessages, setRecentMessages] = useState<QueueMessage[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  // Alert history state
  const [alertHistory, setAlertHistory] = useState<(WhatsAppAlertHistoryEntry & { id: string })[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Status log state
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([]);
  const [statusLogLoading, setStatusLogLoading] = useState(true);

  // QR code state
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  // Fetch QR code from worker
  const fetchQRCode = useCallback(async () => {
    setQrLoading(true);
    setQrError(null);

    try {
      const response = await fetch(`${WHATSAPP_WORKER_URL}/qr`, {
        method: 'GET',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.reason || `HTTP ${response.status}`);
      }

      const qrData = await response.text();
      setQrCodeData(qrData);
    } catch (error: any) {
      console.error('Failed to fetch QR code:', error);
      setQrError(error.message || 'Failed to fetch QR code');
      setQrCodeData(null);
    } finally {
      setQrLoading(false);
    }
  }, []);

  // Fetch worker status
  const fetchWorkerStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);

    try {
      const response = await fetch(`${WHATSAPP_WORKER_URL}/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setWorkerStatus({
        connected: data.whatsapp?.connected || false,
        awaitingQR: data.whatsapp?.awaitingQR || false,
        groups: data.whatsapp?.groups || [],
        timestamp: data.timestamp,
        storage: data.whatsapp?.storage,
        keepAlive: data.whatsapp?.keepAlive,
      });

      // Auto-select first group if none selected
      if (!selectedGroup && data.whatsapp?.groups?.length > 0) {
        const prixSix = data.whatsapp.groups.find((g: string) =>
          g.toLowerCase().includes('prix') || g.toLowerCase().includes('six')
        );
        setSelectedGroup(prixSix || data.whatsapp.groups[0]);
      }
    } catch (error: any) {
      console.error('Failed to fetch worker status:', error);
      setStatusError(error.message || 'Failed to connect to WhatsApp worker');
      setWorkerStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [selectedGroup]);

  // Fetch alert settings
  const fetchAlertSettings = useCallback(async () => {
    if (!firestore) return;

    setSettingsLoading(true);
    try {
      const settings = await getWhatsAppAlertSettings(firestore);
      setAlertSettings(settings);
      setMasterEnabled(settings.masterEnabled);
      setTestMode(settings.testMode);
      setTargetGroup(settings.targetGroup);
      setAlertToggles(settings.alerts);
    } catch (error: any) {
      console.error('Failed to fetch alert settings:', error);
      toast({
        variant: "destructive",
        title: "Error Loading Settings",
        description: error.message,
      });
    } finally {
      setSettingsLoading(false);
    }
  }, [firestore, toast]);

  // Fetch status on mount and every 30 seconds
  useEffect(() => {
    fetchWorkerStatus();
    const interval = setInterval(fetchWorkerStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchWorkerStatus]);

  // Fetch alert settings on mount
  useEffect(() => {
    fetchAlertSettings();
  }, [fetchAlertSettings]);

  // Listen to recent queue messages
  useEffect(() => {
    if (!firestore) return;

    const queueRef = collection(firestore, 'whatsapp_queue');
    const q = query(queueRef, orderBy('createdAt', 'desc'), limit(10));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages: QueueMessage[] = [];
      snapshot.forEach((doc) => {
        messages.push({ id: doc.id, ...doc.data() } as QueueMessage);
      });
      setRecentMessages(messages);
      setQueueLoading(false);
    }, (error) => {
      console.error('Error listening to queue:', error);
      setQueueLoading(false);
    });

    return () => unsubscribe();
  }, [firestore]);

  // Listen to alert history
  useEffect(() => {
    if (!firestore) return;

    const historyRef = collection(firestore, 'whatsapp_alert_history');
    const q = query(historyRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: (WhatsAppAlertHistoryEntry & { id: string })[] = [];
      snapshot.forEach((doc) => {
        entries.push({ id: doc.id, ...doc.data() } as WhatsAppAlertHistoryEntry & { id: string });
      });
      setAlertHistory(entries);
      setHistoryLoading(false);
    }, (error) => {
      console.error('Error listening to alert history:', error);
      setHistoryLoading(false);
    });

    return () => unsubscribe();
  }, [firestore]);

  // Listen to WhatsApp status log
  useEffect(() => {
    if (!firestore) return;

    const statusRef = collection(firestore, 'whatsapp_status_log');
    const q = query(statusRef, orderBy('timestamp', 'desc'), limit(25));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: StatusLogEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push({ id: doc.id, ...doc.data() } as StatusLogEntry);
      });
      setStatusLog(entries);
      setStatusLogLoading(false);
    }, (error) => {
      console.error('Error listening to status log:', error);
      setStatusLogLoading(false);
    });

    return () => unsubscribe();
  }, [firestore]);

  // Save alert settings
  const handleSaveSettings = async () => {
    if (!firestore || !firebaseUser) return;

    setIsSavingSettings(true);
    try {
      await updateWhatsAppAlertSettings(firestore, {
        masterEnabled,
        testMode,
        targetGroup,
        alerts: alertToggles,
        lastUpdated: serverTimestamp() as any,
        updatedBy: firebaseUser.uid,
      });

      await logAuditEvent(firestore, firebaseUser.uid, 'UPDATE_WHATSAPP_ALERT_SETTINGS', {
        email: user?.email,
        teamName: user?.teamName,
        masterEnabled,
        testMode,
        targetGroup,
        alerts: alertToggles,
      });

      // Update local settings state to match saved values
      setAlertSettings({
        masterEnabled,
        testMode,
        targetGroup,
        alerts: alertToggles,
        lastUpdated: new Timestamp(Date.now() / 1000, 0),
        updatedBy: firebaseUser.uid,
      });

      toast({
        title: "Settings Saved",
        description: "WhatsApp alert settings have been updated.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error Saving Settings",
        description: error.message,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Send custom message
  const handleSend = async () => {
    if (!firestore || !firebaseUser || !message.trim() || !selectedGroup) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a group and enter a message.",
      });
      return;
    }

    // Check if custom messages are enabled
    if (masterEnabled && !alertToggles.customMessages) {
      toast({
        variant: "destructive",
        title: "Custom Messages Disabled",
        description: "Enable 'Custom Messages' in the alert settings to send messages.",
      });
      return;
    }

    setIsSending(true);
    try {
      // Add to main queue
      const queueRef = collection(firestore, 'whatsapp_queue');
      await addDoc(queueRef, {
        groupName: selectedGroup,
        message: message.trim(),
        status: 'PENDING',
        createdAt: serverTimestamp(),
        retryCount: 0,
        testMode,
        sentBy: firebaseUser.uid,
      });

      // Add to alert history
      await addWhatsAppAlertHistoryEntry(firestore, {
        alertType: 'customMessage',
        message: message.trim(),
        targetGroup: selectedGroup,
        status: 'PENDING',
        testMode,
        sentBy: firebaseUser.uid,
      });

      await logAuditEvent(firestore, firebaseUser.uid, 'SEND_WHATSAPP_MESSAGE', {
        email: user?.email,
        teamName: user?.teamName,
        targetGroup: selectedGroup,
        messagePreview: message.substring(0, 100),
        testMode,
      });

      toast({
        title: testMode ? "Test Message Queued" : "Message Queued",
        description: `Message added to queue for "${selectedGroup}".${testMode ? ' (Test Mode)' : ''}`,
      });
      setMessage("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to Queue Message",
        description: error.message,
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleAlert = (key: keyof WhatsAppAlertToggles) => {
    setAlertToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'PROCESSING':
        return <Badge variant="outline"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'SENT':
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Sent</Badge>;
      case 'FAILED':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatTime = (timestamp: Timestamp | undefined) => {
    if (!timestamp) return '-';
    try {
      return timestamp.toDate().toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const hasUnsavedChanges = alertSettings && (
    masterEnabled !== alertSettings.masterEnabled ||
    testMode !== alertSettings.testMode ||
    targetGroup !== alertSettings.targetGroup ||
    JSON.stringify(alertToggles) !== JSON.stringify(alertSettings.alerts)
  );

  return (
    <div className="space-y-4">
      {/* Worker Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                WhatsApp Worker Status
              </CardTitle>
              <CardDescription>
                Real-time status of the WhatsApp notification service.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchWorkerStatus}
              disabled={statusLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${statusLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statusLoading && !workerStatus ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : statusError ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 text-destructive">
                <WifiOff className="w-5 h-5" />
                <span className="font-medium">Connection Failed</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{statusError}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Worker URL: {WHATSAPP_WORKER_URL}
              </p>
            </div>
          ) : workerStatus ? (
            <div className="space-y-4">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium w-40">Connected</TableCell>
                  <TableCell>
                    {workerStatus.connected ? (
                      <span className="flex items-center gap-2 text-green-600">
                        <Wifi className="w-4 h-4" />
                        <span>Yes</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-destructive">
                        <WifiOff className="w-4 h-4" />
                        <span>No</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Awaiting QR</TableCell>
                  <TableCell>
                    {workerStatus.awaitingQR ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Yes - Scan Required</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={fetchQRCode}
                          disabled={qrLoading}
                        >
                          <QrCode className={`w-4 h-4 mr-1 ${qrLoading ? 'animate-pulse' : ''}`} />
                          {qrLoading ? 'Loading...' : 'Show QR Code'}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Groups Found</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono">{workerStatus.groups.length}</span>
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Last Checked</TableCell>
                  <TableCell className="text-muted-foreground">
                    {workerStatus.timestamp
                      ? new Date(workerStatus.timestamp).toLocaleString('en-GB')
                      : '-'}
                  </TableCell>
                </TableRow>
                {workerStatus.keepAlive && (
                  <>
                    <TableRow>
                      <TableCell className="font-medium">Keep-Alive</TableCell>
                      <TableCell>
                        {workerStatus.keepAlive.consecutiveFailures === 0 ? (
                          <span className="flex items-center gap-2 text-green-600">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Healthy</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-amber-600">
                            <XCircle className="w-4 h-4" />
                            <span>{workerStatus.keepAlive.consecutiveFailures} failures</span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Last Ping</TableCell>
                      <TableCell className="text-muted-foreground">
                        {workerStatus.keepAlive.lastPingSecondsAgo !== null
                          ? `${workerStatus.keepAlive.lastPingSecondsAgo}s ago`
                          : 'Never'}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>

            {/* QR Code Display */}
            {workerStatus.awaitingQR && (qrCodeData || qrError) && (
              <div className="rounded-lg border p-6 bg-white">
                {qrError ? (
                  <div className="text-center space-y-2">
                    <XCircle className="w-12 h-12 mx-auto text-destructive" />
                    <p className="text-destructive font-medium">Failed to load QR code</p>
                    <p className="text-sm text-muted-foreground">{qrError}</p>
                    <Button variant="outline" size="sm" onClick={fetchQRCode}>
                      Try Again
                    </Button>
                  </div>
                ) : qrCodeData ? (
                  <div className="text-center space-y-4">
                    <div className="flex items-center justify-center gap-2 text-green-600">
                      <Smartphone className="w-5 h-5" />
                      <span className="font-semibold">Scan with WhatsApp</span>
                    </div>
                    <div className="inline-block p-4 bg-white rounded-lg shadow-lg">
                      <QRCode value={qrCodeData} size={256} level="M" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Open WhatsApp on your phone, go to Settings → Linked Devices → Link a Device, then scan this QR code.
                    </p>
                    <Button variant="outline" size="sm" onClick={fetchQRCode}>
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Refresh QR Code
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Connection Status Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Connection Status Log
          </CardTitle>
          <CardDescription>
            Recent status changes from the WhatsApp worker. Shows when connection drops or recovers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusLogLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : statusLog.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No status logs yet. Logs will appear when the worker reports status changes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-32">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusLog.map((entry) => (
                  <TableRow key={entry.id} className={
                    entry.status === 'disconnected' || entry.status === 'auth_failure' || entry.status === 'keep_alive_fail'
                      ? 'bg-destructive/5'
                      : entry.status === 'ready'
                      ? 'bg-green-500/5'
                      : ''
                  }>
                    <TableCell>
                      <Badge
                        variant={
                          entry.status === 'ready' || entry.status === 'authenticated'
                            ? 'default'
                            : entry.status === 'disconnected' || entry.status === 'auth_failure' || entry.status === 'keep_alive_fail'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className={
                          entry.status === 'ready' ? 'bg-green-600' : ''
                        }
                      >
                        {entry.status === 'keep_alive_ping' ? 'ping' : entry.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.details ? (
                        <span className="font-mono text-xs">
                          {Object.entries(entry.details)
                            .filter(([k]) => k !== 'timestamp')
                            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                            .join(', ')
                            .substring(0, 80) || '-'}
                        </span>
                      ) : entry.consecutiveFailures ? (
                        <span>Failures: {entry.consecutiveFailures}</span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatTime(entry.timestamp)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Alert Control Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                Alert Control Panel
              </CardTitle>
              <CardDescription>
                Configure which automated alerts are sent to WhatsApp.
              </CardDescription>
            </div>
            {hasUnsavedChanges && (
              <Badge variant="outline" className="text-amber-600 border-amber-600">
                Unsaved Changes
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {settingsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              {/* Master Switch */}
              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
                <div className="flex items-center gap-3">
                  {masterEnabled ? (
                    <Bell className="w-6 h-6 text-green-600" />
                  ) : (
                    <BellOff className="w-6 h-6 text-muted-foreground" />
                  )}
                  <div>
                    <Label htmlFor="master-switch" className="text-base font-semibold">
                      Master Switch
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {masterEnabled ? 'Alerts are enabled' : 'All alerts are disabled'}
                    </p>
                  </div>
                </div>
                <Switch
                  id="master-switch"
                  checked={masterEnabled}
                  onCheckedChange={setMasterEnabled}
                  aria-label="Enable all WhatsApp alerts"
                />
              </div>

              {/* Test Mode */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <FlaskConical className={`w-5 h-5 ${testMode ? 'text-amber-600' : 'text-muted-foreground'}`} />
                  <div>
                    <Label htmlFor="test-mode" className="text-base">
                      Test Mode
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {testMode ? 'Messages will be marked as test' : 'Messages are live'}
                    </p>
                  </div>
                </div>
                <Switch
                  id="test-mode"
                  checked={testMode}
                  onCheckedChange={setTestMode}
                  aria-label="Enable test mode"
                />
              </div>

              {/* Target Group Selection */}
              <div className="space-y-2">
                <Label htmlFor="target-group">Default Target Group</Label>
                {workerStatus?.groups && workerStatus.groups.length > 0 ? (
                  <Select value={targetGroup} onValueChange={setTargetGroup}>
                    <SelectTrigger id="target-group">
                      <SelectValue placeholder="Select default group for alerts..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workerStatus.groups.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">
                    {statusLoading
                      ? 'Loading groups...'
                      : statusError
                      ? 'Could not load groups - worker offline'
                      : 'No groups available'}
                  </div>
                )}
              </div>

              {/* Alert Categories */}
              <div className="space-y-2">
                <Label>Alert Categories</Label>
                <Accordion type="multiple" defaultValue={['raceWeekend', 'adminManual']} className="w-full">
                  {Object.entries(ALERT_CATEGORIES).map(([categoryKey, category]) => {
                    const Icon = category.icon;
                    const enabledCount = category.alerts.filter(a => alertToggles[a.key]).length;

                    return (
                      <AccordionItem key={categoryKey} value={categoryKey}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-3">
                            <Icon className="w-4 h-4" />
                            <span>{category.label}</span>
                            <Badge variant="secondary" className="ml-2">
                              {enabledCount}/{category.alerts.length}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {category.alerts.map((alert) => (
                              <div
                                key={alert.key}
                                className="flex items-center justify-between rounded-lg border p-3"
                              >
                                <div>
                                  <Label
                                    htmlFor={`alert-${alert.key}`}
                                    className="text-sm font-medium cursor-pointer"
                                  >
                                    {alert.label}
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    {alert.description}
                                  </p>
                                </div>
                                <Switch
                                  id={`alert-${alert.key}`}
                                  checked={alertToggles[alert.key]}
                                  onCheckedChange={() => handleToggleAlert(alert.key)}
                                  disabled={!masterEnabled}
                                  aria-label={`Enable ${alert.label}`}
                                />
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSaveSettings}
            disabled={isSavingSettings || settingsLoading || !hasUnsavedChanges}
          >
            {isSavingSettings ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Send Custom Message Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Send Custom Message
          </CardTitle>
          <CardDescription>
            Send a manual message to a WhatsApp group. Messages are queued and processed by the worker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-select">Select Group</Label>
            {workerStatus?.groups && workerStatus.groups.length > 0 ? (
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger id="group-select">
                  <SelectValue placeholder="Select a group..." />
                </SelectTrigger>
                <SelectContent>
                  {workerStatus.groups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">
                {statusLoading
                  ? 'Loading groups...'
                  : statusError
                  ? 'Could not load groups - worker offline'
                  : 'No groups available'}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="message">Message</Label>
              <span className={`text-xs ${message.length > MAX_MESSAGE_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}>
                {message.length}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH + 50))}
              placeholder="Enter your message here..."
              rows={4}
              disabled={isSending}
              className={message.length > MAX_MESSAGE_LENGTH ? 'border-destructive' : ''}
            />
            {message.length > MAX_MESSAGE_LENGTH && (
              <p className="text-xs text-destructive">
                Message exceeds {MAX_MESSAGE_LENGTH} character limit
              </p>
            )}
          </div>
          {testMode && (
            <div className="flex items-center gap-2 text-amber-600 text-sm">
              <FlaskConical className="w-4 h-4" />
              Test Mode is enabled - message will be marked as test
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSend}
            disabled={isSending || !message.trim() || !selectedGroup || !workerStatus?.connected || message.length > MAX_MESSAGE_LENGTH}
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Queuing...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Message
              </>
            )}
          </Button>
          {!workerStatus?.connected && (
            <p className="ml-4 text-sm text-muted-foreground">
              Worker must be connected to send messages.
            </p>
          )}
        </CardFooter>
      </Card>

      {/* Message Queue Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Message Queue
          </CardTitle>
          <CardDescription>
            Last 10 messages in the queue. Updates in real-time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queueLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recentMessages.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No messages in queue yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Group</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-28">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMessages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell>{getStatusBadge(msg.status)}</TableCell>
                    <TableCell className="font-medium">
                      {msg.groupName || msg.chatId || '-'}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate" title={msg.message}>
                      {msg.message.length > 60
                        ? msg.message.substring(0, 60) + '...'
                        : msg.message}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatTime(msg.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Alert History Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Alert History
          </CardTitle>
          <CardDescription>
            Last 50 alerts sent via the system. Updates in real-time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : alertHistory.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No alert history yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="w-32">Group</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-20">Test</TableHead>
                  <TableHead className="w-28">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertHistory.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{getStatusBadge(entry.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {entry.alertType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.targetGroup || '-'}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={entry.message}>
                      {entry.message.length > 40
                        ? entry.message.substring(0, 40) + '...'
                        : entry.message}
                    </TableCell>
                    <TableCell>
                      {entry.testMode ? (
                        <FlaskConical className="w-4 h-4 text-amber-600" />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatTime(entry.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
