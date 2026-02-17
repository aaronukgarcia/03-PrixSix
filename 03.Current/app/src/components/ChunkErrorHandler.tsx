// GUID: COMPONENT_CHUNK_ERROR_HANDLER-000-v01
// [Intent] Client-side chunk load error detector that auto-refreshes the page when Next.js
//          fails to load a webpack chunk (typically due to stale build after deployment).
//          Shows a brief toast before refreshing to explain what's happening.
// [Inbound Trigger] Mounted in root layout. Listens to global window error events.
// [Downstream Impact] Prevents ChunkLoadError from crashing the app. Auto-recovers by
//                     reloading the page, which fetches the latest build chunks.

'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

// GUID: COMPONENT_CHUNK_ERROR_HANDLER-001-v01
// [Intent] Detects if an error is a webpack chunk loading failure by checking error message
//          and error type. Returns true for ChunkLoadError or timeout loading chunks.
// [Inbound Trigger] Called by error event listener for every unhandled error.
// [Downstream Impact] If true, triggers auto-refresh. If false, error propagates normally.
function isChunkLoadError(error: Error | ErrorEvent): boolean {
  const message = error instanceof Error ? error.message : error.message || '';
  const name = error instanceof Error ? error.name : '';

  // Match ChunkLoadError or chunk loading failures
  return (
    name === 'ChunkLoadError' ||
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes('Failed to fetch dynamically imported module') ||
    /chunk.*failed/i.test(message)
  );
}

// GUID: COMPONENT_CHUNK_ERROR_HANDLER-002-v01
// [Intent] Main component that sets up global error listener on mount, detects chunk errors,
//          shows user-friendly toast, and auto-refreshes after 1.5s delay.
// [Inbound Trigger] Rendered once in root layout.
// [Downstream Impact] Runs for the entire app session. Auto-recovers from stale chunk errors.
export function ChunkErrorHandler() {
  const { toast } = useToast();

  useEffect(() => {
    let isRefreshing = false; // Prevent multiple simultaneous refreshes

    const handleError = (event: ErrorEvent) => {
      // Only handle chunk load errors
      if (!isChunkLoadError(event.error || event)) {
        return;
      }

      // Prevent duplicate refreshes
      if (isRefreshing) {
        return;
      }
      isRefreshing = true;

      // Log to console for debugging
      console.warn('[ChunkErrorHandler] Detected stale build chunk. Auto-refreshing...', {
        message: event.message,
        error: event.error,
      });

      // Show user-friendly toast
      toast({
        title: 'Updating to Latest Version',
        description: 'A new version is available. Refreshing page...',
        duration: 1500,
      });

      // Brief delay to show toast, then refresh
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    };

    // Also handle promise rejections (for dynamic import() failures)
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (event.reason && isChunkLoadError(event.reason)) {
        if (isRefreshing) return;
        isRefreshing = true;

        console.warn('[ChunkErrorHandler] Detected chunk load rejection. Auto-refreshing...', {
          reason: event.reason,
        });

        toast({
          title: 'Updating to Latest Version',
          description: 'A new version is available. Refreshing page...',
          duration: 1500,
        });

        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [toast]);

  return null; // This component doesn't render anything
}
