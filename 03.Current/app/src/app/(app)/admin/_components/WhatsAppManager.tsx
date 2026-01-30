// GUID: ADMIN_WHATSAPP-000-v03
// [Intent] Admin component for managing WhatsApp integration: worker status monitoring, alert configuration, custom message sending, message queue viewing, and alert history.
// [Inbound Trigger] Rendered when admin navigates to the WhatsApp management tab in the admin panel.
// [Downstream Impact] Writes to whatsapp_queue (processed by WhatsApp worker), whatsapp_alert_history, and settings/whatsapp_alerts collections. Changes here affect automated alert delivery to WhatsApp groups.

"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
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
  AlertTriangle,
} from "lucide-react";

// GUID: ADMIN_WHATSAPP-001-v03
// [Intent] Dynamically import QRCode component to avoid SSR issues; includes fallback UI on load failure.
// [Inbound Trigger] Component mounts on the client side.
// [Downstream Impact] QRCodeComponent is used in the QR code display section when worker is awaiting QR scan.
const QRCodeComponent = dynamic(
  () => import("react-qr-code").then((mod) => mod.default).catch((err) => {
    console.error("Failed to load QRCode component:", err);
    // Return a fallback component on error
    return () => (
      <div className="h-64 w-64 flex items-center justify-center border rounded bg-muted">
        <span className="text-sm text-muted-foreground">QR Code unavailable</span>
      </div>
    );
  }),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-64" />
  }
);
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

// GUID: ADMIN_WHATSAPP-002-v03
// [Intent] Constants for the WhatsApp proxy API endpoint and message length limit.
// [Inbound Trigger] Referenced by fetch calls throughout the component.
// [Downstream Impact] Changing WHATSAPP_PROXY_URL affects all API calls to the WhatsApp worker. MAX_MESSAGE_LENGTH controls UI validation for custom messages.
const WHATSAPP_PROXY_URL = "/api/whatsapp-proxy";
const MAX_MESSAGE_LENGTH = 500;

// GUID: ADMIN_WHATSAPP-003-v03
// [Intent] TypeScript interface for the WhatsApp worker status response, including connection state, groups, and keep-alive health.
// [Inbound Trigger] Used to type the workerStatus state variable populated from the /status API endpoint.
// [Downstream Impact] Changes to this interface require matching changes in the worker's status endpoint response shape.
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

// GUID: ADMIN_WHATSAPP-004-v03
// [Intent] TypeScript interface for entries in the whatsapp_status_log Firestore collection, tracking connection state changes.
// [Inbound Trigger] Used to type status log entries fetched via Firestore snapshot listener.
// [Downstream Impact] Changes require matching updates to the whatsapp_status_log collection schema in the worker.
interface StatusLogEntry {
  id: string;
  status: string;
  timestamp: Timestamp;
  details?: Record<string, any>;
  consecutiveFailures?: number;
}

// GUID: ADMIN_WHATSAPP-005-v03
// [Intent] TypeScript interface for messages in the whatsapp_queue Firestore collection, representing messages to be sent by the worker.
// [Inbound Trigger] Used to type queue message entries fetched via Firestore snapshot listener.
// [Downstream Impact] Changes require matching updates to how the WhatsApp worker reads and processes queue documents.
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

// GUID: ADMIN_WHATSAPP-006-v03
// [Intent] Static configuration defining all alert categories and their individual alert types for the Alert Control Panel UI.
// [Inbound Trigger] Rendered in the Alert Categories accordion within the Alert Control Panel card.
// [Downstream Impact] Adding/removing alert keys here requires matching changes in WhatsAppAlertToggles type and Firestore settings document schema.
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

