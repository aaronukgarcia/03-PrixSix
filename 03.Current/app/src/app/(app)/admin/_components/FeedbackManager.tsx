// GUID: ADMIN_FEEDBACK-000-v03
// [Intent] Admin component for reviewing and managing user-submitted bug reports and feature requests, with filtering, status updates, and deletion.
// [Inbound Trigger] Rendered within the admin panel when the "Feedback" tab is selected.
// [Downstream Impact] Reads and writes to the feedback Firestore collection. Status changes (especially 'resolved') stamp version info and trigger dashboard notifications for submitters.

'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Bug, Lightbulb, Trash2, RefreshCw, User, Mail, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { APP_VERSION } from '@/lib/version';

// GUID: ADMIN_FEEDBACK-001-v03
// [Intent] Type definition for a feedback item document in the Firestore feedback collection.
// [Inbound Trigger] Used to type feedback documents read via onSnapshot real-time listener.
// [Downstream Impact] Changes to the feedback document schema must be reflected here.
interface FeedbackItem {
  id: string;
  type: 'bug' | 'feature';
  text: string;
  userId: string;
  userEmail: string;
  teamName: string;
  createdAt: Timestamp;
  status: 'new' | 'reviewed' | 'resolved' | 'dismissed';
}

// GUID: ADMIN_FEEDBACK-002-v03
// [Intent] Maps feedback status values to Tailwind CSS colour classes for badge styling.
// [Inbound Trigger] Referenced during render to colour-code status badges in the feedback list.
// [Downstream Impact] If new status values are added to FeedbackItem['status'], corresponding colour entries must be added here.
const statusColors: Record<FeedbackItem['status'], string> = {
  new: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  reviewed: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  resolved: 'bg-green-500/10 text-green-500 border-green-500/30',
  dismissed: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
};

