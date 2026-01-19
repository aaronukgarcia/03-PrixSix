import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Flag, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Race {
  round: number;
  name: string;
  country: string;
  dates: string;
  hasSprint?: boolean;
}

const races2026: Race[] = [
  { round: 1, name: "Australian Grand Prix", country: "Australia", dates: "6-8 Mar" },
  { round: 2, name: "Chinese Grand Prix", country: "China", dates: "13-15 Mar", hasSprint: true },
  { round: 3, name: "Japanese Grand Prix", country: "Japan", dates: "27-29 Mar" },
  { round: 4, name: "Bahrain Grand Prix", country: "Bahrain", dates: "10-12 Apr" },
  { round: 5, name: "Saudi Arabian Grand Prix", country: "Saudi Arabia", dates: "17-19 Apr", hasSprint: true },
  { round: 6, name: "Miami Grand Prix", country: "USA", dates: "1-3 May", hasSprint: true },
  { round: 7, name: "Canadian Grand Prix", country: "Canada", dates: "22-24 May" },
  { round: 8, name: "Monaco Grand Prix", country: "Monaco", dates: "5-7 Jun" },
  { round: 9, name: "Barcelona-Catalunya Grand Prix", country: "Spain", dates: "12-14 Jun" },
  { round: 10, name: "Austrian Grand Prix", country: "Austria", dates: "26-28 Jun", hasSprint: true },
  { round: 11, name: "British Grand Prix", country: "Great Britain", dates: "3-5 Jul" },
  { round: 12, name: "Belgian Grand Prix", country: "Belgium", dates: "17-19 Jul", hasSprint: true },
  { round: 13, name: "Hungarian Grand Prix", country: "Hungary", dates: "24-26 Jul" },
  { round: 14, name: "Dutch Grand Prix", country: "Netherlands", dates: "21-23 Aug" },
  { round: 15, name: "Italian Grand Prix", country: "Italy", dates: "4-6 Sep" },
  { round: 16, name: "Spanish Grand Prix", country: "Spain", dates: "11-13 Sep" },
  { round: 17, name: "Azerbaijan Grand Prix", country: "Azerbaijan", dates: "24-26 Sep" },
  { round: 18, name: "Singapore Grand Prix", country: "Singapore", dates: "9-11 Oct" },
  { round: 19, name: "United States Grand Prix", country: "USA", dates: "23-25 Oct", hasSprint: true },
  { round: 20, name: "Mexican Grand Prix", country: "Mexico", dates: "30 Oct-1 Nov" },
  { round: 21, name: "Brazilian Grand Prix", country: "Brazil", dates: "6-8 Nov", hasSprint: true },
  { round: 22, name: "Las Vegas Grand Prix", country: "USA", dates: "19-21 Nov" },
  { round: 23, name: "Qatar Grand Prix", country: "Qatar", dates: "27-29 Nov", hasSprint: true },
  { round: 24, name: "Abu Dhabi Grand Prix", country: "UAE", dates: "4-6 Dec" },
];

export default function SchedulePage() {
  const sprintCount = races2026.filter(r => r.hasSprint).length;

  return (
    <div className="grid gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">2026 Race Schedule</h1>
        <p className="text-muted-foreground">
          {races2026.length} races · {sprintCount} sprint weekends
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Full Calendar
          </CardTitle>
          <CardDescription>
            All Grand Prix and Sprint events for the 2026 season
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {races2026.map((race) => (
              <div
                key={race.round}
                className="flex items-center gap-4 py-3 border-b last:border-0"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-bold flex-shrink-0">
                  {race.round}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{race.name}</h3>
                    {race.hasSprint && (
                      <Badge variant="secondary" className="flex items-center gap-1 flex-shrink-0">
                        <Zap className="h-3 w-3" />
                        Sprint
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{race.country}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium">{race.dates}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
