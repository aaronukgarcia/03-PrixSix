
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Target, Award, ArrowRight } from "lucide-react";
import { SCORING_POINTS, SCORING_DERIVED } from "@/lib/scoring-rules";

export function ScoringManager() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Wacky Racers Scoring
                </CardTitle>
                <CardDescription>Fixed scoring rules for the season. Points are awarded based on how close your prediction is to the actual finishing position.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid gap-4">
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <Target className="h-5 w-5 text-green-500" />
                            <div>
                                <p className="font-medium">Exact Position</p>
                                <p className="text-sm text-muted-foreground">Predicted driver finishes in the exact position</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{SCORING_POINTS.exactPosition}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <ArrowRight className="h-5 w-5 text-blue-500" />
                            <div>
                                <p className="font-medium">1 Position Off</p>
                                <p className="text-sm text-muted-foreground">Predicted driver finishes 1 position away</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{SCORING_POINTS.onePositionOff}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <ArrowRight className="h-5 w-5 text-yellow-500" />
                            <div>
                                <p className="font-medium">2 Positions Off</p>
                                <p className="text-sm text-muted-foreground">Predicted driver finishes 2 positions away</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{SCORING_POINTS.twoPositionsOff}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <ArrowRight className="h-5 w-5 text-orange-500" />
                            <div>
                                <p className="font-medium">3+ Positions Off</p>
                                <p className="text-sm text-muted-foreground">Predicted driver finishes 3 or more positions away (but still in Top 6)</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{SCORING_POINTS.threeOrMoreOff}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <Award className="h-5 w-5 text-red-500" />
                            <div>
                                <p className="font-medium">Not in Top 6</p>
                                <p className="text-sm text-muted-foreground">Predicted driver does not finish in the Top 6</p>
                            </div>
                        </div>
                        <Badge variant="outline" className="text-lg px-3 py-1">0</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card border-primary/50">
                        <div className="flex items-center gap-3">
                            <Trophy className="h-5 w-5 text-yellow-500" />
                            <div>
                                <p className="font-medium">Perfect 6 Bonus</p>
                                <p className="text-sm text-muted-foreground">All 6 predicted drivers finish in the Top 6 (any position)</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{SCORING_POINTS.bonusAll6}</Badge>
                    </div>
                </div>

                <div className="p-4 rounded-lg bg-muted">
                    <p className="text-sm font-medium">Maximum Possible Score: <span className="text-primary">{SCORING_DERIVED.maxPointsPerRace} points</span></p>
                    <p className="text-xs text-muted-foreground mt-1">6 exact positions ({SCORING_POINTS.exactPosition} × 6 = {SCORING_POINTS.exactPosition * 6} pts) + perfect bonus ({SCORING_POINTS.bonusAll6} pts) = {SCORING_DERIVED.maxPointsPerRace} pts</p>
                </div>
            </CardContent>
        </Card>
    );
}