// GUID: ADMIN_FEEDBACK-003-v03
// [Intent] Main FeedbackManager component providing a filterable, expandable list of feedback items with status management and deletion.
// [Inbound Trigger] Rendered by the admin page when the Feedback tab is active.
// [Downstream Impact] Uses real-time onSnapshot listener on the feedback collection. Status updates and deletions write back to Firestore.
export function FeedbackManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  // GUID: ADMIN_FEEDBACK-004-v03
  // [Intent] Local state for feedback items, loading flag, and filter selections (type and status).
  // [Inbound Trigger] Populated by the onSnapshot listener; filters updated by user button clicks.
  // [Downstream Impact] Drives the feedback list display, statistics counts, and filter button active states.
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'bug' | 'feature'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | FeedbackItem['status']>('all');

  // GUID: ADMIN_FEEDBACK-005-v03
  // [Intent] Sets up a real-time Firestore listener on the feedback collection, ordered by creation date descending.
  // [Inbound Trigger] Runs when the firestore instance becomes available (useEffect dependency).
  // [Downstream Impact] Keeps the feedback state array in sync with Firestore in real-time. Returns cleanup unsubscribe function.
  useEffect(() => {
    if (!firestore) return;

    const q = query(collection(firestore, 'feedback'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: FeedbackItem[] = [];
      snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() } as FeedbackItem));
      setFeedback(items);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching feedback:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load feedback',
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, toast]);

  // GUID: ADMIN_FEEDBACK-006-v03
  // [Intent] Updates a feedback item's status in Firestore. When resolving, stamps the current app version and resolution timestamp.
  // [Inbound Trigger] Clicking a status button (new, reviewed, resolved, dismissed) in a feedback item's expanded view.
  // [Downstream Impact] Updates the feedback document. When status is 'resolved', adds resolvedVersion and resolvedAt fields so the dashboard can notify the submitter.
  const updateStatus = async (id: string, status: FeedbackItem['status']) => {
    if (!firestore) return;
    try {
      const updates: Record<string, any> = { status };
      // When resolving, stamp the version so the submitter can be notified
      if (status === 'resolved') {
        updates.resolvedVersion = APP_VERSION;
        updates.resolvedAt = serverTimestamp();
        updates.resolvedNotifiedAt = null; // cleared so dashboard picks it up
      }
      await updateDoc(doc(firestore, 'feedback', id), updates);
      toast({
        title: 'Status Updated',
        description: status === 'resolved'
          ? `Marked resolved in v${APP_VERSION} — submitter will be notified`
          : `Feedback marked as ${status}`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update status',
      });
    }
  };

  // GUID: ADMIN_FEEDBACK-007-v03
  // [Intent] Permanently deletes a feedback item from the Firestore feedback collection.
  // [Inbound Trigger] Clicking "Delete" in the confirmation AlertDialog for a feedback item.
  // [Downstream Impact] Removes the document from Firestore. Irreversible. The real-time listener will automatically update the local state.
  const deleteFeedback = async (id: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'feedback', id));
      toast({
        title: 'Deleted',
        description: 'Feedback has been deleted',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete feedback',
      });
    }
  };

  // GUID: ADMIN_FEEDBACK-008-v03
  // [Intent] Formats a Firestore Timestamp into a human-readable UK-locale date string with time.
  // [Inbound Trigger] Called for each feedback item's createdAt timestamp in the list display.
  // [Downstream Impact] Display-only helper; no side effects.
  const formatDate = (ts: Timestamp) => {
    if (!ts) return 'Unknown';
    return ts.toDate().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // GUID: ADMIN_FEEDBACK-009-v03
  // [Intent] Filters the feedback array by the currently selected type and status filters.
  // [Inbound Trigger] Recomputed on every render when feedback, filterType, or filterStatus changes.
  // [Downstream Impact] Determines which feedback items are displayed in the list.
  const filtered = feedback.filter((f) => {
    const typeMatch = filterType === 'all' || f.type === filterType;
    const statusMatch = filterStatus === 'all' || f.status === filterStatus;
    return typeMatch && statusMatch;
  });

  // GUID: ADMIN_FEEDBACK-010-v03
  // [Intent] Computes summary statistics (bug count, feature count, new count) for the stats cards display.
  // [Inbound Trigger] Recomputed on every render from the unfiltered feedback array.
  // [Downstream Impact] Displayed in the statistics grid at the top of the feedback card.
  const bugCount = feedback.filter((f) => f.type === 'bug').length;
  const featureCount = feedback.filter((f) => f.type === 'feature').length;
  const newCount = feedback.filter((f) => f.status === 'new').length;

  // GUID: ADMIN_FEEDBACK-011-v03
  // [Intent] Renders a loading skeleton while feedback data is being fetched from Firestore.
  // [Inbound Trigger] loading state is true during the initial onSnapshot setup.
  // [Downstream Impact] Replaced by the full UI once the first snapshot arrives.
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-64" />
        </CardContent>
      </Card>
    );
  }

  // GUID: ADMIN_FEEDBACK-012-v03
  // [Intent] Renders the complete Feedback Manager UI: stats cards, type/status filter buttons, and an expandable accordion list of feedback items.
  // [Inbound Trigger] Component render cycle after feedback data has loaded.
  // [Downstream Impact] User interactions trigger status updates (updateStatus) and deletions (deleteFeedback) which write to Firestore.
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Feedback Manager</CardTitle>
          <CardDescription>
            Review and manage bug reports and feature requests from users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/50 rounded-lg p-4 border">
              <div className="text-2xl font-bold">{feedback.length}</div>
              <div className="text-sm text-muted-foreground">Total</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/30">
              <div className="text-2xl font-bold text-red-500">{bugCount}</div>
              <div className="text-sm text-muted-foreground">Bugs</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/30">
              <div className="text-2xl font-bold text-emerald-500">{featureCount}</div>
              <div className="text-sm text-muted-foreground">Features</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
              <div className="text-2xl font-bold text-blue-500">{newCount}</div>
              <div className="text-sm text-muted-foreground">New</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1">
              {(['all', 'bug', 'feature'] as const).map((t) => (
                <Button
                  key={t}
                  variant={filterType === t ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterType(t)}
                  className="gap-1"
                >
                  {t === 'bug' && <Bug className="h-3 w-3" />}
                  {t === 'feature' && <Lightbulb className="h-3 w-3" />}
                  {t === 'all' ? 'All Types' : t === 'bug' ? 'Bugs' : 'Features'}
                </Button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['all', 'new', 'reviewed', 'resolved', 'dismissed'] as const).map((s) => (
                <Button
                  key={s}
                  variant={filterStatus === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterStatus(s)}
                >
                  {s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {/* Feedback List */}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No feedback matching filters
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Accordion type="multiple" className="space-y-2">
                {filtered.map((item) => (
                  <AccordionItem
                    key={item.id}
                    value={item.id}
                    className="border rounded-lg overflow-hidden"
                  >
                    <AccordionTrigger className="hover:no-underline px-4 py-3 hover:bg-muted/50">
                      <div className="flex items-center gap-3 flex-1 text-left">
                        {item.type === 'bug' ? (
                          <Bug className="h-4 w-4 text-red-500 shrink-0" />
                        ) : (
                          <Lightbulb className="h-4 w-4 text-emerald-500 shrink-0" />
                        )}
                        <Badge variant="outline" className={statusColors[item.status]}>
                          {item.status}
                        </Badge>
                        <span className="truncate flex-1 text-sm">
                          {item.text.length > 60 ? item.text.substring(0, 60) + '...' : item.text}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-4">
                        {/* Full text */}
                        <div className="bg-muted/50 rounded-lg p-4">
                          <p className="whitespace-pre-wrap text-sm">{item.text}</p>
                        </div>

                        {/* User info */}
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {item.teamName}
                          </span>
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {item.userEmail}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(item.createdAt)}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2">
                          {(['new', 'reviewed', 'resolved', 'dismissed'] as const).map((s) => (
                            <Button
                              key={s}
                              variant={item.status === s ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => updateStatus(item.id, s)}
                            >
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </Button>
                          ))}
                          <div className="flex-1" />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm">
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Feedback?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. This will permanently delete this feedback item.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteFeedback(item.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
