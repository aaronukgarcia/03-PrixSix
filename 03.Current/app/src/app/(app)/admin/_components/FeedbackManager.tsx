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

const statusColors: Record<FeedbackItem['status'], string> = {
  new: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  reviewed: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  resolved: 'bg-green-500/10 text-green-500 border-green-500/30',
  dismissed: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
};

export function FeedbackManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'bug' | 'feature'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | FeedbackItem['status']>('all');

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

  const filtered = feedback.filter((f) => {
    const typeMatch = filterType === 'all' || f.type === filterType;
    const statusMatch = filterStatus === 'all' || f.status === filterStatus;
    return typeMatch && statusMatch;
  });

  const bugCount = feedback.filter((f) => f.type === 'bug').length;
  const featureCount = feedback.filter((f) => f.type === 'feature').length;
  const newCount = feedback.filter((f) => f.status === 'new').length;

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
