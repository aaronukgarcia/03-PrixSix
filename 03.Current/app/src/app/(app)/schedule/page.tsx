import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Flag, Zap, Lock, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RaceSchedule, findNextRace } from "@/lib/data";

function formatDateTime(isoString: string) {
  const date = new Date(isoString);
  return {
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    dayOfWeek: date.toLocaleDateString('en-GB', { weekday: 'short' }),
  };
}

function getGridOpenTime(raceTime: string) {
  const raceDate = new Date(raceTime);
  // Grid opens 2 hours after race finishes (assuming ~2hr race = 4hrs after race start)
  const gridOpenDate = new Date(raceDate.getTime() + 4 * 60 * 60 * 1000);
  return gridOpenDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function SchedulePage() {
  const sprintCount = RaceSchedule.filter(r => r.hasSprint).length;
  const nextRace = findNextRace();
  const now = new Date();

  return (
    <div className="grid gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">2026 Race Schedule</h1>
        <p className="text-muted-foreground">
          {RaceSchedule.length} races · {sprintCount} sprint weekends
        </p>
      </div>

      <Card className="border-primary/50 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-destructive" />
            Pit Lane Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p><strong>Grid Locks:</strong> When qualifying starts (predictions are locked for the weekend)</p>
          <p><strong>Grid Opens:</strong> 2 hours after the race finishes</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Full Calendar
          </CardTitle>
          <CardDescription>
            All Grand Prix and Sprint events with qualifying cutoff times
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {RaceSchedule.map((race, index) => {
              const quali = formatDateTime(race.qualifyingTime);
              const raceInfo = formatDateTime(race.raceTime);
              const gridOpen = getGridOpenTime(race.raceTime);
              const isNextRace = race.name === nextRace.name;
              const isPast = new Date(race.raceTime) < now;

              return (
                <div
                  key={race.name}
                  className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b last:border-0 ${
                    isNextRace ? 'bg-primary/10 -mx-4 px-4 rounded-lg border-primary/30' : ''
                  } ${isPast ? 'opacity-50' : ''}`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${
                    isNextRace ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}>
                    {index + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium">{race.name}</h3>
                      {race.hasSprint && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          Sprint
                        </Badge>
                      )}
                      {isNextRace && (
                        <Badge variant="default" className="flex items-center gap-1">
                          <Flag className="h-3 w-3" />
                          Next Race
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{race.location}</p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3 text-destructive flex-shrink-0" />
                      <span className="text-muted-foreground">
                        {quali.dayOfWeek} {quali.date} · <span className="font-medium text-foreground">{quali.time}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Flag className="h-3 w-3 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">
                        {raceInfo.dayOfWeek} {raceInfo.date} · <span className="font-medium text-foreground">{raceInfo.time}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Unlock className="h-3 w-3 text-green-500 flex-shrink-0" />
                      <span className="font-medium text-green-600">{gridOpen}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Legend</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-destructive" />
            <span>Quali Start (Grid Locks)</span>
          </div>
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-primary" />
            <span>Race Start</span>
          </div>
          <div className="flex items-center gap-2">
            <Unlock className="h-4 w-4 text-green-500" />
            <span>Grid Opens</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span>Sprint Weekend</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
