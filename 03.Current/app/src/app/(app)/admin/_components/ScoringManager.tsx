
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Target, Award } from "lucide-react";

// Wacky Racers scoring rules are fixed - no admin configuration needed
const WACKY_RACERS_RULES = {
    perCorrectDriver: 1,
    bonus5Correct: 3,
    bonus6Correct: 5,
    maxPossible: 11,
};

export function ScoringManager() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Wacky Racers Scoring
                </CardTitle>
                <CardDescription>Fixed scoring rules for the season. Position does not matter - only whether the driver finishes in the Top 6.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid gap-4">
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <Target className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <p className="font-medium">Per Correct Driver</p>
                                <p className="text-sm text-muted-foreground">Each predicted driver appearing anywhere in Top 6</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{WACKY_RACERS_RULES.perCorrectDriver}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <Award className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <p className="font-medium">5 of 6 Bonus</p>
                                <p className="text-sm text-muted-foreground">Bonus if exactly 5 predictions are correct</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{WACKY_RACERS_RULES.bonus5Correct}</Badge>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                            <Trophy className="h-5 w-5 text-yellow-500" />
                            <div>
                                <p className="font-medium">Perfect 6 Bonus</p>
                                <p className="text-sm text-muted-foreground">Bonus if all 6 predictions are correct</p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-lg px-3 py-1">+{WACKY_RACERS_RULES.bonus6Correct}</Badge>
                    </div>
                </div>

                <div className="p-4 rounded-lg bg-muted">
                    <p className="text-sm font-medium">Maximum Possible Score: <span className="text-primary">{WACKY_RACERS_RULES.maxPossible} points</span></p>
                    <p className="text-xs text-muted-foreground mt-1">6 correct drivers (6 pts) + perfect bonus (5 pts) = 11 pts</p>
                </div>
            </CardContent>
        </Card>
    );
}
