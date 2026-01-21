'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useFirestore, useAuth } from '@/firebase';
import type { League } from '@/lib/types/league';
import { GLOBAL_LEAGUE_ID } from '@/lib/types/league';

interface LeagueContextState {
  leagues: League[];
  selectedLeague: League | null;
  setSelectedLeague: (league: League | null) => void;
  isLoading: boolean;
  globalLeague: League | null;
}

const LeagueContext = createContext<LeagueContextState | undefined>(undefined);

const SELECTED_LEAGUE_STORAGE_KEY = 'prixsix_selected_league_id';

interface LeagueProviderProps {
  children: ReactNode;
}

export const LeagueProvider: React.FC<LeagueProviderProps> = ({ children }) => {
  const firestore = useFirestore();
  const { user, isUserLoading } = useAuth();

  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeagueState] = useState<League | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to user's leagues
  useEffect(() => {
    if (isUserLoading) return;

    if (!user) {
      setLeagues([]);
      setSelectedLeagueState(null);
      setIsLoading(false);
      return;
    }

    const leaguesRef = collection(firestore, 'leagues');
    const q = query(leaguesRef, where('memberUserIds', 'array-contains', user.id));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const leagueData = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
        })) as League[];

        // Sort: global league first, then alphabetically
        leagueData.sort((a, b) => {
          if (a.isGlobal) return -1;
          if (b.isGlobal) return 1;
          return a.name.localeCompare(b.name);
        });

        setLeagues(leagueData);

        // Restore selected league from localStorage or default to global
        const savedLeagueId = localStorage.getItem(SELECTED_LEAGUE_STORAGE_KEY);
        const savedLeague = savedLeagueId ? leagueData.find(l => l.id === savedLeagueId) : null;
        const globalLeague = leagueData.find(l => l.isGlobal);

        if (!selectedLeague) {
          setSelectedLeagueState(savedLeague || globalLeague || leagueData[0] || null);
        } else {
          // Ensure selected league is still in user's leagues
          const stillMember = leagueData.find(l => l.id === selectedLeague.id);
          if (!stillMember) {
            setSelectedLeagueState(globalLeague || leagueData[0] || null);
          }
        }

        setIsLoading(false);
      },
      (error) => {
        console.error('Error subscribing to leagues:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, user, isUserLoading]);

  const setSelectedLeague = useCallback((league: League | null) => {
    setSelectedLeagueState(league);
    if (league) {
      localStorage.setItem(SELECTED_LEAGUE_STORAGE_KEY, league.id);
    } else {
      localStorage.removeItem(SELECTED_LEAGUE_STORAGE_KEY);
    }
  }, []);

  const globalLeague = useMemo(() => leagues.find(l => l.isGlobal) || null, [leagues]);

  const contextValue = useMemo((): LeagueContextState => ({
    leagues,
    selectedLeague,
    setSelectedLeague,
    isLoading,
    globalLeague,
  }), [leagues, selectedLeague, setSelectedLeague, isLoading, globalLeague]);

  return (
    <LeagueContext.Provider value={contextValue}>
      {children}
    </LeagueContext.Provider>
  );
};

export const useLeague = (): LeagueContextState => {
  const context = useContext(LeagueContext);
  if (context === undefined) {
    throw new Error('useLeague must be used within a LeagueProvider');
  }
  return context;
};

/**
 * Hook to filter data by the selected league's member list
 * Returns the full data if global league is selected or no league selected
 */
export function useLeagueFilter<T extends { userId?: string }>(
  data: T[],
  userIdField: keyof T = 'userId'
): T[] {
  const { selectedLeague } = useLeague();

  return useMemo(() => {
    if (!selectedLeague || selectedLeague.isGlobal) {
      return data;
    }

    return data.filter(item => {
      const userId = item[userIdField];
      return typeof userId === 'string' && selectedLeague.memberUserIds.includes(userId);
    });
  }, [data, selectedLeague, userIdField]);
}
