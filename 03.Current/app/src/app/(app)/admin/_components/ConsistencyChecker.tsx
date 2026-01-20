'use client';

import { useState, useMemo, useCallback } from 'react';
import { useFirestore, useCollection, useAuth } from '@/firebase';
import { collection, query, collectionGroup, addDoc, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/firebase/provider';
import {
  checkUsers,
  checkDrivers,
  checkRaces,
  checkPredictions,
  checkRaceResults,
  checkScores,
  checkStandings,
  checkSubmissions,
  checkAuditLogs,
  checkTeams,
  checkSubmissionAuditConsistency,
  generateSummary,
  type CheckResult,
  type ConsistencyCheckSummary,
  type UserData,
  type PredictionData,
  type RaceResultData,
  type ScoreData,
  type SubmissionData,
  type AuditData,
  type Issue,
} from '@/lib/consistency';
import { APP_VERSION } from '@/lib/version';

interface ConsistencyCheckerProps {
  allUsers: User[] | null;
  isUserLoading: boolean;
}

type CheckPhase = 'idle' | 'users' | 'teams' | 'drivers' | 'races' | 'predictions' | 'submissions' | 'audit' | 'results' | 'scores' | 'standings' | 'logging' | 'complete';

const phaseLabels: Record<CheckPhase, string> = {
  idle: 'Ready',
  users: 'Checking users...',
  teams: 'Checking teams...',
  drivers: 'Checking drivers...',
  races: 'Checking races...',
  predictions: 'Checking predictions...',
  submissions: 'Checking submissions...',
  audit: 'Checking audit logs...',
  results: 'Checking race results...',
  scores: 'Checking scores...',
  standings: 'Checking standings...',
  logging: 'Saving to CC-logs...',
  complete: 'Complete',
};

const phaseProgress: Record<CheckPhase, number> = {
  idle: 0,
  users: 8,
  teams: 16,
  drivers: 24,
  races: 32,
  predictions: 40,
  submissions: 48,
  audit: 56,
  results: 64,
  scores: 72,
  standings: 80,
  logging: 90,
  complete: 100,
};

function getStatusIcon(status: CheckResult['status']) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
}

function getStatusBadge(status: CheckResult['status']) {
  switch (status) {
    case 'pass':
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Pass</Badge>;
    case 'warning':
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>;
    case 'error':
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Error</Badge>;
  }
}

function getSeverityBadge(severity: Issue['severity']) {
  switch (severity) {
    case 'warning':
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>;
    case 'error':
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Error</Badge>;
  }
}

