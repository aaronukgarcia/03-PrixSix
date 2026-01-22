'use client';

import { useState, useCallback } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, query, collectionGroup, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  checkLeagues,
  generateSummary,
  type CheckResult,
  type ConsistencyCheckSummary,
  type UserData,
  type PredictionData,
  type RaceResultData,
  type ScoreData,
  type LeagueData,
  type Issue,
} from '@/lib/consistency';

interface ConsistencyCheckerProps {
  allUsers: User[] | null;
  isUserLoading: boolean;
}

type CheckPhase = 'idle' | 'users' | 'drivers' | 'races' | 'predictions' | 'results' | 'scores' | 'standings' | 'leagues' | 'complete';

const phaseLabels: Record<CheckPhase, string> = {
  idle: 'Ready',
  users: 'Checking users...',
  drivers: 'Checking drivers...',
  races: 'Checking races...',
  predictions: 'Checking predictions...',
  results: 'Checking race results...',
  scores: 'Checking scores...',
  standings: 'Checking standings...',
  leagues: 'Checking leagues...',
  complete: 'Complete',
};

const phaseProgress: Record<CheckPhase, number> = {
  idle: 0,
  users: 12,
  drivers: 25,
  races: 37,
  predictions: 50,
  results: 62,
  scores: 75,
  standings: 87,
  leagues: 100,
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

  // Data is now fetched ON-DEMAND when running checks, not on component mount
  // This prevents loading 4+ MB of Firestore data just by viewing the CC tab

  const runChecks = useCallback(async () => {
    if (!allUsers || !firestore) return;

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

      // Check Drivers (static)
      setCurrentPhase('drivers');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkDrivers());

      // Check Races (static)
      setCurrentPhase('races');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkRaces());

      // Fetch predictions ON-DEMAND
      setCurrentPhase('predictions');
      const predictionsSnap = await getDocs(collectionGroup(firestore, 'predictions'));
      const predData: PredictionData[] = predictionsSnap.docs.map(doc => {
        const p = doc.data();
        return {
          id: doc.id,
          userId: p.userId,
          teamId: p.teamId,
          teamName: p.teamName,
          raceId: p.raceId,
          predictions: p.predictions,
        };
      });
      results.push(checkPredictions(predData, userData));

      // Use predictions for score checking
      const allPredictions = predData;

      // Fetch race results ON-DEMAND
      setCurrentPhase('results');
      const raceResultsSnap = await getDocs(collection(firestore, 'race_results'));
      const resultData: RaceResultData[] = raceResultsSnap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id,
          raceId: r.raceId,
          driver1: r.driver1,
          driver2: r.driver2,
          driver3: r.driver3,
          driver4: r.driver4,
          driver5: r.driver5,
          driver6: r.driver6,
        };
      });
      results.push(checkRaceResults(resultData));

      // Fetch scores ON-DEMAND
      setCurrentPhase('scores');
      const scoresSnap = await getDocs(collection(firestore, 'scores'));
      const scoreData: ScoreData[] = scoresSnap.docs.map(doc => {
        const s = doc.data();
        return {
          id: doc.id,
          userId: s.userId,
          raceId: s.raceId,
          totalPoints: s.totalPoints,
          breakdown: s.breakdown,
        };
      });
      results.push(checkScores(scoreData, resultData, allPredictions, userData));

      // Check Standings
      setCurrentPhase('standings');
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push(checkStandings(scoreData, userData));

      // Fetch leagues ON-DEMAND and check
      setCurrentPhase('leagues');
      const leaguesSnap = await getDocs(collection(firestore, 'leagues'));
      const leagueData: LeagueData[] = leaguesSnap.docs.map(doc => {
        const l = doc.data();
        return {
          id: doc.id,
          name: l.name,
          ownerId: l.ownerId,
          memberUserIds: l.memberUserIds,
          isGlobal: l.isGlobal,
          inviteCode: l.inviteCode,
        };
      });
      results.push(checkLeagues(leagueData, userData));

      // Generate summary
      setCurrentPhase('complete');
      const checkSummary = generateSummary(results);
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
  }, [allUsers, firestore, toast]);

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
              disabled={isRunning || isUserLoading || !allUsers}
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
