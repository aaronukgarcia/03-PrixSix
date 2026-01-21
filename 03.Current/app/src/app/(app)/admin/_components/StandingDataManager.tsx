'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Users, Calendar, MapPin, Flag, Zap } from "lucide-react";
import { F1Drivers, RaceSchedule } from "@/lib/data";

// Group drivers by team
const driversByTeam = F1Drivers.reduce((acc, driver) => {
  if (!acc[driver.team]) {
    acc[driver.team] = [];
  }
  acc[driver.team].push(driver);
  return acc;
}, {} as Record<string, typeof F1Drivers>);

// Team colours for visual distinction
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

export function StandingDataManager() {
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const isPastRace = (raceTime: string) => {
    return new Date(raceTime) < new Date();
  };

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
