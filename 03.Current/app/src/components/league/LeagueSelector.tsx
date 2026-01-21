'use client';

import { Globe, Users } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLeague } from '@/contexts/league-context';

interface LeagueSelectorProps {
  className?: string;
}

export function LeagueSelector({ className }: LeagueSelectorProps) {
  const { leagues, selectedLeague, setSelectedLeague, isLoading } = useLeague();

  // Don't show selector if user only belongs to one league
  if (leagues.length <= 1) {
    return null;
  }

  const handleChange = (leagueId: string) => {
    const league = leagues.find(l => l.id === leagueId);
    if (league) {
      setSelectedLeague(league);
    }
  };

  return (
    <Select
      value={selectedLeague?.id || ''}
      onValueChange={handleChange}
      disabled={isLoading}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select league">
          {selectedLeague && (
            <div className="flex items-center gap-2">
              {selectedLeague.isGlobal ? (
                <Globe className="h-4 w-4" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              <span>{selectedLeague.name}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {leagues.map((league) => (
          <SelectItem key={league.id} value={league.id}>
            <div className="flex items-center gap-2">
              {league.isGlobal ? (
                <Globe className="h-4 w-4" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              <span>{league.name}</span>
              <span className="text-muted-foreground text-xs ml-auto">
                ({league.memberUserIds.length})
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
