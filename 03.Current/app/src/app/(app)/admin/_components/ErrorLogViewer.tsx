// GUID: ADMIN_ERRORLOG-000-v03
// [Intent] Admin component for viewing, searching, filtering, and resolving system error logs.
// [Inbound Trigger] Rendered on the admin Error Logs tab.
// [Downstream Impact] Displays error_logs Firestore collection; allows admins to mark errors resolved. Changes to error log schema or error-codes.ts categories affect display.

'use client';

import { useState, useMemo } from 'react';
import { useCollection, useFirestore } from '@/firebase';
import { collection, query, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Search, X, ChevronDown, ChevronRight, Copy, Check, CheckCircle2 } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from '@/lib/utils';

// GUID: ADMIN_ERRORLOG-001-v03
// [Intent] Type definition for an error log document from the error_logs Firestore collection.
// [Inbound Trigger] Used to type-check all error log data flowing through this component.
// [Downstream Impact] Any schema change to the error_logs collection must be reflected here; affects ErrorLogItem rendering and all filter/group logic.
interface ErrorLog {
  id: string;
  correlationId: string;
  error: string;
  stack?: string;
  context: {
    route?: string;
    action?: string;
    userId?: string;
    additionalInfo?: {
      errorCode?: string;
      errorType?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  timestamp: {
    seconds: number;
    nanoseconds: number;
  };
  createdAt?: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

// GUID: ADMIN_ERRORLOG-002-v03
// [Intent] Maps PX error code prefixes to display colours and labels for visual categorisation.
// [Inbound Trigger] Referenced by getErrorCategory and throughout JSX to style badges and stats.
// [Downstream Impact] Adding a new error category in error-codes.ts requires a corresponding entry here for correct display.
// Error code categories with colors
const ERROR_CATEGORIES = {
  'PX-1': { label: 'Auth', color: 'bg-red-500', textColor: 'text-red-500', bgLight: 'bg-red-500/10', border: 'border-red-500/30' },
  'PX-2': { label: 'Validation', color: 'bg-amber-500', textColor: 'text-amber-500', bgLight: 'bg-amber-500/10', border: 'border-amber-500/30' },
  'PX-3': { label: 'External', color: 'bg-purple-500', textColor: 'text-purple-500', bgLight: 'bg-purple-500/10', border: 'border-purple-500/30' },
  'PX-4': { label: 'Firestore', color: 'bg-blue-500', textColor: 'text-blue-500', bgLight: 'bg-blue-500/10', border: 'border-blue-500/30' },
  'PX-5': { label: 'Racing', color: 'bg-emerald-500', textColor: 'text-emerald-500', bgLight: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  'PX-6': { label: 'Session', color: 'bg-cyan-500', textColor: 'text-cyan-500', bgLight: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  'PX-7': { label: 'Backup', color: 'bg-sky-500', textColor: 'text-sky-500', bgLight: 'bg-sky-500/10', border: 'border-sky-500/30' },
  'PX-9': { label: 'Unknown', color: 'bg-zinc-500', textColor: 'text-zinc-500', bgLight: 'bg-zinc-500/10', border: 'border-zinc-500/30' },
} as const;

// GUID: ADMIN_ERRORLOG-003-v03
// [Intent] Configuration arrays for the two rows of filter tabs: category filters and view mode filters.
// [Inbound Trigger] Rendered as tab buttons in the ErrorLogViewer UI.
// [Downstream Impact] Adding or removing tabs changes the available filter options; IDs must match ERROR_CATEGORIES keys for category tabs.
// Sub-tabs configuration - Row 1: Categories, Row 2: Views
const CATEGORY_TABS = [
  { id: 'all', label: 'All Errors', color: 'bg-zinc-600' },
  { id: 'PX-1', label: 'Auth', color: 'bg-red-500' },
  { id: 'PX-2', label: 'Validation', color: 'bg-amber-500' },
  { id: 'PX-3', label: 'External', color: 'bg-purple-500' },
  { id: 'PX-4', label: 'Firestore', color: 'bg-blue-500' },
  { id: 'PX-5', label: 'Racing', color: 'bg-emerald-500' },
  { id: 'PX-6', label: 'Session', color: 'bg-cyan-500' },
  { id: 'PX-7', label: 'Backup', color: 'bg-sky-500' },
  { id: 'PX-9', label: 'Unknown', color: 'bg-zinc-500' },
];

const VIEW_TABS = [
  { id: 'list', label: 'List View', color: 'bg-indigo-500' },
  { id: 'grouped', label: 'Grouped', color: 'bg-pink-500' },
  { id: 'recent', label: 'Last 24h', color: 'bg-orange-500' },
  { id: 'unresolved', label: 'Unresolved', color: 'bg-red-500' },
  { id: 'resolved', label: 'Resolved', color: 'bg-green-500' },
];

// GUID: ADMIN_ERRORLOG-004-v03
// [Intent] Extracts the PX category prefix from an error code string, falling back to PX-9 (Unknown).
// [Inbound Trigger] Called whenever an error log needs its category determined for styling or grouping.
// [Downstream Impact] Stats calculation, grouped view, and badge colours all depend on this classification.
function getErrorCategory(errorCode?: string): keyof typeof ERROR_CATEGORIES {
  if (!errorCode) return 'PX-9';
  const prefix = errorCode.substring(0, 4);
  if (prefix in ERROR_CATEGORIES) return prefix as keyof typeof ERROR_CATEGORIES;
  return 'PX-9';
}

// GUID: ADMIN_ERRORLOG-005-v03
// [Intent] Small utility component that copies text to the clipboard with visual feedback.
// [Inbound Trigger] Rendered next to correlation IDs and other copyable fields in error log details.
// [Downstream Impact] Supports Golden Rule #1 (selectable/copyable error details for user reporting).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// GUID: ADMIN_ERRORLOG-006-v03
// [Intent] Main exported component that provides a full error log viewing interface with filtering, searching, grouping, and resolution tracking.
// [Inbound Trigger] Mounted by the admin page when the Error Logs tab is active.
// [Downstream Impact] Reads from error_logs Firestore collection. Filter/view state changes affect which ErrorLogItem instances are rendered.
export function ErrorLogViewer() {
  const firestore = useFirestore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedView, setSelectedView] = useState('list');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // GUID: ADMIN_ERRORLOG-007-v03
  // [Intent] Memoised Firestore query that fetches the 500 most recent error logs ordered by timestamp descending.
  // [Inbound Trigger] Re-created only when the firestore instance changes.
  // [Downstream Impact] Provides the raw dataset that all filters, groups, and stats are derived from.
  const errorLogQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'error_logs'), orderBy('timestamp', 'desc'), limit(500));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: errorLogs, isLoading, error } = useCollection<ErrorLog>(errorLogQuery);

  // GUID: ADMIN_ERRORLOG-008-v03
  // [Intent] Applies category, search term, time-based, and resolution status filters to the raw error logs.
  // [Inbound Trigger] Recalculated whenever errorLogs, selectedCategory, searchTerm, or selectedView changes.
  // [Downstream Impact] Produces the filteredLogs array used for both list and grouped rendering; also feeds groupedLogs.
  // Filter and process logs
  const filteredLogs = useMemo(() => {
    if (!errorLogs) return [];

    try {
      // Filter out any null/undefined logs first
      let logs = errorLogs.filter(log => log && typeof log === 'object');

      // Filter by category
      if (selectedCategory !== 'all') {
        logs = logs.filter(log => {
          const code = log.context?.additionalInfo?.errorCode || (log as any).errorCode || '';
          // For Unknown (PX-9) category, also include errors with no error code
          if (selectedCategory === 'PX-9') {
            return !code || code.startsWith('PX-9');
          }
          return code.startsWith(selectedCategory);
        });
      }

      // Filter by search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        logs = logs.filter(log =>
          log.correlationId?.toLowerCase()?.includes(term) ||
          log.error?.toLowerCase()?.includes(term) ||
          log.context?.route?.toLowerCase()?.includes(term) ||
          log.context?.additionalInfo?.errorCode?.toLowerCase()?.includes(term)
        );
      }

      // Filter by time for "recent" view
      if (selectedView === 'recent') {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        logs = logs.filter(log => {
          const ts = log.timestamp?.seconds ? log.timestamp.seconds * 1000 : 0;
          return ts > oneDayAgo;
        });
      }

      // Filter by resolved status
      if (selectedView === 'unresolved') {
        logs = logs.filter(log => !log.resolved);
      } else if (selectedView === 'resolved') {
        logs = logs.filter(log => log.resolved === true);
      }

      return logs;
    } catch (e) {
      console.error('Error filtering logs:', e);
      return [];
    }
  }, [errorLogs, selectedCategory, searchTerm, selectedView]);

  // GUID: ADMIN_ERRORLOG-009-v03
  // [Intent] Extracts the error code from a log, checking multiple possible locations in the log structure.
  // [Inbound Trigger] Called by groupedLogs and stats memos, and anywhere an error code is needed from a log.
  // [Downstream Impact] Inconsistent error code storage locations are normalised here; affects grouping and stats accuracy.
  // Helper to get error code from log (checks multiple locations)
  const getLogErrorCode = (log: ErrorLog): string | undefined => {
    if (!log) return undefined;
    return log.context?.additionalInfo?.errorCode || (log as any).errorCode;
  };

  // GUID: ADMIN_ERRORLOG-010-v03
  // [Intent] Groups filtered logs by their error code for the "Grouped" view mode.
  // [Inbound Trigger] Recalculated when filteredLogs changes.
  // [Downstream Impact] Powers the grouped view rendering; each group is collapsible in the UI.
  // Group logs by error code
  const groupedLogs = useMemo(() => {
    try {
      const groups: Record<string, ErrorLog[]> = {};
      filteredLogs.forEach(log => {
        if (!log) return;
        const code = getLogErrorCode(log) || 'Unknown';
        if (!groups[code]) groups[code] = [];
        groups[code].push(log);
      });
      return groups;
    } catch (e) {
      console.error('Error grouping logs:', e);
      return {};
    }
  }, [filteredLogs]);

  // GUID: ADMIN_ERRORLOG-011-v03
  // [Intent] Computes aggregate statistics (total count and per-category counts) across all unfiltered error logs.
  // [Inbound Trigger] Recalculated when the raw errorLogs data changes.
  // [Downstream Impact] Drives the stats row at the top of the UI and badge counts on category tabs.
  // Stats
  const stats = useMemo(() => {
    if (!errorLogs) return { total: 0, categories: {} as Record<string, number> };
    try {
      const categories: Record<string, number> = {};
      errorLogs.forEach(log => {
        if (!log) return;
        const cat = getErrorCategory(getLogErrorCode(log));
        categories[cat] = (categories[cat] || 0) + 1;
      });
      return { total: errorLogs.length, categories };
    } catch (e) {
      console.error('Error calculating stats:', e);
      return { total: 0, categories: {} as Record<string, number> };
    }
  }, [errorLogs]);

  // GUID: ADMIN_ERRORLOG-012-v03
  // [Intent] Toggles the expanded/collapsed state of a group in the grouped view.
  // [Inbound Trigger] Called when a user clicks a group header in the grouped view.
  // [Downstream Impact] Controls which group's error items are visible in the grouped view.
  const toggleGroup = (code: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(code)) {
      newExpanded.delete(code);
    } else {
      newExpanded.add(code);
    }
    setExpandedGroups(newExpanded);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error Loading Error Logs</AlertTitle>
        <AlertDescription>
          There was a problem fetching the error logs. Please ensure you have the correct Firestore permissions.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Error Log Viewer</CardTitle>
        <CardDescription>
          View and search system errors with correlation IDs for tracking.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          <div className="bg-muted/50 rounded-lg p-3 border">
            <div className="text-xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          {Object.entries(ERROR_CATEGORIES).map(([key, cat]) => (
            <div key={key} className={cn("rounded-lg p-3 border", cat.bgLight, cat.border)}>
              <div className={cn("text-xl font-bold", cat.textColor)}>{stats.categories[key] || 0}</div>
              <div className="text-xs text-muted-foreground">{cat.label}</div>
            </div>
          ))}
        </div>

        {/* Row 1: Category Tabs */}
        <div className="flex flex-wrap gap-1">
          {CATEGORY_TABS.map(tab => (
            <Button
              key={tab.id}
              variant="outline"
              size="sm"
              onClick={() => setSelectedCategory(tab.id)}
              className={cn(
                "transition-all",
                selectedCategory === tab.id && `${tab.color} text-white border-transparent hover:${tab.color} hover:text-white`
              )}
            >
              {tab.label}
              {tab.id !== 'all' && stats.categories[tab.id] ? (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">{stats.categories[tab.id]}</Badge>
              ) : null}
            </Button>
          ))}
        </div>

        {/* Row 2: View Tabs */}
        <div className="flex flex-wrap gap-1">
          {VIEW_TABS.map(tab => (
            <Button
              key={tab.id}
              variant="outline"
              size="sm"
              onClick={() => setSelectedView(tab.id)}
              className={cn(
                "transition-all",
                selectedView === tab.id && `${tab.color} text-white border-transparent hover:${tab.color} hover:text-white`
              )}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by correlation ID, error message, route, or error code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearchTerm('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results Count */}
        <div className="text-sm text-muted-foreground">
          Showing {filteredLogs.length} of {errorLogs?.length || 0} errors
          {selectedView === 'grouped' && ` in ${Object.keys(groupedLogs).length} groups`}
        </div>

        {/* Error List */}
        <ScrollArea className="h-[500px] border rounded-lg">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : selectedView === 'grouped' ? (
            /* Grouped View */
            <div className="divide-y">
              {Object.entries(groupedLogs).map(([code, logs]) => {
                const category = ERROR_CATEGORIES[getErrorCategory(code)];
                const isExpanded = expandedGroups.has(code);
                return (
                  <div key={code}>
                    <button
                      onClick={() => toggleGroup(code)}
                      className={cn(
                        "w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors",
                        category.bgLight
                      )}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Badge className={cn(category.color, "text-white")}>{code}</Badge>
                      <span className="font-medium flex-1 text-left">{category.label} Errors</span>
                      <Badge variant="secondary">{logs.length}</Badge>
                    </button>
                    {isExpanded && (
                      <div className="border-t bg-muted/30">
                        {logs.map(log => (
                          <ErrorLogItem key={log.id} log={log} firestore={firestore} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {Object.keys(groupedLogs).length === 0 && (
                <div className="text-center text-muted-foreground p-12">
                  No errors match your filters.
                </div>
              )}
            </div>
          ) : (
            /* List View */
            <Accordion type="single" collapsible className="w-full">
              {filteredLogs.length > 0 ? (
                filteredLogs.map(log => (
                  <ErrorLogItem key={log.id} log={log} accordion firestore={firestore} />
                ))
              ) : (
                <div className="text-center text-muted-foreground p-12">
                  No errors match your filters.
                </div>
              )}
            </Accordion>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// GUID: ADMIN_ERRORLOG-013-v03
// [Intent] Renders a single error log entry with expandable details, copy-able correlation ID, stack trace, context, and a "Mark as Resolved" action.
// [Inbound Trigger] Rendered by ErrorLogViewer for each error log in both list and grouped views.
// [Downstream Impact] Writes to error_logs collection when marking resolved. Supports Golden Rule #1 by exposing copyable correlation IDs.
function ErrorLogItem({ log, accordion, firestore, onResolved }: {
  log: ErrorLog;
  accordion?: boolean;
  firestore?: ReturnType<typeof useFirestore>;
  onResolved?: () => void;
}) {
  const [isResolving, setIsResolving] = useState(false);

  // Defensive null checks for all fields
  if (!log) return null;

  const logErrorCode = log.context?.additionalInfo?.errorCode || (log as any).errorCode;
  const category = ERROR_CATEGORIES[getErrorCategory(logErrorCode)];
  const errorCode = logErrorCode || 'Unknown';
  const correlationId = log.correlationId || log.id || 'N/A';
  const errorMessage = log.error || 'Unknown error';
  const isResolved = log.resolved === true;

  // GUID: ADMIN_ERRORLOG-014-v03
  // [Intent] Marks an error log as resolved by updating the Firestore document with resolved=true and a timestamp.
  // [Inbound Trigger] Called when the admin clicks "Mark as Resolved" on an unresolved error.
  // [Downstream Impact] Updates the error_logs document; the real-time listener will reflect the change in the UI.
  const handleMarkResolved = async () => {
    if (!firestore || !log.id) return;
    setIsResolving(true);
    try {
      const logRef = doc(firestore, 'error_logs', log.id);
      await updateDoc(logRef, {
        resolved: true,
        resolvedAt: new Date().toISOString(),
      });
      onResolved?.();
    } catch (err) {
      console.error('Failed to mark as resolved:', err);
    } finally {
      setIsResolving(false);
    }
  };

  // GUID: ADMIN_ERRORLOG-015-v03
  // [Intent] Safely extracts a Date object from the log's timestamp, handling both Firestore seconds and ISO string formats.
  // [Inbound Trigger] Called during render to produce human-readable timestamps.
  // [Downstream Impact] If null is returned, the UI displays "Unknown time" instead of crashing.
  // Safely get timestamp - handle null/undefined timestamp
  const getTimestamp = (): Date | null => {
    try {
      if (log.timestamp?.seconds) {
        return new Date(log.timestamp.seconds * 1000);
      }
      if (log.createdAt) {
        return new Date(log.createdAt);
      }
    } catch {
      return null;
    }
    return null;
  };
  const timestamp = getTimestamp();

  // GUID: ADMIN_ERRORLOG-016-v03
  // [Intent] Safely serialises the error log's context object to a JSON string for display.
  // [Inbound Trigger] Called during render when expanding error details.
  // [Downstream Impact] If serialisation fails, a fallback message is shown instead of crashing.
  // Safely stringify context
  const contextString = (() => {
    try {
      return JSON.stringify(log.context || {}, null, 2);
    } catch {
      return '{ "error": "Could not serialize context" }';
    }
  })();

  const content = (
    <div className="p-4 border-t bg-muted/50 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Correlation ID</h4>
          <div className="flex items-center gap-1">
            <code className="font-mono text-xs bg-background px-2 py-1 rounded select-all">{correlationId}</code>
            <CopyButton text={correlationId} />
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Route</h4>
          <p className="text-sm">{log.context?.route || 'N/A'}</p>
        </div>
      </div>
      <div>
        <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Error Message</h4>
        <p className="text-sm text-destructive">{errorMessage}</p>
      </div>
      {log.stack && (
        <div>
          <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Stack Trace</h4>
          <pre className="p-2 bg-background rounded-md text-xs overflow-auto max-h-32">
            <code>{log.stack}</code>
          </pre>
        </div>
      )}
      <div>
        <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Context</h4>
        <pre className="p-2 bg-background rounded-md text-xs overflow-auto max-h-48">
          <code>{contextString}</code>
        </pre>
      </div>
      {/* Resolution status and button */}
      <div className="flex items-center justify-between pt-2 border-t">
        {isResolved ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Resolved</span>
            {log.resolvedAt && (
              <span className="text-xs text-muted-foreground">
                on {format(new Date(log.resolvedAt), "MMM d, yyyy")}
              </span>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Not resolved</div>
        )}
        {!isResolved && firestore && (
          <Button
            size="sm"
            variant="outline"
            className="text-green-600 border-green-600 hover:bg-green-50"
            onClick={handleMarkResolved}
            disabled={isResolving}
          >
            {isResolving ? 'Resolving...' : 'Mark as Resolved'}
          </Button>
        )}
      </div>
    </div>
  );

  if (accordion) {
    return (
      <AccordionItem value={log.id || correlationId} className={cn(isResolved && "bg-green-50/50")}>
        <AccordionTrigger className="p-4 hover:no-underline hover:bg-muted/50">
          <div className="flex items-center gap-3 w-full">
            {isResolved && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
            <Badge className={cn(isResolved ? "bg-green-500" : category.color, "text-white shrink-0")}>{errorCode}</Badge>
            <span className={cn("flex-1 text-left truncate text-sm", isResolved && "text-muted-foreground")}>{errorMessage}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {timestamp ? formatDistanceToNow(timestamp, { addSuffix: true }) : 'Unknown time'}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{timestamp ? format(timestamp, "MMM d, yyyy, h:mm:ss a") : 'No timestamp'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </AccordionTrigger>
        <AccordionContent>{content}</AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-3 p-3">
        <Badge className={cn(category.color, "text-white shrink-0")}>{errorCode}</Badge>
        <span className="flex-1 text-left truncate text-sm">{errorMessage}</span>
        <span className="text-muted-foreground text-xs shrink-0">
          {timestamp ? formatDistanceToNow(timestamp, { addSuffix: true }) : 'Unknown time'}
        </span>
      </div>
    </div>
  );
}
