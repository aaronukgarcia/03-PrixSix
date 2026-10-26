// GUID: ADMIN_CHEAT_CHECK-000-v01
// [Intent] Admin panel component for the "Cheat Check" button — runs a small set of read-only
//          integrity checks (late submissions vs deadline, shared login IPs) via the server and
//          shows the results with a summary. Always shows the check descriptions BEFORE running
//          so the admin knows exactly what will be examined, and treats every finding as a lead
//          for a human to look at, never an automatic verdict (see lib/cheat-check.ts caveats).
// [Inbound Trigger] Rendered in the admin panel's Audit tab.
// [Downstream Impact] Calls GET /api/admin/cheat-check (Admin SDK, read-only against game data).
//                     No writes from this component itself.

'use client';

import { useState } from 'react';
import { useAuth } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ShieldAlert, Play, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  CHEAT_CHECK_DEFINITIONS,
  type CheatCheckSummary,
} from '@/lib/cheat-check';

// GUID: ADMIN_CHEAT_CHECK-001-v01
// [Intent] Fetches an ID token then calls /api/admin/cheat-check, surfacing loading/error state.
// [Inbound Trigger] "Run Cheat Check" button click.
// [Downstream Impact] Populates `summary` state, which the results section below renders.
export function CheatCheckManager() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<CheatCheckSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    if (!firebaseUser) {
      toast({ variant: 'destructive', title: 'Not signed in', description: 'Sign in again and retry.' });
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/cheat-check', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setSummary(json.summary);
    } catch (err: any) {
      setError(err?.message ?? 'Cheat check failed');
      toast({ variant: 'destructive', title: 'Cheat check failed', description: err?.message ?? 'Unknown error' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Cheat Check
        </CardTitle>
        <CardDescription>
          Read-only checks for suspicious submission timing and account patterns. Every result
          below is a lead to look at yourself, not an automatic accusation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* What will run, shown before the admin clicks anything */}
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">Checks that will run:</p>
          <ul className="space-y-2">
            {CHEAT_CHECK_DEFINITIONS.map(def => (
              <li key={def.id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{def.label}.</span> {def.description}
              </li>
            ))}
          </ul>
        </div>

        <Button onClick={runCheck} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Running…' : 'Run Cheat Check'}
        </Button>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Check failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {summary && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 rounded-lg border p-4">
              {summary.totalFlags === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {summary.totalFlags === 0
                    ? 'No unexplained issues found.'
                    : `${summary.totalFlags} item${summary.totalFlags === 1 ? '' : 's'} worth a look.`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Run at {new Date(summary.timestamp).toLocaleString()} · {summary.totalInfo} informational note{summary.totalInfo === 1 ? '' : 's'} (explained, not flagged)
                </p>
              </div>
              <Badge variant={summary.totalFlags === 0 ? 'secondary' : 'destructive'}>
                {summary.totalFlags} flag{summary.totalFlags === 1 ? '' : 's'}
              </Badge>
            </div>

            {/* Per-check results */}
            <Accordion type="multiple" className="w-full">
              {summary.results.map(result => (
                <AccordionItem key={result.checkId} value={result.checkId}>
                  <AccordionTrigger>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{result.label}</span>
                      {result.flagCount > 0 && <Badge variant="destructive">{result.flagCount} flag{result.flagCount === 1 ? '' : 's'}</Badge>}
                      {result.infoCount > 0 && <Badge variant="secondary">{result.infoCount} info</Badge>}
                      {result.flagCount === 0 && result.infoCount === 0 && (
                        <Badge variant="outline" className="text-green-600 border-green-600">clean</Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-2">{result.description}</p>
                    {result.findings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing found.</p>
                    ) : (
                      result.findings.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 rounded border p-2.5">
                          {f.severity === 'flag' ? (
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          ) : (
                            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{f.summary}</p>
                            <p className="text-xs text-muted-foreground">{f.detail}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