export function ConsistencyChecker({ allUsers, isUserLoading }: ConsistencyCheckerProps) {
  const firestore = useFirestore();
  const { user } = useAuth();
  const { toast } = useToast();

  const [isRunning, setIsRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<CheckPhase>('idle');
  const [summary, setSummary] = useState<ConsistencyCheckSummary | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Queries for collections
  const predictionsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = collectionGroup(firestore, 'predictions');
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const predictionSubmissionsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'prediction_submissions'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const raceResultsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'race_results'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const scoresQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'scores'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const auditLogsQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'audit_logs'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: predictions, isLoading: isPredictionsLoading } = useCollection<PredictionData>(predictionsQuery);
  const { data: predictionSubmissions, isLoading: isSubmissionsLoading } = useCollection<SubmissionData>(predictionSubmissionsQuery);
  const { data: raceResults, isLoading: isResultsLoading } = useCollection<RaceResultData>(raceResultsQuery);
  const { data: scores, isLoading: isScoresLoading } = useCollection<ScoreData>(scoresQuery);
  const { data: auditLogs, isLoading: isAuditLoading } = useCollection<AuditData>(auditLogsQuery);

  const isDataLoading = isUserLoading || isPredictionsLoading || isSubmissionsLoading || isResultsLoading || isScoresLoading || isAuditLoading;

  const runChecks = useCallback(async () => {
    if (!allUsers) return;

    setIsRunning(true);
    setSummary(null);
    const results: CheckResult[] = [];

    try {
      // Check Users
      setCurrentPhase('users');
      await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI update
      const userData: UserData[] = allUsers.map(u => ({
        id: u.id,
        email: u.email,
        teamName: u.teamName,
        isAdmin: u.isAdmin,
        secondaryTeamName: u.secondaryTeamName,
      }));
      results.push(checkUsers(userData));

      // Check Teams (counting validation)
      setCurrentPhase('teams');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkTeams(userData));

      // Check Drivers (static)
      setCurrentPhase('drivers');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkDrivers());

      // Check Races (static)
      setCurrentPhase('races');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkRaces());

      // Check Predictions
      setCurrentPhase('predictions');
      await new Promise(resolve => setTimeout(resolve, 100));
      const predData: PredictionData[] = (predictions || []).map(p => ({
        id: p.id,
        userId: p.userId,
        teamId: p.teamId,
        teamName: p.teamName,
        raceId: p.raceId,
        predictions: p.predictions,
      }));
      const subData: SubmissionData[] = (predictionSubmissions || []).map(s => ({
        id: s.id,
        oduserId: s.oduserId,
        teamName: s.teamName,
        raceId: s.raceId,
        submittedAt: s.submittedAt,
        predictions: s.predictions as SubmissionData['predictions'],
      }));
      const subAsPredData: PredictionData[] = subData.map(s => ({
        id: s.id,
        oduserId: s.oduserId,
        teamName: s.teamName,
        raceId: s.raceId,
        predictions: s.predictions,
      }));
      results.push(checkPredictions(predData, userData, subAsPredData));

      // Check Submissions (lowercase drivers, missing dates)
      setCurrentPhase('submissions');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkSubmissions(subData));

      // Check Audit Logs (lowercase drivers)
      setCurrentPhase('audit');
      await new Promise(resolve => setTimeout(resolve, 100));
      const auditData: AuditData[] = (auditLogs || []).map(a => ({
        id: a.id,
        eventType: a.eventType,
        userId: a.userId,
        teamName: a.teamName,
        timestamp: a.timestamp,
        details: a.details,
      }));
      results.push(checkAuditLogs(auditData));

      // Check Submission-Audit Consistency
      results.push(checkSubmissionAuditConsistency(subData, auditData));

      // Merge predictions from both sources for score checking
      const allPredictions = [...predData, ...subAsPredData];

      // Check Race Results
      setCurrentPhase('results');
      await new Promise(resolve => setTimeout(resolve, 100));
      const resultData: RaceResultData[] = (raceResults || []).map(r => ({
        id: r.id,
        raceId: r.raceId,
        driver1: r.driver1,
        driver2: r.driver2,
        driver3: r.driver3,
        driver4: r.driver4,
        driver5: r.driver5,
        driver6: r.driver6,
      }));
      results.push(checkRaceResults(resultData));

      // Check Scores
      setCurrentPhase('scores');
      await new Promise(resolve => setTimeout(resolve, 100));
      const scoreData: ScoreData[] = (scores || []).map(s => ({
        id: s.id,
        userId: s.userId,
        raceId: s.raceId,
        totalPoints: s.totalPoints,
        breakdown: s.breakdown,
      }));
      results.push(checkScores(scoreData, resultData, allPredictions, userData));

      // Check Standings
      setCurrentPhase('standings');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkStandings(scoreData, userData));

      // Generate summary with version
      const checkSummary = generateSummary(results, APP_VERSION);

      // Log to CC-logs collection
      setCurrentPhase('logging');
      await new Promise(resolve => setTimeout(resolve, 100));
      if (firestore) {
        try {
          const ccLogEntry = {
            correlationId: checkSummary.correlationId,
            timestamp: serverTimestamp(),
            executedAt: new Date().toISOString(),
            version: APP_VERSION,
            executedBy: user?.id || 'unknown',
            summary: {
              totalChecks: checkSummary.totalChecks,
              passed: checkSummary.passed,
              warnings: checkSummary.warnings,
              errors: checkSummary.errors,
            },
            categoryResults: checkSummary.results.map(r => ({
              category: r.category,
              status: r.status,
              total: r.total,
              valid: r.valid,
              issueCount: r.issues.length,
            })),
            totalIssues: checkSummary.results.reduce((sum, r) => sum + r.issues.length, 0),
          };
          await addDoc(collection(firestore, 'CC-logs'), ccLogEntry);
        } catch (logError) {
          console.error('Failed to save CC-logs:', logError);
        }
      }

      setCurrentPhase('complete');
      setSummary(checkSummary);

      toast({
        title: 'Consistency Check Complete',
        description: `${checkSummary.passed} passed, ${checkSummary.warnings} warnings, ${checkSummary.errors} errors`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Check Failed',
        description: error.message,
      });
    } finally {
      setIsRunning(false);
    }
  }, [allUsers, predictions, predictionSubmissions, raceResults, scores, auditLogs, firestore, user, toast]);

  const exportToErrorLog = useCallback(async () => {
    if (!firestore || !summary || !user) return;

    setIsExporting(true);
    try {
      const allIssues = summary.results.flatMap(r =>
        r.issues.map(i => ({
          category: r.category,
          ...i,
        }))
      );

      const errorLogEntry = {
        correlationId: summary.correlationId,
        type: 'consistency_check',
        timestamp: serverTimestamp(),
        summary: {
          totalChecks: summary.totalChecks,
          passed: summary.passed,
          warnings: summary.warnings,
          errors: summary.errors,
        },
        issues: allIssues,
        exportedBy: user.id,
      };

      await addDoc(collection(firestore, 'error_logs'), errorLogEntry);

      toast({
        title: 'Export Successful',
        description: `Issues exported with correlation ID: ${summary.correlationId}`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Export Failed',
        description: error.message,
      });
    } finally {
      setIsExporting(false);
    }
  }, [firestore, summary, user, toast]);

  const totalIssues = summary?.results.reduce((sum, r) => sum + r.issues.length, 0) || 0;

  if (isDataLoading && !summary) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full mt-4" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Consistency Checker</CardTitle>
          <CardDescription>
            Validate data integrity across all collections and relationships.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={runChecks}
              disabled={isRunning || isDataLoading}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Consistency Check
                </>
              )}
            </Button>
            {summary && totalIssues > 0 && (
              <Button
                variant="outline"
                onClick={exportToErrorLog}
                disabled={isExporting}
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Export Issues to Error Log
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Progress */}
          {isRunning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{phaseLabels[currentPhase]}</span>
                <span>{phaseProgress[currentPhase]}%</span>
              </div>
              <Progress value={phaseProgress[currentPhase]} />
            </div>
          )}

          {/* Summary Table */}
          {summary && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">Correlation ID:</span>
                <code className="px-2 py-1 bg-muted rounded text-xs">{summary.correlationId}</code>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Valid</TableHead>
                    <TableHead className="text-center">Issues</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.results.map((result) => (
                    <TableRow key={result.category}>
                      <TableCell className="font-medium capitalize">{result.category}</TableCell>
                      <TableCell className="text-center">{result.total}</TableCell>
                      <TableCell className="text-center">{result.valid}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {result.issues.length}
                          {result.issues.length === 0 && (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                          {result.issues.length > 0 && result.issues.some(i => i.severity === 'error') && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          {result.issues.length > 0 && !result.issues.some(i => i.severity === 'error') && (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{getStatusBadge(result.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Summary Stats */}
              <div className="flex gap-6 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium">{summary.passed} Passed</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  <span className="font-medium">{summary.warnings} Warnings</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="font-medium">{summary.errors} Errors</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issues Detail */}
      {summary && totalIssues > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Issues ({totalIssues})
            </CardTitle>
            <CardDescription>
              Detailed list of all issues found during the consistency check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Accordion type="multiple" className="w-full">
                {summary.results
                  .filter(r => r.issues.length > 0)
                  .map((result) => (
                    <AccordionItem key={result.category} value={result.category}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(result.status)}
                          <span className="capitalize font-medium">{result.category}</span>
                          <Badge variant="secondary">{result.issues.length} issues</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pl-7">
                          {result.issues.map((issue, idx) => (
                            <div
                              key={idx}
                              className="p-3 border rounded-lg bg-background space-y-2"
                            >
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    {getSeverityBadge(issue.severity)}
                                    <span className="font-medium">{issue.entity}</span>
                                    {issue.field && (
                                      <code className="text-xs px-1 py-0.5 bg-muted rounded">
                                        {issue.field}
                                      </code>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground">{issue.message}</p>
                                </div>
                              </div>
                              {issue.details && (
                                <pre className="text-xs p-2 bg-muted rounded overflow-auto">
                                  <code>{JSON.stringify(issue.details, null, 2)}</code>
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
              </Accordion>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Success Message */}
      {summary && totalIssues === 0 && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">All Checks Passed</AlertTitle>
          <AlertDescription className="text-green-700">
            No data integrity issues were found. All collections and relationships are consistent.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