// GUID: ADMIN_WHATSAPP-007-v03
// [Intent] Main admin component for WhatsApp integration management. Provides worker status monitoring, QR code authentication, alert settings configuration, custom message sending, message queue display, and alert history.
// [Inbound Trigger] Rendered by the admin page when the WhatsApp management tab is selected.
// [Downstream Impact] Writes to whatsapp_queue, whatsapp_alert_history, settings/whatsapp_alerts, and audit_log collections. UI state drives all child cards and real-time listeners.
export function WhatsAppManager() {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();

  // GUID: ADMIN_WHATSAPP-008-v03
  // [Intent] State management for all component concerns: worker status, alert settings, message form, queue, history, status log, and QR code lifecycle.
  // [Inbound Trigger] Initialised on component mount; updated by fetch callbacks, Firestore listeners, and user interactions.
  // [Downstream Impact] State changes trigger re-renders across all child cards. Settings state is compared to saved values to detect unsaved changes.

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
  const [qrFetchedAt, setQrFetchedAt] = useState<Date | null>(null);
  const [qrAgeSeconds, setQrAgeSeconds] = useState<number>(0);

  // QR code expiry settings
  const QR_REFRESH_INTERVAL_MS = 30000; // Auto-refresh every 30 seconds
  const QR_WARN_AGE_SECONDS = 60; // Warn if QR is older than 60 seconds
  const QR_STALE_AGE_SECONDS = 120; // Consider stale after 2 minutes

  // GUID: ADMIN_WHATSAPP-009-v03
  // [Intent] Retrieve Firebase auth token for authenticated API requests to the WhatsApp proxy.
  // [Inbound Trigger] Called by fetchQRCode, fetchWorkerStatus, and other API-calling functions.
  // [Downstream Impact] Returns null if not authenticated, which causes callers to skip or throw. Token is passed as Bearer auth header.
  const getAuthToken = useCallback(async () => {
    if (!firebaseUser) return null;
    try {
      return await firebaseUser.getIdToken();
    } catch {
      return null;
    }
  }, [firebaseUser]);

  // GUID: ADMIN_WHATSAPP-010-v03
  // [Intent] Fetch QR code string from the WhatsApp worker via the proxy API for display in the QR scanner UI.
  // [Inbound Trigger] Called when admin clicks "Show QR Code" button, or auto-refreshed every 30 seconds while QR is displayed.
  // [Downstream Impact] Sets qrCodeData which renders the QR code via QRCodeComponent. Sets qrFetchedAt which drives the age warning system.
  const fetchQRCode = useCallback(async () => {
    setQrLoading(true);
    setQrError(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`${WHATSAPP_PROXY_URL}?endpoint=qr`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.reason || `HTTP ${response.status}`);
      }

      const qrData = await response.text();
      setQrCodeData(qrData);
      setQrFetchedAt(new Date());
      setQrAgeSeconds(0);
    } catch (error: any) {
      console.error('Failed to fetch QR code:', error);
      setQrError(error.message || 'Failed to fetch QR code');
      setQrCodeData(null);
      setQrFetchedAt(null);
    } finally {
      setQrLoading(false);
    }
  }, [getAuthToken]);

  // GUID: ADMIN_WHATSAPP-011-v03
  // [Intent] Fetch current worker status (connection, groups, keep-alive) from the WhatsApp proxy API. Auto-selects first matching group.
  // [Inbound Trigger] Called on mount, every 30 seconds via interval, and when admin clicks "Refresh" or "Check Again" button.
  // [Downstream Impact] Sets workerStatus which drives the entire Worker Status Card UI. Auto-selects Prix Six group for message sending.
  const fetchWorkerStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        // Not logged in yet, skip silently
        setStatusLoading(false);
        return;
      }

      const response = await fetch(`${WHATSAPP_PROXY_URL}?endpoint=status`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
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

      // Auto-select first group if none selected (filter out empty strings)
      const validGroups = (data.whatsapp?.groups || []).filter((g: string) => g && g.trim());
      if (!selectedGroup && validGroups.length > 0) {
        const prixSix = validGroups.find((g: string) =>
          g.toLowerCase().includes('prix') || g.toLowerCase().includes('six')
        );
        setSelectedGroup(prixSix || validGroups[0]);
      }
    } catch (error: any) {
      console.error('Failed to fetch worker status:', error);
      setStatusError(error.message || 'Failed to connect to WhatsApp worker');
      setWorkerStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [selectedGroup, getAuthToken]);

  // GUID: ADMIN_WHATSAPP-012-v03
  // [Intent] Fetch WhatsApp alert settings from Firestore and populate local editing state with saved values.
  // [Inbound Trigger] Called on component mount via useEffect.
  // [Downstream Impact] Populates masterEnabled, testMode, targetGroup, and alertToggles state used by the Alert Control Panel.
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

  // GUID: ADMIN_WHATSAPP-013-v03
  // [Intent] Poll worker status on mount and every 30 seconds to keep the status card up to date.
  // [Inbound Trigger] Component mount and fetchWorkerStatus callback reference changes.
  // [Downstream Impact] Drives real-time display of worker connection state. Clears interval on unmount.
  useEffect(() => {
    fetchWorkerStatus();
    const interval = setInterval(fetchWorkerStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchWorkerStatus]);

  // GUID: ADMIN_WHATSAPP-014-v03
  // [Intent] Auto-refresh the QR code every 30 seconds while the worker is awaiting QR scan and a QR code is displayed.
  // [Inbound Trigger] Activated when workerStatus.awaitingQR is true and qrCodeData is present.
  // [Downstream Impact] Keeps QR code fresh for scanning. Prevents expired QR codes from being displayed.
  useEffect(() => {
    if (!workerStatus?.awaitingQR || !qrCodeData) return;

    // Set up auto-refresh interval
    const refreshInterval = setInterval(() => {
      if (!qrLoading) {
        fetchQRCode();
      }
    }, QR_REFRESH_INTERVAL_MS);

    return () => clearInterval(refreshInterval);
  }, [workerStatus?.awaitingQR, qrCodeData, qrLoading, fetchQRCode]);

  // GUID: ADMIN_WHATSAPP-015-v03
  // [Intent] Track QR code age in seconds to display freshness warnings and auto-expire visual feedback.
  // [Inbound Trigger] Activated when qrFetchedAt is set (after successful QR fetch). Updates every second.
  // [Downstream Impact] Drives QR age warning UI (green/amber/red) in the QR code display section.
  useEffect(() => {
    if (!qrFetchedAt) return;

    const ageInterval = setInterval(() => {
      const ageMs = Date.now() - qrFetchedAt.getTime();
      setQrAgeSeconds(Math.floor(ageMs / 1000));
    }, 1000);

    return () => clearInterval(ageInterval);
  }, [qrFetchedAt]);

  // GUID: ADMIN_WHATSAPP-016-v03
  // [Intent] Fetch alert settings from Firestore on component mount.
  // [Inbound Trigger] Component mount and fetchAlertSettings callback reference changes.
  // [Downstream Impact] Populates the Alert Control Panel with saved settings.
  useEffect(() => {
    fetchAlertSettings();
  }, [fetchAlertSettings]);

  // GUID: ADMIN_WHATSAPP-017-v03
  // [Intent] Real-time Firestore listener for the last 10 messages in whatsapp_queue, ordered by creation time descending.
  // [Inbound Trigger] Component mount when firestore is available. Updates automatically on collection changes.
  // [Downstream Impact] Drives the Message Queue card showing pending/sent/failed messages.
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

  // GUID: ADMIN_WHATSAPP-018-v03
  // [Intent] Real-time Firestore listener for the last 50 entries in whatsapp_alert_history, ordered by creation time descending.
  // [Inbound Trigger] Component mount when firestore is available. Updates automatically on collection changes.
  // [Downstream Impact] Drives the Alert History card showing sent alerts with type, group, and test mode indicator.
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

  // GUID: ADMIN_WHATSAPP-019-v03
  // [Intent] Real-time Firestore listener for the last 25 entries in whatsapp_status_log, ordered by timestamp descending.
  // [Inbound Trigger] Component mount when firestore is available. Updates automatically on collection changes.
  // [Downstream Impact] Drives the Connection Status Log card showing connection state changes from the worker.
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

  // GUID: ADMIN_WHATSAPP-020-v03
  // [Intent] Persist alert settings (master switch, test mode, target group, alert toggles) to Firestore and log the change in audit trail.
  // [Inbound Trigger] Called when admin clicks "Save Settings" button in the Alert Control Panel.
  // [Downstream Impact] Updates settings/whatsapp_alerts Firestore document. Logs audit event. Triggers toast confirmation. Worker reads these settings to determine which alerts to send.
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

  // GUID: ADMIN_WHATSAPP-021-v03
  // [Intent] Queue a custom message for delivery to a WhatsApp group via the worker. Adds to whatsapp_queue and whatsapp_alert_history, and logs an audit event.
  // [Inbound Trigger] Called when admin clicks "Send Message" button after composing a message and selecting a group.
  // [Downstream Impact] Creates a PENDING document in whatsapp_queue (picked up by the worker for delivery). Creates a history entry. Audit log entry created.
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

  // GUID: ADMIN_WHATSAPP-022-v03
  // [Intent] Toggle an individual alert type on or off in the local editing state.
  // [Inbound Trigger] Called when admin toggles a Switch in the Alert Categories accordion.
  // [Downstream Impact] Updates alertToggles state. Change is local until "Save Settings" is clicked.
  const handleToggleAlert = (key: keyof WhatsAppAlertToggles) => {
    setAlertToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // GUID: ADMIN_WHATSAPP-023-v03
  // [Intent] Render a coloured Badge component based on message queue status (PENDING, PROCESSING, SENT, FAILED).
  // [Inbound Trigger] Called per row in both the Message Queue and Alert History tables.
  // [Downstream Impact] Pure UI helper; no side effects.
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

  // GUID: ADMIN_WHATSAPP-024-v03
  // [Intent] Format a Firestore Timestamp to a human-readable en-GB date/time string (DD/MM HH:MM).
  // [Inbound Trigger] Called for timestamp display in queue, history, and status log tables.
  // [Downstream Impact] Pure formatting helper; no side effects.
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

  // GUID: ADMIN_WHATSAPP-025-v03
  // [Intent] Derived boolean that compares local editing state against last-saved settings to detect unsaved changes.
  // [Inbound Trigger] Evaluated on every render. Compared fields: masterEnabled, testMode, targetGroup, alertToggles.
  // [Downstream Impact] Controls visibility of "Unsaved Changes" badge and enabled state of "Save Settings" button.
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
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-destructive">
                <WifiOff className="w-5 h-5" />
                <span className="font-medium">Connection Failed</span>
              </div>
              <p className="text-sm text-muted-foreground">{statusError}</p>

              <div className="rounded-md bg-zinc-900 p-3 space-y-2">
                <p className="text-xs text-zinc-400 font-medium">To restart the WhatsApp worker:</p>
                <code className="block text-xs text-green-400 font-mono bg-black/50 p-2 rounded overflow-x-auto">
                  az container restart --resource-group garcia --name prixsix-whatsapp-worker
                </code>
                <p className="text-xs text-zinc-500">
                  Run this in Azure CLI, or ask Bob/Bill to restart it for you.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchWorkerStatus}
                disabled={statusLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${statusLoading ? 'animate-spin' : ''}`} />
                Check Again
              </Button>
            </div>
          ) : workerStatus ? (
            <div className="space-y-4">
            {/* Warning if worker running but WhatsApp not connected */}
            {!workerStatus.connected && !workerStatus.awaitingQR && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">WhatsApp Not Authenticated</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  The worker is running but hasn&apos;t connected to WhatsApp yet.
                  Wait for the QR code to appear, or the worker may be initializing.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={fetchWorkerStatus}
                  disabled={statusLoading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${statusLoading ? 'animate-spin' : ''}`} />
                  Check Status
                </Button>
              </div>
            )}

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

                    {/* QR Age Warning */}
                    {qrAgeSeconds >= QR_STALE_AGE_SECONDS ? (
                      <div className="flex items-center justify-center gap-2 text-destructive bg-destructive/10 rounded-lg p-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-medium">QR code expired - refreshing...</span>
                      </div>
                    ) : qrAgeSeconds >= QR_WARN_AGE_SECONDS ? (
                      <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-500/10 rounded-lg p-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm">QR code is {qrAgeSeconds}s old - scan quickly!</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">Fresh QR code ({qrAgeSeconds}s) - auto-refreshes every 30s</span>
                      </div>
                    )}

                    <div className={`inline-block p-4 bg-white rounded-lg shadow-lg ${qrAgeSeconds >= QR_STALE_AGE_SECONDS ? 'opacity-50' : ''}`}>
                      <QRCodeComponent value={qrCodeData} size={256} level="M" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Open WhatsApp on your phone, go to Settings → Linked Devices → Link a Device, then scan this QR code.
                    </p>
                    <Button variant="outline" size="sm" onClick={fetchQRCode} disabled={qrLoading}>
                      <RefreshCw className={`w-4 h-4 mr-1 ${qrLoading ? 'animate-spin' : ''}`} />
                      {qrLoading ? 'Refreshing...' : 'Refresh Now'}
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
                      {workerStatus.groups.filter(g => g && g.trim()).map((group) => (
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
                  {workerStatus.groups.filter(g => g && g.trim()).map((group) => (
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
