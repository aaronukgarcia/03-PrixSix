// GUID: PAGE_RULES-000-v03
// [Intent] Rules page — displays the league gameplay rules, scoring system, and tie-breaker rule
//   in a static, read-only format. All content is sourced from lib/scoring-rules constants.
// [Inbound Trigger] User navigates to /rules in the app layout.
// [Downstream Impact] Reads from SCORING_RULES, GAMEPLAY_RULES, and TIEBREAKER_RULE in lib/scoring-rules.
//   Purely presentational — no Firestore interaction. Changes to scoring-rules constants will
//   automatically reflect on this page.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, UserPlus, Trophy, Repeat } from "lucide-react";
import { SCORING_RULES, GAMEPLAY_RULES, TIEBREAKER_RULE } from "@/lib/scoring-rules";

// GUID: PAGE_RULES-001-v03
// [Intent] Maps gameplay rule titles to Lucide icon components for visual differentiation in the rules list.
// [Inbound Trigger] Referenced during GAMEPLAY_RULES rendering loop to select the icon per rule.
// [Downstream Impact] Adding new gameplay rules with unrecognised titles will fall back to the Check icon.
const ruleIcons = {
  'The Objective': Check,
  'Prediction Deadline': Check,
  'Default Predictions': Repeat,
  'Validation': Check,
  'Late Joiners': UserPlus,
} as const;

// GUID: PAGE_RULES-002-v03
// [Intent] Main page component that renders three cards: Gameplay Rules, Scoring System, and Tie-Breaker,
//   each populated from the corresponding lib/scoring-rules constant.
// [Inbound Trigger] Rendered by Next.js router when user visits /rules.
// [Downstream Impact] Consumes GAMEPLAY_RULES, SCORING_RULES, TIEBREAKER_RULE from lib/scoring-rules.
//   No state, hooks, or Firestore dependencies — this is a purely static presentation page.
export default function RulesPage() {
  return (
    <div className="grid gap-6">
        <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">League Rules & Scoring</h1>
            <p className="text-muted-foreground">Everything you need to know to become the champion.</p>
        </div>

        <Card>
            <CardHeader>
                <CardTitle>Gameplay Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <ul className="space-y-3">
                    {GAMEPLAY_RULES.map(rule => {
                        const Icon = ruleIcons[rule.title as keyof typeof ruleIcons] || Check;
                        return (
                            <li key={rule.title} className="flex items-start gap-4">
                                <Icon className="h-5 w-5 mt-1 text-primary flex-shrink-0" />
                                <div>
                                    <h3 className="font-semibold">{rule.title}</h3>
                                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Scoring System</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                 <ul className="space-y-3">
                    {SCORING_RULES.map(item => (
                        <li key={item.pointsDisplay} className="flex items-start gap-4">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold flex-shrink-0 mt-1">{item.pointsDisplay}</span>
                            <div>
                                <h3 className="font-semibold">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Tie-Breaker</CardTitle>
            </CardHeader>
            <CardContent className="flex items-start gap-4">
                <Trophy className="h-5 w-5 mt-1 text-accent flex-shrink-0" />
                <div>
                    <h3 className="font-semibold">{TIEBREAKER_RULE.title}</h3>
                    <p className="text-sm text-muted-foreground">{TIEBREAKER_RULE.description}</p>
                </div>
            </CardContent>
        </Card>
    </div>
  );
}
