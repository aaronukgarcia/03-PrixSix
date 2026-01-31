'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Copy, Check, RefreshCw, Home } from 'lucide-react';
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [correlationId, setCorrelationId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Generate correlation ID for this error
    const id = generateClientCorrelationId();
    setCorrelationId(id);

    // Log to console for debugging
    console.error(`[App Error ${id}]`, error);

    // Try to log to server (fire and forget)
    fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId: id,
        errorCode: ERRORS.UNKNOWN_ERROR.code,
        error: error.message || 'Unknown client-side error',
        stack: error.stack,
        digest: error.digest,
        context: {
          route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
          action: 'client_crash',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        },
      }),
    }).catch(() => {
      // Silently fail - we're already in an error state
    });
  }, [error]);

  const handleCopy = () => {
    navigator.clipboard.writeText(correlationId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl font-headline">Something went wrong</CardTitle>
          <CardDescription>
            An unexpected error occurred. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive mb-2">[{ERRORS.UNKNOWN_ERROR.code}] Client Error</p>
            <p className="text-muted-foreground mb-3">
              {error.message || 'An unexpected error occurred'}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Reference:</span>
              <code className="text-xs bg-background px-2 py-1 rounded select-all flex-1">
                {correlationId}
              </code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button variant="outline" onClick={() => window.location.href = '/dashboard'} className="flex-1">
              <Home className="h-4 w-4 mr-2" />
              Dashboard
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            If this problem persists, please contact support with the reference code above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
