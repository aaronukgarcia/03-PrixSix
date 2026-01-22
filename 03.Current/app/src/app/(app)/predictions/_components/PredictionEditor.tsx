
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Driver } from "@/lib/data";
import { getDriverImage } from "@/lib/data";
import { ArrowDown, ArrowUp, X, Check, ListCollapse, Timer, Sparkles, Settings2, RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/firebase";
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

// Analysis weights interface
interface AnalysisWeights {
  driverForm: number;
  trackHistory: number;
  overtakingCrashes: number;
  circuitCharacteristics: number;
  trackSurface: number;
  layoutChanges: number;
  weather: number;
  tyreStrategy: number;
  bettingOdds: number;
  punditAlignment: number;
}

// Analysis facets configuration
const ANALYSIS_FACETS = [
  { key: 'driverForm', label: 'Driver Form', icon: '📈', description: 'Recent performance over last 3-4 races' },
  { key: 'trackHistory', label: 'Track History', icon: '🏆', description: 'Past results at this specific circuit' },
  { key: 'overtakingCrashes', label: 'Overtakes & Incidents', icon: '⚔️', description: 'Historical overtaking moves and crashes' },
  { key: 'circuitCharacteristics', label: 'Circuit Layout', icon: '🛣️', description: 'Track features, corners, straights' },
  { key: 'trackSurface', label: 'Track Surface', icon: '🏁', description: 'Grip levels, resurfacing, bumps' },
  { key: 'layoutChanges', label: 'Layout Changes', icon: '🔄', description: 'Recent modifications vs previous years' },
  { key: 'weather', label: 'Weather', icon: '🌡️', description: 'Temperature, humidity, rain probability' },
  { key: 'tyreStrategy', label: 'Tyre Strategy', icon: '⚫', description: 'Compound choices, degradation, pit windows' },
  { key: 'bettingOdds', label: 'Betting Odds', icon: '💰', description: 'Current bookmaker predictions' },
  { key: 'punditAlignment', label: 'Pundit Views', icon: '🎙️', description: 'Expert predictions comparison' },
] as const;

const DEFAULT_WEIGHTS: AnalysisWeights = {
  driverForm: 7,
  trackHistory: 7,
  overtakingCrashes: 7,
  circuitCharacteristics: 7,
  trackSurface: 7,
  layoutChanges: 7,
  weather: 7,
  tyreStrategy: 7,
  bettingOdds: 7,
  punditAlignment: 7,
};

const MAX_TOTAL_WEIGHT = 70;

interface PredictionEditorProps {
  allDrivers: Driver[];
  isLocked: boolean;
  initialPredictions: (Driver | null)[];
  raceName: string;
  teamName?: string;
  qualifyingTime: string;
  allTeamNames?: string[];
  circuitName?: string;
}

export function PredictionEditor({ allDrivers, isLocked, initialPredictions, raceName, teamName, qualifyingTime, allTeamNames = [], circuitName }: PredictionEditorProps) {
  const { user, firebaseUser } = useAuth();
  const [predictions, setPredictions] = useState<(Driver | null)[]>(initialPredictions);
  const [history, setHistory] = useState<string[]>([]);
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<string>("");
  const [applyToAll, setApplyToAll] = useState(false);

  // AI Analysis state
  const [weights, setWeights] = useState<AnalysisWeights>(DEFAULT_WEIGHTS);
  const [showWeightsPanel, setShowWeightsPanel] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [isAnalysing, setIsAnalysing] = useState(false);

  // Calculate total weight
  const totalWeight = useMemo(() => {
    return Object.values(weights).reduce((sum, w) => sum + w, 0);
  }, [weights]);

  const remainingPoints = MAX_TOTAL_WEIGHT - totalWeight;

  // Only show "Apply to All" if user has multiple teams
  const hasMultipleTeams = allTeamNames.length > 1;

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const qualifyingDate = new Date(qualifyingTime);
      const diff = qualifyingDate.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("CLOSED");
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setCountdown(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${minutes}m ${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [qualifyingTime]);

  const availableDrivers = allDrivers.filter(
    (d) => !predictions.some((p) => p?.id === d.id)
  );

  const addChangeToHistory = (change: string, includeTimestamp = false) => {
    const timestamp = includeTimestamp ? ` [${new Date().toLocaleString()}]` : "";
    setHistory(prev => [change + timestamp, ...prev].slice(0, 5));
  }

  const handleAddDriver = (driver: Driver) => {
    if (isLocked) return;
    const newPredictions = [...predictions];
    const firstEmptyIndex = newPredictions.findIndex((p) => p === null);
    if (firstEmptyIndex !== -1) {
      newPredictions[firstEmptyIndex] = driver;
      setPredictions(newPredictions);
      addChangeToHistory(`+ ${driver.name} to P${firstEmptyIndex + 1}`);
    }
  };

  const handleRemoveDriver = (index: number) => {
    if (isLocked) return;
    const driverName = predictions[index]?.name;
    const newPredictions = [...predictions];
    newPredictions[index] = null;
    setPredictions(newPredictions);
    if(driverName) addChangeToHistory(`- ${driverName} from grid`);
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    if (isLocked) return;
    const newPredictions = [...predictions];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex >= 0 && targetIndex < newPredictions.length) {
      [newPredictions[index], newPredictions[targetIndex]] = [
        newPredictions[targetIndex],
        newPredictions[index],
      ];
      setPredictions(newPredictions);
      const driver1 = newPredictions[index]?.name;
      const driver2 = newPredictions[targetIndex]?.name;
      if(driver1 && driver2) addChangeToHistory(`↔️ Swapped ${driver1} / ${driver2}`);
    }
  };

  const handleSubmit = async () => {
    if (!user || !teamName) {
        toast({ variant: "destructive", title: "Error", description: "User or team not identified." });
        return;
    }
    const isComplete = predictions.every(p => p !== null);
    if (!isComplete) {
        toast({
            variant: "destructive",
            title: "Incomplete Grid",
            description: "You must select 6 drivers to submit your prediction."
        })
        return;
    }

    setIsSubmitting(true);
    try {
        // SECURITY: Get Firebase ID token for server-side verification
        if (!firebaseUser) {
            throw new Error('Not authenticated');
        }
        const idToken = await firebaseUser.getIdToken();
        const raceId = raceName.replace(/\s+/g, '-');
        const predictionIds = predictions.map(p => p?.id).filter(Boolean) as string[];

        // Determine which teams to submit for
        const teamsToSubmit = applyToAll && hasMultipleTeams ? allTeamNames : [teamName];
        const results: { team: string; success: boolean; error?: string }[] = [];

        for (const team of teamsToSubmit) {
            const teamId = team === user.secondaryTeamName ? `${user.id}-secondary` : user.id;

            const response = await fetch('/api/submit-prediction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    userId: user.id,
                    teamId,
                    teamName: team,
                    raceId,
                    raceName,
                    predictions: predictionIds,
                }),
            });

            const result = await response.json();
            results.push({ team, success: result.success, error: result.error });
        }

        // Check results
        const successfulTeams = results.filter(r => r.success).map(r => r.team);
        const failedTeams = results.filter(r => !r.success);

        if (failedTeams.length > 0) {
            throw new Error(`Failed for: ${failedTeams.map(f => `${f.team} (${f.error})`).join(', ')}`);
        }

        // Add submission to changelog with timestamp
        const teamsText = successfulTeams.length > 1 ? `all teams (${successfulTeams.join(', ')})` : teamName;
        addChangeToHistory(`Submitted prediction for ${teamsText}`, true);

        toast({
            title: "Prediction Submitted!",
            description: successfulTeams.length > 1
                ? `Your grid has been applied to all ${successfulTeams.length} teams. Good luck!`
                : `Your grid for ${teamName} is locked in. Good luck!`,
        });

    } catch (e: any) {
        toast({
            variant: "destructive",
            title: "Submission Failed",
            description: e.message
        });
    } finally {
        setIsSubmitting(false);
    }
  }

  // Handle weight change with validation
  const handleWeightChange = (key: keyof AnalysisWeights, value: number) => {
    const currentValue = weights[key];
    const difference = value - currentValue;

    // Check if we can make this change
    if (totalWeight + difference > MAX_TOTAL_WEIGHT) {
      // Cap the value to what's remaining
      const maxAllowed = currentValue + remainingPoints;
      value = Math.min(value, maxAllowed);
    }

    setWeights(prev => ({ ...prev, [key]: value }));
  };

  // Reset weights to default
  const resetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
  };

  // AI Analysis handler
  const handleAnalysis = async () => {
    const isComplete = predictions.every(p => p !== null);
    if (!isComplete) {
      toast({
        variant: "destructive",
        title: "Incomplete Grid",
        description: "Please fill all 6 positions before requesting analysis."
      });
      return;
    }

    setIsAnalysing(true);
    setShowAnalysis(true);
    setAnalysisText('');

    try {
      const response = await fetch('/api/ai/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raceId: raceName.replace(/\s+/g, '-'),
          raceName,
          circuit: circuitName || raceName,
          predictions: predictions.map((driver, idx) => ({
            position: idx + 1,
            driverCode: driver?.name.substring(0, 3).toUpperCase() || '',
            driverName: driver?.name || '',
            team: driver?.team || '',
          })),
          weights,
          totalWeight,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAnalysisText(data.analysis);
        addChangeToHistory('🔮 AI Analysis generated', true);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      setAnalysisText('Unable to generate analysis at this time. Please try again later.');
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: err.message || "Could not generate analysis"
      });
    } finally {
      setIsAnalysing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-xl">{raceName}</CardTitle>
          <CardDescription className="text-base">
            Prediction for <span className="font-semibold text-accent">{teamName}</span>
            {isLocked ? " - Grid locked" : " - Select drivers from the list to fill your grid"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* F1-style staggered grid: 2 lanes x 3 rows */}
          <div className="flex flex-col gap-2 max-w-md mx-auto">
            {[0, 1, 2].map((row) => (
              <div key={row} className="grid grid-cols-2 gap-4">
                {[0, 1].map((col) => {
                  const index = row * 2 + col;
                  const driver = predictions[index];
                  const isRightLane = col === 1;
                  return (
                    <div
                      key={index}
                      className={cn(
                        "relative group flex flex-col items-center gap-2 p-3 rounded-lg border-2 border-dashed bg-card-foreground/5 transition-colors",
                        isRightLane && "mt-6" // Stagger right lane back
                      )}
                    >
                      <div className="absolute top-1 left-2 font-bold text-muted-foreground text-sm">P{index + 1}</div>
                      {!isLocked && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'up')} disabled={index === 0}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'down')} disabled={index === 5}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {driver ? (
                        <>
                          {!isLocked && (
                            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveDriver(index)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                          <Avatar className="w-16 h-16 border-4 border-primary">
                            <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait"/>
                            <AvatarFallback>{driver.name.substring(0, 2)}</AvatarFallback>
                          </Avatar>
                          <div className="text-center">
                            <p className="font-bold text-sm">{driver.name}</p>
                            <p className="text-xs text-muted-foreground">{driver.team}</p>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-6">
                          <p className="text-xs">Select driver</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full">
                <Button onClick={handleSubmit} disabled={isLocked || isSubmitting}>
                    <Check className="mr-2 h-4 w-4"/>
                    {isSubmitting ? "Submitting..." : (applyToAll && hasMultipleTeams ? "Submit to All Teams" : "Submit Predictions")}
                </Button>
                {hasMultipleTeams && !isLocked && (
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="applyToAll"
                            checked={applyToAll}
                            onCheckedChange={(checked) => setApplyToAll(checked === true)}
                        />
                        <Label htmlFor="applyToAll" className="text-sm cursor-pointer">
                            Apply to all teams ({allTeamNames.length})
                        </Label>
                    </div>
                )}
                <Badge
                  variant={isLocked ? "destructive" : "default"}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-sm",
                    !isLocked && "bg-green-600 hover:bg-green-700"
                  )}
                >
                  <Timer className="h-4 w-4" />
                  {isLocked ? (
                    <span>PIT CLOSED</span>
                  ) : (
                    <span>PIT OPEN - {countdown}</span>
                  )}
                </Badge>
            </div>
            {!isLocked && (
                <p className="text-xs text-muted-foreground">
                    Your prediction will stand until you edit it. You can change your picks anytime before the pit closes.
                </p>
            )}
        </CardFooter>
      </Card>
      
      <div className="space-y-6">
        <Card className={cn(isLocked && "hidden")}>
            <CardHeader>
                <CardTitle>Available Drivers</CardTitle>
                <CardDescription>Click a driver to add them to your grid. Looking for someone? Scroll down.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-72">
                    <div className="grid grid-cols-2 gap-2 pr-4">
                    {availableDrivers.map(driver => (
                        <Button key={driver.id} variant="secondary" className="h-auto p-2 flex items-center gap-2 justify-start" onClick={() => handleAddDriver(driver)}>
                            <Avatar className="w-8 h-8">
                                <AvatarImage src={getDriverImage(driver.id)} data-ai-hint="driver portrait" />
                                <AvatarFallback>{driver.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{driver.name}</span>
                        </Button>
                    ))}
                    </div>
                    <ScrollBar className="bg-muted" />
                </ScrollArea>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ListCollapse className="h-5 w-5"/>
                    Change Log
                </CardTitle>
                <CardDescription>Your recent prediction changes.</CardDescription>
            </CardHeader>
            <CardContent>
                {history.length > 0 ? (
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        {history.map((change, index) => (
                            <li key={index} className={cn("transition-opacity", index > 0 && "opacity-70", index > 2 && "opacity-50")}>{change}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">No changes made in this session yet.</p>
                )}
            </CardContent>
        </Card>

        {/* AI Analysis Card */}
        <Card className="border-purple-500/30 bg-gradient-to-br from-purple-950/20 to-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-300">
              <Sparkles className="h-5 w-5" />
              AI Race Analysis
            </CardTitle>
            <CardDescription>Get AI-powered insights on your prediction</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Analysis Button */}
            <Button
              onClick={handleAnalysis}
              disabled={isAnalysing || predictions.some(p => p === null)}
              className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500"
            >
              {isAnalysing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analysing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Analysis
                </>
              )}
            </Button>

            {/* Weights Panel Toggle */}
            <Collapsible open={showWeightsPanel} onOpenChange={setShowWeightsPanel}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <Settings2 className="mr-2 h-4 w-4" />
                  {showWeightsPanel ? 'Hide' : 'Show'} Analysis Weights
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-4">
                {/* Weight Budget */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Weight Budget:</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-bold",
                      remainingPoints < 0 ? "text-destructive" :
                      remainingPoints === 0 ? "text-green-500" : "text-foreground"
                    )}>
                      {totalWeight}/{MAX_TOTAL_WEIGHT}
                    </span>
                    <Button variant="ghost" size="sm" onClick={resetWeights}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Weight Sliders */}
                <div className="grid gap-3">
                  {ANALYSIS_FACETS.map(facet => {
                    const value = weights[facet.key as keyof AnalysisWeights];
                    return (
                      <div key={facet.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2 text-xs">
                            <span>{facet.icon}</span>
                            <span>{facet.label}</span>
                          </Label>
                          <span className={cn(
                            "text-xs font-mono",
                            value === 0 ? "text-muted-foreground" :
                            value >= 8 ? "text-purple-400" : "text-foreground"
                          )}>
                            {value}/10
                          </span>
                        </div>
                        <Slider
                          value={[value]}
                          onValueChange={([v]) => handleWeightChange(facet.key as keyof AnalysisWeights, v)}
                          max={10}
                          step={1}
                          className="cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Analysis Result */}
            {showAnalysis && (
              <div className="p-4 rounded-lg bg-muted/30 border border-purple-500/20">
                {isAnalysing ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                    <p className="text-sm text-muted-foreground">Analysing your prediction...</p>
                  </div>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {analysisText}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
