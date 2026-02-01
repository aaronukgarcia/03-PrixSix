
// GUID: COMPONENT_PREDICTION_EDITOR-000-v03
// [Intent] PredictionEditor component: the core prediction interface where users select, reorder, and submit their top-6 driver predictions for a race. Also provides AI-powered analysis with configurable weights, countdown timer, apply-to-all-teams option, and a change log.
// [Inbound Trigger] Rendered by the predictions page when a race is selected and the user has an active team.
// [Downstream Impact] Submits predictions via POST /api/submit-prediction; requests AI analysis via POST /api/ai/analysis; persists AI weights to Firestore users collection. Changes here affect the entire prediction submission flow.

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Driver } from "@/lib/data";
import { Check, ListCollapse, Timer, Sparkles, Settings2, RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth, useFirestore } from "@/firebase";
import type { AnalysisWeights } from "@/firebase/provider";

import { doc, updateDoc } from "firebase/firestore";
import { Badge } from "@/components/ui/badge";
import { generateClientCorrelationId, ERROR_CODES } from "@/lib/error-codes";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DndPredictionWrapper } from "./DndPredictionWrapper";
import { DroppableGridSlot } from "./DroppableGridSlot";
import { DroppablePoolZone } from "./DroppablePoolZone";

// GUID: COMPONENT_PREDICTION_EDITOR-001-v03
// [Intent] Configuration array defining the 11 AI analysis facets (9 data-driven + 2 personality-driven). Each facet has a key matching AnalysisWeights, a display label, icon emoji, and description.
// [Inbound Trigger] Iterated in the weights panel UI to render sliders for each facet.
// [Downstream Impact] Keys must match AnalysisWeights type and DEFAULT_WEIGHTS object. Adding/removing facets requires updating both.
const ANALYSIS_FACETS = [
  { key: 'driverForm', label: 'Driver Form', icon: '📈', description: 'Recent performance over last 3-4 races' },
  { key: 'trackHistory', label: 'Track Changes', icon: '🔄', description: 'Circuit evolution, resurfacing, layout mods' },
  { key: 'overtakingCrashes', label: 'Overtakes & Incidents', icon: '⚔️', description: 'Historical overtaking moves and crashes' },
  { key: 'circuitCharacteristics', label: 'Circuit Layout', icon: '🛣️', description: 'Track features, corners, straights' },
  { key: 'trackSurface', label: 'Track Surface', icon: '🏁', description: 'Grip levels, resurfacing, bumps' },
  { key: 'layoutChanges', label: 'Historical Results', icon: '🏆', description: 'Past driver performance at this circuit' },
  { key: 'weather', label: 'Weather', icon: '🌡️', description: 'Temperature, humidity, rain probability' },
  { key: 'tyreStrategy', label: 'Tyre Strategy', icon: '⚫', description: 'Compound choices, degradation, pit windows' },
  { key: 'bettingOdds', label: 'Betting Odds', icon: '💰', description: 'Current bookmaker predictions' },
  { key: 'jackSparrow', label: 'Jack Sparrow', icon: '🏴‍☠️', description: 'Cheeky British wit, playful teasing' },
  { key: 'rowanHornblower', label: 'Rowan Hornblower', icon: '📊', description: 'Measured strategist, professional insight' },
] as const;

// GUID: COMPONENT_PREDICTION_EDITOR-002-v03
// [Intent] Default weight values for each AI analysis facet. Data facets default to 7, personality facets to 5.
// [Inbound Trigger] Used as initial state for weights; also used by resetWeights to restore defaults.
// [Downstream Impact] Sent to /api/ai/analysis endpoint; changing values alters the default AI analysis emphasis.
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
  jackSparrow: 5,
  rowanHornblower: 5,
};

// GUID: COMPONENT_PREDICTION_EDITOR-003-v03
// [Intent] Maximum total weight budget (11 facets x 7 = 77). Enforces a constraint so users must trade off emphasis between facets.
// [Inbound Trigger] Referenced by handleWeightChange validation and the weight budget display.
// [Downstream Impact] If increased, users can set all facets to higher values, reducing the trade-off mechanic.
const MAX_TOTAL_WEIGHT = 77; // 11 facets × 7 default weight

