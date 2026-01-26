'use client';

import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { Progress } from '@/components/ui/progress';

// Threshold in ms before showing the loading indicator
const SHOW_THRESHOLD_MS = 4000;
// Progress increment interval
const PROGRESS_INTERVAL_MS = 100;

interface LoadingContextType {
  startLoading: (id?: string) => void;
  stopLoading: (id?: string) => void;
  isLoading: boolean;
}

const LoadingContext = createContext<LoadingContextType>({
  startLoading: () => {},
  stopLoading: () => {},
  isLoading: false,
});

export function useGlobalLoading() {
  return useContext(LoadingContext);
}

interface LoadingOverlayProps {
  children: React.ReactNode;
}

export function LoadingOverlayProvider({ children }: LoadingOverlayProps) {
  const [activeLoaders, setActiveLoaders] = useState<Set<string>>(new Set());
  const [showOverlay, setShowOverlay] = useState(false);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isLoading = activeLoaders.size > 0;

  // Start loading with optional ID (allows multiple concurrent loaders)
  const startLoading = useCallback((id?: string) => {
    const loaderId = id || `loader_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setActiveLoaders(prev => {
      const next = new Set(prev);
      next.add(loaderId);
      return next;
    });

    // Track start time if this is the first loader
    if (activeLoaders.size === 0) {
      startTimeRef.current = Date.now();
      setProgress(0);

      // Show overlay after threshold
      showTimeoutRef.current = setTimeout(() => {
        setShowOverlay(true);
        // Start progress simulation
        progressIntervalRef.current = setInterval(() => {
          setProgress(prev => {
            // Slow down as we approach 90%
            if (prev < 30) return prev + 3;
            if (prev < 60) return prev + 2;
            if (prev < 85) return prev + 1;
            if (prev < 95) return prev + 0.5;
            return prev; // Cap at 95% until actually done
          });
        }, PROGRESS_INTERVAL_MS);
      }, SHOW_THRESHOLD_MS);
    }
  }, [activeLoaders.size]);

  // Stop loading
  const stopLoading = useCallback((id?: string) => {
    setActiveLoaders(prev => {
      const next = new Set(prev);
      if (id) {
        next.delete(id);
      } else {
        // If no ID, clear all
        next.clear();
      }
      return next;
    });
  }, []);

  // Clean up when all loaders are done
  useEffect(() => {
    if (activeLoaders.size === 0) {
      if (showOverlay) {
        // Complete the progress
        setProgress(100);
        // Hide after a short delay
        setTimeout(() => {
          setShowOverlay(false);
          setProgress(0);
        }, 300);
      }

      // Clear timers
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current);
        showTimeoutRef.current = null;
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      startTimeRef.current = null;
    }
  }, [activeLoaders.size, showOverlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  return (
    <LoadingContext.Provider value={{ startLoading, stopLoading, isLoading }}>
      {children}
      {showOverlay && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="bg-background/80 backdrop-blur-sm border-b px-4 py-2">
            <div className="max-w-md mx-auto space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Loading...</span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  );
}
