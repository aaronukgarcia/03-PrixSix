// GUID: ADMIN_STANDING_DATA-000-v03
// [Intent] Read-only admin component displaying standing data: F1 drivers grouped by team and the full race calendar schedule.
// [Inbound Trigger] Rendered within the admin panel when the "Standing Data" tab is selected.
// [Downstream Impact] Purely presentational; does not modify any data. Consumes F1Drivers and RaceSchedule from the static data module.

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, Calendar, MapPin, Flag, Zap } from "lucide-react";
import { F1Drivers, RaceSchedule } from "@/lib/data";

// GUID: ADMIN_STANDING_DATA-001-v03
// [Intent] Groups the flat F1Drivers array into a lookup keyed by team name for team-based rendering.
// [Inbound Trigger] Module initialisation (runs once at import time).
// [Downstream Impact] Used by the StandingDataManager component to render drivers grouped under their team cards.
const driversByTeam = F1Drivers.reduce((acc, driver) => {
  if (!acc[driver.team]) {
    acc[driver.team] = [];
  }
  acc[driver.team].push(driver);
  return acc;
}, {} as Record<string, typeof F1Drivers>);

// GUID: ADMIN_STANDING_DATA-002-v03
// [Intent] Maps F1 constructor names to Tailwind CSS background colour classes for visual team badges.
// [Inbound Trigger] Referenced during render to colour-code team indicator dots.
// [Downstream Impact] If a team name changes in the F1Drivers data, a matching entry must be added here or it falls back to bg-gray-500.
const teamColours: Record<string, string> = {
  'Red Bull Racing': 'bg-blue-600',
  'Ferrari': 'bg-red-600',
  'McLaren': 'bg-orange-500',
  'Mercedes': 'bg-teal-400',
  'Aston Martin': 'bg-green-700',
  'Alpine': 'bg-pink-500',
  'Williams': 'bg-blue-400',
  'Racing Bulls': 'bg-blue-800',
  'Audi': 'bg-zinc-700',
  'Haas F1 Team': 'bg-gray-600',
  'Cadillac F1 Team': 'bg-yellow-500',
};

// GUID: ADMIN_STANDING_DATA-003-v03
// [Intent] Main StandingDataManager component rendering two cards: F1 Drivers by team and the Race Calendar table.
// [Inbound Trigger] Rendered by the admin page when the Standing Data tab is active.
// [Downstream Impact] Purely read-only display. No mutations. Depends on F1Drivers and RaceSchedule static data arrays.
export function StandingDataManager() {
  // GUID: ADMIN_STANDING_DATA-004-v03
  // [Intent] Formats an ISO date string into a human-readable UK-locale date (e.g., "Sat, 15 Mar 2026").
  // [Inbound Trigger] Called for each qualifying and race date in the calendar table.
  // [Downstream Impact] Display-only helper; no side effects.
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // GUID: ADMIN_STANDING_DATA-005-v03
  // [Intent] Formats an ISO date string into a human-readable UK-locale time with timezone (e.g., "14:00 GMT").
  // [Inbound Trigger] Called for each qualifying and race time in the calendar table.
  // [Downstream Impact] Display-only helper; no side effects.
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  // GUID: ADMIN_STANDING_DATA-006-v03
  // [Intent] Determines if a race has already occurred by comparing its time to the current date.
  // [Inbound Trigger] Called per race row to apply reduced opacity styling on past races.
  // [Downstream Impact] Affects CSS class only; past races appear dimmed in the table.
  const isPastRace = (raceTime: string) => {
    return new Date(raceTime) < new Date();
  };

  // GUID: ADMIN_STANDING_DATA-007-v03
  // [Intent] Renders the complete standing data view: driver cards grouped by team and a race calendar table.
  // [Inbound Trigger] Component render cycle.
  // [Downstream Impact] Purely presentational output; no mutations or side effects.
  return (
    <div className="space-y-6">
      {/* Drivers Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            F1 Drivers ({F1Drivers.length})
          </CardTitle>
          <CardDescription>
            The {Object.keys(driversByTeam).length} teams and {F1Drivers.length} drivers for the 2026 season.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(driversByTeam).map(([team, drivers]) => (
              <div key={team} className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-3 h-3 rounded-full ${teamColours[team] || 'bg-gray-500'}`} />
                  <h3 className="font-semibold text-sm">{team}</h3>
                </div>
                <div className="space-y-2">
                  {drivers.map((driver) => (
                    <div key={driver.id} className="flex items-center justify-between text-sm">
                      <span>{driver.name}</span>
                      <Badge variant="outline" className="font-mono">
                        #{driver.number}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Race Calendar Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Race Calendar ({RaceSchedule.length} races)
          </CardTitle>
          <CardDescription>
            The complete 2026 Formula 1 race schedule with qualifying and race times.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Race</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Qualifying</TableHead>
                  <TableHead>Race</TableHead>
                  <TableHead className="text-center">Sprint</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {RaceSchedule.map((race, index) => (
                  <TableRow
                    key={race.name}
                    className={isPastRace(race.raceTime) ? 'opacity-50' : ''}
                  >
                    <TableCell className="font-mono text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Flag className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{race.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {race.location}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{formatDate(race.qualifyingTime)}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatTime(race.qualifyingTime)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{formatDate(race.raceTime)}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatTime(race.raceTime)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {race.hasSprint ? (
                        <Badge variant="secondary" className="gap-1">
                          <Zap className="h-3 w-3" />
                          Sprint
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