// GUID: COMPONENT_PREDICTION_EDITOR-004-v03
// [Intent] Props interface for PredictionEditor. Receives driver list, lock state, initial predictions, race metadata, team info, and circuit name.
// [Inbound Trigger] Defined at module level; consumed when PredictionEditor is instantiated by the predictions page.
// [Downstream Impact] allDrivers populates the available drivers list; isLocked disables all editing; qualifyingTime drives the countdown timer; allTeamNames enables the "Apply to All" feature.
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

// GUID: COMPONENT_PREDICTION_EDITOR-005-v03
// [Intent] Main PredictionEditor component. Manages prediction grid state, countdown timer, submission flow, AI analysis, and change history.
// [Inbound Trigger] Rendered by the predictions page with race-specific props.
// [Downstream Impact] Submits to /api/submit-prediction for each team; calls /api/ai/analysis for AI insights; persists weights to Firestore. Displays toast notifications for success/failure.
export function PredictionEditor({ allDrivers, isLocked, initialPredictions, raceName, teamName, qualifyingTime, allTeamNames = [], circuitName }: PredictionEditorProps) {
  const { user, firebaseUser } = useAuth();
  const firestore = useFirestore();
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

  // GUID: COMPONENT_PREDICTION_EDITOR-006-v03
  // [Intent] Load user's saved AI analysis weights from Firestore on mount. Overrides DEFAULT_WEIGHTS if the user has previously customised and saved their preferences.
  // [Inbound Trigger] Fires when user.aiAnalysisWeights changes (typically once after auth resolves).
  // [Downstream Impact] Sets the weights state which controls AI analysis facet emphasis and slider positions.
  useEffect(() => {
    if (user?.aiAnalysisWeights) {
      setWeights(user.aiAnalysisWeights);
    }
  }, [user?.aiAnalysisWeights]);

  // GUID: COMPONENT_PREDICTION_EDITOR-007-v03
  // [Intent] Memoised calculation of the sum of all current weight values, used for budget enforcement and display.
  // [Inbound Trigger] Re-computed whenever the weights object changes.
  // [Downstream Impact] Used by handleWeightChange to cap slider values and by the UI to display remaining budget.
  const totalWeight = useMemo(() => {
    return Object.values(weights).reduce((sum, w) => sum + w, 0);
  }, [weights]);

  const remainingPoints = MAX_TOTAL_WEIGHT - totalWeight;

  // Only show "Apply to All" if user has multiple teams
  const hasMultipleTeams = allTeamNames.length > 1;

  // GUID: COMPONENT_PREDICTION_EDITOR-008-v03
  // [Intent] Countdown timer that updates every second, showing time remaining until qualifying (the prediction deadline). Displays days/hours/minutes/seconds format and shows "CLOSED" when past.
  // [Inbound Trigger] Fires on mount and whenever qualifyingTime prop changes; runs a 1-second interval.
  // [Downstream Impact] Updates countdown display string in the footer badge. Does not control the isLocked prop (that comes from the parent).
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

  // GUID: COMPONENT_PREDICTION_EDITOR-009-v03
  // [Intent] Computed list of drivers not yet selected in the prediction grid, sorted alphabetically. Powers the "Available Drivers" panel.
  // [Inbound Trigger] Re-computed on every render when predictions or allDrivers change.
  // [Downstream Impact] Displayed in the available drivers scroll area; clicking a driver calls handleAddDriver.
  const availableDrivers = allDrivers
    .filter((d) => !predictions.some((p) => p?.id === d.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // GUID: COMPONENT_PREDICTION_EDITOR-010-v03
  // [Intent] Appends a change description to the history log (max 5 entries). Optionally includes a timestamp for significant actions like submissions.
  // [Inbound Trigger] Called by handleAddDriver, handleRemoveDriver, handleMove, handleSubmit, and handleAnalysis.
  // [Downstream Impact] Updates the Change Log card display; older entries fade via CSS opacity classes.
  const addChangeToHistory = (change: string, includeTimestamp = false) => {
    const timestamp = includeTimestamp ? ` [${new Date().toLocaleString()}]` : "";
    setHistory(prev => [change + timestamp, ...prev].slice(0, 5));
  }

  // GUID: COMPONENT_PREDICTION_EDITOR-011-v03
  // [Intent] Adds a driver to the first empty slot in the prediction grid. No-op if the grid is locked.
  // [Inbound Trigger] User clicks a driver button in the Available Drivers panel.
  // [Downstream Impact] Updates predictions state; logs the addition to the change history.
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

  // GUID: COMPONENT_PREDICTION_EDITOR-012-v03
  // [Intent] Removes a driver from a specific position in the prediction grid, setting that slot to null. No-op if the grid is locked.
  // [Inbound Trigger] User clicks the X button on a filled grid slot.
  // [Downstream Impact] Updates predictions state; logs the removal to the change history; the removed driver reappears in the Available Drivers panel.
  const handleRemoveDriver = (index: number) => {
    if (isLocked) return;
    const driverName = predictions[index]?.name;
    const newPredictions = [...predictions];
    newPredictions[index] = null;
    setPredictions(newPredictions);
    if(driverName) addChangeToHistory(`- ${driverName} from grid`);
  };

  // GUID: COMPONENT_PREDICTION_EDITOR-013-v03
  // [Intent] Swaps a driver with the adjacent slot (up or down) to reorder predictions. No-op if locked or at grid boundary.
  // [Inbound Trigger] User clicks the up/down arrow buttons on a grid slot.
  // [Downstream Impact] Updates predictions state; logs the swap to the change history.
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

  // Drag-and-drop handlers
  const handleDropToSlot = useCallback((driverId: string, slotIndex: number) => {
    if (isLocked) return;
    const driver = allDrivers.find((d) => d.id === driverId);
    if (!driver) return;
    const newPredictions = [...predictions];
    const displaced = newPredictions[slotIndex];
    newPredictions[slotIndex] = driver;
    setPredictions(newPredictions);
    if (displaced) {
      addChangeToHistory(`+ ${driver.name} to P${slotIndex + 1}, ${displaced.name} back to pool`);
    } else {
      addChangeToHistory(`+ ${driver.name} to P${slotIndex + 1}`);
    }
  }, [isLocked, allDrivers, predictions]);

  const handleSwapSlots = useCallback((fromIndex: number, toIndex: number) => {
    if (isLocked) return;
    const newPredictions = [...predictions];
    [newPredictions[fromIndex], newPredictions[toIndex]] = [
      newPredictions[toIndex],
      newPredictions[fromIndex],
    ];
    setPredictions(newPredictions);
    const driver1 = newPredictions[fromIndex]?.name;
    const driver2 = newPredictions[toIndex]?.name;
    if (driver1 && driver2) addChangeToHistory(`↔️ Swapped ${driver1} / ${driver2}`);
  }, [isLocked, predictions]);

  const handleRemoveFromGrid = useCallback((slotIndex: number) => {
    if (isLocked) return;
    const driverName = predictions[slotIndex]?.name;
    const newPredictions = [...predictions];
    newPredictions[slotIndex] = null;
    setPredictions(newPredictions);
    if (driverName) addChangeToHistory(`- ${driverName} from grid`);
  }, [isLocked, predictions]);

  // GUID: COMPONENT_PREDICTION_EDITOR-014-v03
  // [Intent] Submits the prediction to the server via /api/submit-prediction. Supports multi-team submission when "Apply to All" is checked. Validates grid completeness and user authentication before sending.
  // [Inbound Trigger] User clicks the "Submit Predictions" or "Submit to All Teams" button.
  // [Downstream Impact] POST to /api/submit-prediction for each team; on success shows a toast and logs to change history; on failure shows a destructive toast with error details.
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

  // GUID: COMPONENT_PREDICTION_EDITOR-015-v03
  // [Intent] Handles weight slider changes with budget enforcement. Caps the new value if it would exceed MAX_TOTAL_WEIGHT.
  // [Inbound Trigger] User drags an analysis weight slider.
  // [Downstream Impact] Updates the weights state; reflected in totalWeight memo and the weight budget display.
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

  // GUID: COMPONENT_PREDICTION_EDITOR-016-v03
  // [Intent] Resets all analysis weights back to DEFAULT_WEIGHTS values.
  // [Inbound Trigger] User clicks the reset button in the weights panel.
  // [Downstream Impact] Restores default slider positions and budget; does not persist to Firestore until next analysis request.
  const resetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
  };

  // GUID: COMPONENT_PREDICTION_EDITOR-017-v03
  // [Intent] Persists the current AI analysis weights to the user's Firestore document. Fire-and-forget: failure is logged but not shown to the user.
  // [Inbound Trigger] Called by handleAnalysis before requesting AI analysis.
  // [Downstream Impact] Updates the aiAnalysisWeights field in the Firestore users/{userId} document. On next page load, these weights will be restored via the load useEffect.
  const saveWeights = async () => {
    if (!firestore || !user) return;
    try {
      const userDocRef = doc(firestore, 'users', user.id);
      await updateDoc(userDocRef, { aiAnalysisWeights: weights });
    } catch (err) {
      console.error('Failed to save AI weights:', err);
      // Non-critical, don't show error to user
    }
  };

  // GUID: COMPONENT_PREDICTION_EDITOR-018-v03
  // [Intent] Requests AI-powered race analysis from /api/ai/analysis with the current predictions and weights. Validates grid completeness first. Handles errors with correlation IDs and user-copyable error toasts per Golden Rule #1.
  // [Inbound Trigger] User clicks the "Generate Analysis" button.
  // [Downstream Impact] Displays analysis text in the full-width result card; saves weights to Firestore; logs to change history. On error, shows a destructive toast with selectable correlation ID.
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

    // Save weights to user preferences (fire-and-forget)
    saveWeights();

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
        // Use error info from API response, or generate client-side fallback
        const errorCode = data.errorCode || ERROR_CODES.AI_GENERATION_FAILED.code;
        const correlationId = data.correlationId || generateClientCorrelationId();
        throw { message: data.error || 'Analysis failed', errorCode, correlationId };
      }
    } catch (err: any) {
      console.error('Analysis error:', err);
      setAnalysisText('Unable to generate analysis at this time. Please try again later.');

      // Use error info from thrown object or generate client-side
      const errorCode = err.errorCode || ERROR_CODES.AI_GENERATION_FAILED.code;
      const correlationId = err.correlationId || generateClientCorrelationId();

      toast({
        variant: "destructive",
        title: `Error ${errorCode}`,
        description: (
          <div className="space-y-2">
            <p>{err.message || "Could not generate analysis"}</p>
            <p className="text-xs font-mono bg-destructive-foreground/10 p-1 rounded select-all cursor-text">
              ID: {correlationId}
            </p>
          </div>
        ),
        duration: 15000,
      });
    } finally {
      setIsAnalysing(false);
    }
  };

  // GUID: COMPONENT_PREDICTION_EDITOR-019-v03
  // [Intent] Main render: two-column layout with prediction grid card (left/top) and sidebar (right/bottom) containing available drivers, change log, and AI analysis panel. Full-width AI result card spans below both columns when analysis is active.
  // [Inbound Trigger] Component render cycle; re-renders on state changes to predictions, countdown, weights, analysis, etc.
  // [Downstream Impact] Renders interactive grid slots, available drivers list, submission controls, countdown badge, AI analysis card, and analysis result. All user interactions feed back into the state handlers above.
  return (
    <DndPredictionWrapper
      predictions={predictions}
      availableDrivers={availableDrivers}
      onDropToSlot={handleDropToSlot}
      onSwapSlots={handleSwapSlots}
      onRemoveFromGrid={handleRemoveFromGrid}
    >
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
                  return (
                    <DroppableGridSlot
                      key={index}
                      index={index}
                      driver={predictions[index]}
                      isLocked={isLocked}
                      isRightLane={col === 1}
                      onMove={handleMove}
                      onRemove={handleRemoveDriver}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
        {!isLocked && (
          <div className="px-6 pb-2">
            <p className="text-xs text-muted-foreground italic">
              Tip: drag a driver from the grid back to the pool to free up a slot
            </p>
          </div>
        )}
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
                <CardDescription>Click or drag a driver to add them to your grid. Looking for someone? Scroll down.</CardDescription>
            </CardHeader>
            <CardContent>
                <DroppablePoolZone
                  availableDrivers={availableDrivers}
                  isLocked={isLocked}
                  onAddDriver={handleAddDriver}
                />
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

          </CardContent>
        </Card>
      </div>

      {/* Full-width AI Analysis Result - shown below the grid */}
      {showAnalysis && (
        <Card className="lg:col-span-3 border-purple-500/30 bg-gradient-to-br from-purple-950/20 to-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-300">
              <Sparkles className="h-5 w-5" />
              Analysis Result
            </CardTitle>
            <CardDescription>
              AI-powered insights for {raceName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isAnalysing ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-purple-400" />
                <p className="text-muted-foreground">Analysing your prediction...</p>
              </div>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {analysisText}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </DndPredictionWrapper>
  );
}
