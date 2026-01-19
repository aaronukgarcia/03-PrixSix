"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Flag, Zap, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RaceSchedule, findNextRace } from "@/lib/data";

function formatLocalDateTime(isoString: string) {
  const date = new Date(isoString);
  return {
    fullDate: date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
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
          {RaceSchedule.length} Grand Prix · {sprintCount} Sprint weekends · All times shown in your local timezone
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
          <p><strong>Grid Locks:</strong> When qualifying starts - predictions are locked for the whole weekend</p>
          <p><strong>Grid Opens:</strong> 2 hours after the Grand Prix finishes</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Full Calendar
          </CardTitle>
          <CardDescription>
            Qualifying, Sprint, and Grand Prix times for each weekend
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {RaceSchedule.map((race, index) => {
              const quali = formatLocalDateTime(race.qualifyingTime);
              const sprint = race.sprintTime ? formatLocalDateTime(race.sprintTime) : null;
              const gp = formatLocalDateTime(race.raceTime);
              const isNextRace = race.name === nextRace.name;
              const isPast = new Date(race.raceTime) < now;

              return (
                <div
                  key={race.name}
                  className={`rounded-lg border p-4 ${
                    isNextRace ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''
                  } ${isPast ? 'opacity-50' : ''}`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${
                        isNextRace ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="font-semibold">{race.name}</h3>
                        <p className="text-sm text-muted-foreground">{race.location}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {race.hasSprint && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          Sprint
                        </Badge>
                      )}
                      {isNextRace && (
                        <Badge variant="default">Next Race</Badge>
                      )}
                    </div>
                  </div>

                  {/* Event times grid */}
                  <div className={`grid gap-3 ${race.hasSprint ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                    {/* Qualifying */}
                    <div className="flex items-center gap-3 p-2 rounded bg-muted/50">
                      <Lock className="h-4 w-4 text-destructive flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Qualifying (Grid Locks)</p>
                        <p className="font-medium">{quali.fullDate}</p>
                        <p className="text-lg font-bold">{quali.time}</p>
                      </div>
                    </div>

                    {/* Sprint (only for sprint weekends) */}
                    {race.hasSprint && sprint && (
                      <div className="flex items-center gap-3 p-2 rounded bg-amber-500/10">
                        <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Sprint Race</p>
                          <p className="font-medium">{sprint.fullDate}</p>
                          <p className="text-lg font-bold">{sprint.time}</p>
                        </div>
                      </div>
                    )}

                    {/* Grand Prix */}
                    <div className="flex items-center gap-3 p-2 rounded bg-primary/10">
                      <Flag className="h-4 w-4 text-primary flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Grand Prix</p>
                        <p className="font-medium">{gp.fullDate}</p>
                        <p className="text-lg font-bold">{gp.time}</p>
                      </div>
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
            <span>Qualifying (Grid Locks)</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span>Sprint Race</span>
          </div>
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-primary" />
            <span>Grand Prix</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
