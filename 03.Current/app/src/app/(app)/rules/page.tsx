import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, UserPlus, Trophy, Repeat } from "lucide-react";

const rules = [
    {
        icon: Check,
        title: "The Objective",
        description: "Predict the top 6 finishing drivers for each race (Sprint and Grand Prix).",
    },
    {
        icon: Check,
        title: "Prediction Deadline",
        description: "All predictions must be submitted before the official start of the weekend's first qualifying session. A countdown timer is available on the dashboard. Once qualifying begins, predictions are locked.",
    },
    {
        icon: Repeat,
        title: "Default Predictions",
        description: "If you do not submit a new prediction for a race, your prediction from the previous race will be used automatically. Your grid will only be empty for your very first race.",
    },
    {
        icon: Check,
        title: "Validation",
        description: "You must select exactly 6 unique drivers. A driver cannot be selected for more than one position.",
    },
     {
        icon: UserPlus,
        title: "Late Joiners",
        description: "Any team who joins after the season starts will begin in last place, 5 points behind the current last-place team.",
    }
];

const scoring = [
    {
        points: "+5",
        description: "For each driver you correctly predict in their exact finishing position.",
    },
    {
        points: "+3",
        description: "For each driver you correctly predict who finishes in the top 6, but in a different position than you predicted.",
    },
    {
        points: "+10",
        description: "BONUS points if you correctly predict all 6 drivers who finish in the top 6, regardless of their position.",
    },
];


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
                    {rules.map(rule => (
                        <li key={rule.title} className="flex items-start gap-4">
                            <rule.icon className="h-5 w-5 mt-1 text-primary flex-shrink-0" />
                            <div>
                                <h3 className="font-semibold">{rule.title}</h3>
                                <p className="text-sm text-muted-foreground">{rule.description}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Scoring System</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                 <ul className="space-y-3">
                    {scoring.map(item => (
                        <li key={item.points} className="flex items-start gap-4">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold flex-shrink-0 mt-1">{item.points}</span>
                            <div>
                                <h3 className="font-semibold">Points</h3>
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
                    <h3 className="font-semibold">End of Season Tie</h3>
                    <p className="text-sm text-muted-foreground">In the event of a tie in the final standings, the winner will be the team principal who has correctly predicted the most 1st, 2nd, and 3rd place finishes throughout the season, including quali sessions.</p>
                </div>
            </CardContent>
        </Card>
    </div>
  );
}
