"use client";

import { useEffect, useState, useCallback } from "react";
import { useFirestore } from "@/firebase";
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
  Activity
} from "lucide-react";
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

// WhatsApp Worker URL - Azure Container Instance
const WHATSAPP_WORKER_URL = "https://prixsix-whatsapp.uksouth.azurecontainer.io:3000";

interface WorkerStatus {
  connected: boolean;
  awaitingQR: boolean;
  groups: string[];
  timestamp: string;
  error?: string;
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

export function WhatsAppManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  // Worker status state
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Message form state
  const [message, setMessage] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [isSending, setIsSending] = useState(false);

  // Queue state
  const [recentMessages, setRecentMessages] = useState<QueueMessage[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

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
      });

      // Auto-select first group if none selected
      if (!selectedGroup && data.whatsapp?.groups?.length > 0) {
        // Try to find "Prix Six" or "The Six" first
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

  // Fetch status on mount and every 30 seconds
  useEffect(() => {
    fetchWorkerStatus();
    const interval = setInterval(fetchWorkerStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchWorkerStatus]);

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

  const handleSend = async () => {
    if (!firestore || !message.trim() || !selectedGroup) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a group and enter a message.",
      });
      return;
    }

    setIsSending(true);
    try {
      const queueRef = collection(firestore, 'whatsapp_queue');
      await addDoc(queueRef, {
        groupName: selectedGroup,
        message: message.trim(),
        status: 'PENDING',
        createdAt: serverTimestamp(),
        retryCount: 0,
      });

      toast({
        title: "Message Queued",
        description: `Message added to queue for "${selectedGroup}".`,
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
                      <Badge variant="secondary">Yes - Scan Required</Badge>
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
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {/* Send Message Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Send Message
          </CardTitle>
          <CardDescription>
            Send a message to a WhatsApp group. Messages are queued and processed by the worker.
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
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message here..."
              rows={4}
              disabled={isSending}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSend}
            disabled={isSending || !message.trim() || !selectedGroup || !workerStatus?.connected}
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

      {/* Recent Messages Card */}
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
    </div>
  );
}
