// GUID: ADMIN_BOOKOFWORK-000-v02
// [Intent] Admin component for centralized book of work tracking - consolidates security audits, UX findings, error logs, and feedback into single management interface.
//          All error handlers use 4-pillar error handling (log, type, correlation ID, selectable display) per Golden Rule #1.
// [Inbound Trigger] Rendered within the admin panel when the "Book of Work" tab is selected
// [Downstream Impact] Reads and writes to the book_of_work Firestore collection. Provides filtering, search, inline editing, and status management for all work items.
//                     Error logs written to error_logs collection with correlation IDs for support debugging.

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, Timestamp, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { FileText, CheckCircle2, Clock, X, AlertTriangle, Shield, Palette, Zap, Server, Bug, User, Search, Plus, Edit2, Save, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { BookOfWorkEntry, BookOfWorkCategory, BookOfWorkStatus, BookOfWorkSeverity } from '@/lib/types/book-of-work';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

// GUID: ADMIN_BOOKOFWORK-001-v01
// [Intent] Extends BookOfWorkEntry interface with Firestore document ID for client-side usage
// [Inbound Trigger] Used to type book_of_work documents read via onSnapshot real-time listener
// [Downstream Impact] Changes to the book_of_work document schema must be reflected in the base interface
interface BookOfWorkEntryWithId extends Omit<BookOfWorkEntry, 'id'> {
  id: string; // Firestore document ID
}

// GUID: ADMIN_BOOKOFWORK-002-v01
// [Intent] Maps category values to display-friendly labels and icon components
// [Inbound Trigger] Referenced during render to show category badges with icons
// [Downstream Impact] If new categories added to BookOfWorkCategory type, add corresponding entries here
const categoryConfig: Record<BookOfWorkCategory, { label: string; icon: typeof Shield; color: string }> = {
  security: { label: 'Security', icon: Shield, color: 'bg-red-500/10 text-red-500 border-red-500/30' },
  ui: { label: 'UI/UX', icon: Palette, color: 'bg-purple-500/10 text-purple-500 border-purple-500/30' },
  feature: { label: 'Feature', icon: Zap, color: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  cosmetic: { label: 'Cosmetic', icon: Palette, color: 'bg-pink-500/10 text-pink-500 border-pink-500/30' },
  infrastructure: { label: 'Infrastructure', icon: Server, color: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/30' },
  'system-error': { label: 'System Error', icon: AlertTriangle, color: 'bg-orange-500/10 text-orange-500 border-orange-500/30' },
  'user-error': { label: 'User Error', icon: Bug, color: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
};

// GUID: ADMIN_BOOKOFWORK-003-v01
// [Intent] Maps status values to display labels, icon components, and Tailwind CSS styling
// [Inbound Trigger] Referenced during render to colour-code status badges in the work item list
// [Downstream Impact] If new status values added to BookOfWorkStatus type, add corresponding entries here
const statusConfig: Record<BookOfWorkStatus, { label: string; icon: typeof Clock; color: string }> = {
  tbd: { label: 'To Do', icon: Clock, color: 'bg-gray-500/10 text-gray-500 border-gray-500/30' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  done: { label: 'Done', icon: CheckCircle2, color: 'bg-green-500/10 text-green-500 border-green-500/30' },
  wont_fix: { label: "Won't Fix", icon: X, color: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' },
  duplicate: { label: 'Duplicate', icon: XCircle, color: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' },
};

// GUID: ADMIN_BOOKOFWORK-004-v01
// [Intent] Maps severity values to badge color classes for visual prioritization
// [Inbound Trigger] Referenced during render to style severity badges
// [Downstream Impact] Used for both display and sorting by impact
const severityColors: Record<BookOfWorkSeverity, string> = {
  critical: 'bg-red-600/90 text-white border-red-600',
  high: 'bg-orange-500/90 text-white border-orange-500',
  medium: 'bg-yellow-500/90 text-gray-900 border-yellow-500',
  low: 'bg-blue-500/90 text-white border-blue-500',
  informational: 'bg-gray-500/90 text-white border-gray-500',
};

// GUID: ADMIN_BOOKOFWORK-005-v02
// [Intent] Main BookOfWorkManager component providing centralized work item tracking with filtering, search, and inline editing
// [Inbound Trigger] Rendered by the admin page when the Book of Work tab is active
// [Downstream Impact] Uses real-time onSnapshot listener on book_of_work collection. Updates write back to Firestore
// @FIX(v02) Added useRef to track first load without stale closure issues
export function BookOfWorkManager() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const isFirstLoadRef = useRef(true);

  // GUID: ADMIN_BOOKOFWORK-006-v02
  // [Intent] Local state for work items, loading flag, filter selections, search query, and editing state
  //          Added loadingProgress to track "record X of Y" during initial load
  // [Inbound Trigger] Populated by onSnapshot listener; filters/search updated by user interactions
  // [Downstream Impact] Drives the work item list display, statistics counts, and filter UI states
  const [entries, setEntries] = useState<BookOfWorkEntryWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{ current: number; total: number } | null>(null);
  const [filterCategory, setFilterCategory] = useState<BookOfWorkCategory | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<BookOfWorkStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<BookOfWorkEntryWithId>>({});

  // GUID: ADMIN_BOOKOFWORK-007-v05
  // [Intent] Sets up real-time Firestore listener on book_of_work collection, ordered by last update descending
  //          Shows loading progress "record X of Y" during initial load
  //          Added timeout fallback to detect hanging Firestore connections
  // [Inbound Trigger] Runs when firestore instance becomes available (useEffect dependency)
  // [Downstream Impact] Keeps entries state in sync with Firestore in real-time. Returns cleanup unsubscribe function
  // @FIX(v05) Use useRef instead of stale closure to track first load - prevents infinite loading loop
  useEffect(() => {
    if (!firestore) {
      console.warn('[BookOfWork] Firestore instance not available');
      return;
    }

    console.log('[BookOfWork] Starting Firestore listener...');

    let progressTimeoutId: NodeJS.Timeout | null = null;

    // Set a timeout to detect if the listener never responds
    const timeoutId = setTimeout(() => {
      console.error('[BookOfWork] Firestore listener timeout - no response after 10 seconds');
      toast({
        variant: 'destructive',
        title: 'Connection Timeout',
        description: 'Unable to connect to the database. Please refresh the page.',
      });
      setLoading(false);
      isFirstLoadRef.current = false;
    }, 10000); // 10 second timeout

    const q = query(collection(firestore, 'book_of_work'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        clearTimeout(timeoutId); // Clear the timeout since we got a response
        console.log(`[BookOfWork] Received ${snapshot.docs.length} documents`);

        const totalDocs = snapshot.docs.length;
        const items: BookOfWorkEntryWithId[] = [];

        // Show initial progress only on first load
        if (isFirstLoadRef.current) {
          setLoadingProgress({ current: 0, total: totalDocs });
        }

        // Process documents with progress tracking
        snapshot.forEach((docSnap, index) => {
          // Update progress only on first load
          if (isFirstLoadRef.current) {
            setLoadingProgress({ current: index + 1, total: totalDocs });
          }

          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            title: data.title,
            description: data.description,
            category: data.category,
            severity: data.severity,
            status: data.status,
            priority: data.priority,
            source: data.source,
            sourceData: data.sourceData,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            completedAt: data.completedAt,
            versionReported: data.versionReported,
            versionFixed: data.versionFixed,
            commitHash: data.commitHash,
            fixedBy: data.fixedBy,
            assignedTo: data.assignedTo,
            createdBy: data.createdBy,
            updatedBy: data.updatedBy,
            module: data.module,
            file: data.file,
            tags: data.tags,
            guid: data.guid,
            referenceId: data.referenceId,
          } as BookOfWorkEntryWithId);
        });

        setEntries(items);

        // Delay clearing loading state only on first load to show progress
        // Subsequent real-time updates skip the delay
        if (isFirstLoadRef.current) {
          progressTimeoutId = setTimeout(() => {
            setLoading(false);
            setLoadingProgress(null);
            isFirstLoadRef.current = false;
          }, 400); // Show completed progress for 400ms
        } else {
          setLoadingProgress(null);
        }
      },
      async (error) => {
        clearTimeout(timeoutId); // Clear the timeout since we got an error response
        console.error('[BookOfWork] Firestore listener error:', error);

        // Golden Rule #1: 4-pillar error handling (log, type, correlation ID, selectable display)
        const tracedError = createTracedError(ERRORS.FIRESTORE_READ_FAILED, {
          context: { collection: 'book_of_work', operation: 'onSnapshot' },
          cause: error,
        });

        await logTracedError(tracedError);

        toast({
          variant: 'destructive',
          title: `Error ${tracedError.definition.code}`,
          description: (
            <div className="space-y-1">
              <p>{tracedError.definition.message}</p>
              <p className="text-xs font-mono select-all cursor-text">
                Correlation ID: {tracedError.correlationId}
              </p>
            </div>
          ),
        });
        setLoading(false);
      }
    );

    return () => {
      clearTimeout(timeoutId);
      if (progressTimeoutId) clearTimeout(progressTimeoutId);
      unsubscribe();
    };
  }, [firestore, toast]);

  // GUID: ADMIN_BOOKOFWORK-008-v01
  // [Intent] Filters and searches work items based on user-selected criteria
  // [Inbound Trigger] Recalculates whenever entries, filters, or search query changes (useMemo dependency)
  // [Downstream Impact] Determines which entries are displayed in the table
  const filteredEntries = useMemo(() => {
    let filtered = entries;

    // Filter by category
    if (filterCategory !== 'all') {
      filtered = filtered.filter((e) => e.category === filterCategory);
    }

    // Filter by status
    if (filterStatus !== 'all') {
      filtered = filtered.filter((e) => e.status === filterStatus);
    }

    // Search in title and description
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          e.description.toLowerCase().includes(query) ||
          e.guid?.toLowerCase().includes(query) ||
          e.referenceId?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [entries, filterCategory, filterStatus, searchQuery]);

  // GUID: ADMIN_BOOKOFWORK-009-v01
  // [Intent] Calculates summary statistics (total count, by status, by category, last updated)
  // [Inbound Trigger] Recalculates whenever entries array changes (useMemo dependency)
  // [Downstream Impact] Displays summary banner at top of component
  const stats = useMemo(() => {
    const byStatus: Record<BookOfWorkStatus, number> = {
      tbd: 0,
      in_progress: 0,
      done: 0,
      wont_fix: 0,
      duplicate: 0,
    };
    const byCategory: Record<BookOfWorkCategory, number> = {
      security: 0,
      ui: 0,
      feature: 0,
      cosmetic: 0,
      infrastructure: 0,
      'system-error': 0,
      'user-error': 0,
    };

    entries.forEach((entry) => {
      byStatus[entry.status]++;
      byCategory[entry.category]++;
    });

    const lastUpdated = entries.length > 0 ? entries[0].updatedAt.toDate() : new Date();

    return {
      total: entries.length,
      byStatus,
      byCategory,
      lastUpdated,
    };
  }, [entries]);

  // GUID: ADMIN_BOOKOFWORK-010-v01
  // [Intent] Handles status update for a work item
  // [Inbound Trigger] User selects new status from dropdown in table row
  // [Downstream Impact] Updates Firestore document and triggers real-time listener refresh
  const handleStatusUpdate = async (entryId: string, newStatus: BookOfWorkStatus) => {
    if (!firestore) return;

    try {
      const docRef = doc(firestore, 'book_of_work', entryId);
      const updateData: any = {
        status: newStatus,
        updatedAt: serverTimestamp(),
      };

      // If marking as done, set completedAt
      if (newStatus === 'done') {
        updateData.completedAt = serverTimestamp();
      }

      await updateDoc(docRef, updateData);

      toast({
        title: 'Status Updated',
        description: `Work item status changed to ${statusConfig[newStatus].label}`,
      });
    } catch (error) {
      // Golden Rule #1: 4-pillar error handling (log, type, correlation ID, selectable display)
      const tracedError = createTracedError(ERRORS.FIRESTORE_WRITE_FAILED, {
        context: { collection: 'book_of_work', operation: 'updateStatus', entryId, newStatus },
        cause: error as Error,
      });

      await logTracedError(tracedError);

      toast({
        variant: 'destructive',
        title: `Error ${tracedError.definition.code}`,
        description: (
          <div className="space-y-1">
            <p>{tracedError.definition.message}</p>
            <p className="text-xs font-mono select-all cursor-text">
              Correlation ID: {tracedError.correlationId}
            </p>
          </div>
        ),
      });
    }
  };

  // GUID: ADMIN_BOOKOFWORK-011-v01
  // [Intent] Enters edit mode for a work item, populating edit form with current values
  // [Inbound Trigger] User clicks Edit button on a table row
  // [Downstream Impact] Shows inline edit form instead of read-only display
  const startEditing = (entry: BookOfWorkEntryWithId) => {
    setEditingId(entry.id);
    setEditForm({
      title: entry.title,
      description: entry.description,
      category: entry.category,
      severity: entry.severity,
      status: entry.status,
      priority: entry.priority,
      fixedBy: entry.fixedBy,
      versionFixed: entry.versionFixed,
    });
  };

  // GUID: ADMIN_BOOKOFWORK-012-v01
  // [Intent] Saves inline edits to Firestore
  // [Inbound Trigger] User clicks Save button after editing
  // [Downstream Impact] Updates Firestore document and exits edit mode
  const saveEdit = async () => {
    if (!firestore || !editingId) return;

    try {
      const docRef = doc(firestore, 'book_of_work', editingId);
      await updateDoc(docRef, {
        ...editForm,
        updatedAt: serverTimestamp(),
      });

      toast({
        title: 'Changes Saved',
        description: 'Work item updated successfully',
      });

      setEditingId(null);
      setEditForm({});
    } catch (error) {
      // Golden Rule #1: 4-pillar error handling (log, type, correlation ID, selectable display)
      const tracedError = createTracedError(ERRORS.FIRESTORE_WRITE_FAILED, {
        context: { collection: 'book_of_work', operation: 'saveEdit', editingId },
        cause: error as Error,
      });

      await logTracedError(tracedError);

      toast({
        variant: 'destructive',
        title: `Error ${tracedError.definition.code}`,
        description: (
          <div className="space-y-1">
            <p>{tracedError.definition.message}</p>
            <p className="text-xs font-mono select-all cursor-text">
              Correlation ID: {tracedError.correlationId}
            </p>
          </div>
        ),
      });
    }
  };

  // GUID: ADMIN_BOOKOFWORK-013-v01
  // [Intent] Cancels edit mode without saving changes
  // [Inbound Trigger] User clicks Cancel button or presses Escape during edit
  // [Downstream Impact] Reverts to read-only display, discards pending changes
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // GUID: ADMIN_BOOKOFWORK-017-v01
  // [Intent] Loading skeleton with progress indicator showing "Loading record X of Y"
  // [Inbound Trigger] Displayed while initial Firestore query is in progress
  // [Downstream Impact] Provides user feedback during data loading phase
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Book of Work</CardTitle>
          <CardDescription>
            {loadingProgress
              ? `Loading record ${loadingProgress.current} of ${loadingProgress.total}...`
              : 'Loading work items...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          {loadingProgress && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                <span>Progress</span>
                <span>
                  {Math.round((loadingProgress.current / loadingProgress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(loadingProgress.current / loadingProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* GUID: ADMIN_BOOKOFWORK-014-v01 - Summary Banner */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Book of Work Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground">Total Items</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{stats.byStatus.done}</div>
              <div className="text-sm text-muted-foreground">Completed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-600">{stats.byStatus.tbd}</div>
              <div className="text-sm text-muted-foreground">To Do</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{stats.byStatus.in_progress}</div>
              <div className="text-sm text-muted-foreground">In Progress</div>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Last updated: {stats.lastUpdated.toLocaleString()}
          </div>
        </CardContent>
      </Card>

      {/* GUID: ADMIN_BOOKOFWORK-015-v01 - Filters and Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title, description, GUID, or reference ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v as BookOfWorkCategory | 'all')}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(categoryConfig).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as BookOfWorkStatus | 'all')}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(statusConfig).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredEntries.length} of {stats.total} items
          </div>
        </CardContent>
      </Card>

      {/* GUID: ADMIN_BOOKOFWORK-016-v01 - Work Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>Work Items</CardTitle>
          <CardDescription>
            {filteredEntries.length === 0
              ? 'No work items match your filters'
              : `Centralized tracking for security audits, UX findings, and system errors`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead className="min-w-[300px]">Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Fixed By</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry, index) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={categoryConfig[entry.category].color}>
                        {categoryConfig[entry.category].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.severity && (
                        <Badge variant="outline" className={severityColors[entry.severity]}>
                          {entry.severity}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === entry.id ? (
                        <Input
                          value={editForm.title || ''}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className="font-medium"
                        />
                      ) : (
                        <div>
                          <div className="font-medium">{entry.title}</div>
                          {entry.guid && (
                            <div className="text-xs text-muted-foreground mt-1">GUID: {entry.guid}</div>
                          )}
                          {entry.referenceId && (
                            <div className="text-xs text-muted-foreground">Ref: {entry.referenceId}</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === entry.id ? (
                        <Select
                          value={editForm.status || entry.status}
                          onValueChange={(v) => setEditForm({ ...editForm, status: v as BookOfWorkStatus })}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(statusConfig).map(([key, config]) => (
                              <SelectItem key={key} value={key}>
                                {config.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={statusConfig[entry.status].color}>
                          {statusConfig[entry.status].label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {editingId === entry.id ? (
                        <Input
                          value={editForm.versionFixed || ''}
                          onChange={(e) => setEditForm({ ...editForm, versionFixed: e.target.value })}
                          placeholder="1.56.7"
                          className="w-24"
                        />
                      ) : entry.versionFixed ? (
                        <div className="text-green-600 font-medium">v{entry.versionFixed}</div>
                      ) : entry.versionReported ? (
                        <div className="text-muted-foreground">v{entry.versionReported}</div>
                      ) : (
                        <div className="text-muted-foreground">-</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === entry.id ? (
                        <Select
                          value={editForm.fixedBy || ''}
                          onValueChange={(v) => setEditForm({ ...editForm, fixedBy: v as 'bill' | 'bob' | 'ben' })}
                        >
                          <SelectTrigger className="w-[100px]">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bill">bill</SelectItem>
                            <SelectItem value="bob">bob</SelectItem>
                            <SelectItem value="ben">ben</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : entry.fixedBy ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                          {entry.fixedBy}
                        </Badge>
                      ) : (
                        <div className="text-xs text-muted-foreground">-</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.updatedAt.toDate().toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === entry.id ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="default" onClick={saveEdit}>
                            <Save className="w-4 h-4 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEditing(entry)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
