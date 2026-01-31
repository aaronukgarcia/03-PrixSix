'use client';

import { useEffect, useState } from 'react';
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';

/**
 * Global error boundary that catches errors in the root layout.
 * This component renders a complete HTML document because it replaces
 * the root layout when an error occurs.
 */
export default function GlobalError({
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
    console.error(`[Global Error ${id}]`, error);

    // Try to log to server (fire and forget)
    fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId: id,
        errorCode: ERRORS.NETWORK_ERROR.code,
        error: error.message || 'Unknown global error',
        stack: error.stack,
        digest: error.digest,
        context: {
          route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
          action: 'global_crash',
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

  // This component must render html and body since it replaces the root layout
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#0a0a0a',
        color: '#fafafa',
        margin: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          maxWidth: '28rem',
          width: '100%',
          margin: '0 1rem',
          padding: '2rem',
          backgroundColor: '#171717',
          borderRadius: '0.5rem',
          border: '1px solid #262626',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.75rem',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '9999px',
              marginBottom: '1rem',
            }}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem',
            }}>
              Critical Error
            </h1>
            <p style={{ color: '#a1a1aa', fontSize: '0.875rem' }}>
              The application encountered a critical error and could not continue.
            </p>
          </div>

          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            padding: '1rem',
            borderRadius: '0.375rem',
            marginBottom: '1rem',
          }}>
            <p style={{ color: '#ef4444', fontWeight: '500', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              [{ERRORS.NETWORK_ERROR.code}] Global Error
            </p>
            <p style={{ color: '#a1a1aa', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
              {error.message || 'An unexpected error occurred'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#71717a', fontSize: '0.75rem' }}>Reference:</span>
              <code style={{
                fontSize: '0.75rem',
                backgroundColor: '#0a0a0a',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                flex: 1,
                userSelect: 'all',
              }}>
                {correlationId}
              </code>
              <button
                onClick={handleCopy}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  color: copied ? '#22c55e' : '#a1a1aa',
                }}
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={reset}
              style={{
                flex: 1,
                padding: '0.75rem 1rem',
                backgroundColor: '#fafafa',
                color: '#0a0a0a',
                border: 'none',
                borderRadius: '0.375rem',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                flex: 1,
                padding: '0.75rem 1rem',
                backgroundColor: 'transparent',
                color: '#fafafa',
                border: '1px solid #262626',
                borderRadius: '0.375rem',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Go Home
            </button>
          </div>

          <p style={{
            textAlign: 'center',
            color: '#71717a',
            fontSize: '0.75rem',
            marginTop: '1rem',
          }}>
            Please contact support with the reference code above if this persists.
          </p>
        </div>
      </body>
    </html>
  );
}
