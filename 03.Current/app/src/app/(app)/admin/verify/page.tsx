/**
 * /admin/verify - Admin Hot Link Verification Page
 *
 * GUID: PAGE_ADMIN_VERIFY-001-v03
 * [Intent] Landing page for admin magic link verification. Extracts token and email
 *          from URL parameters, exchanges them for adminVerified session cookie via
 *          POST /api/admin/verify-access, and redirects to /admin on success.
 * [Inbound Trigger] User clicks magic link from email → lands here with ?token=...&email=...
 * [Downstream Impact] Sets adminVerified cookie, logs verification to audit trail,
 *                     grants access to admin panel. Resolves ADMINCOMP-003.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

type VerificationStatus = 'verifying' | 'success' | 'error';

export default function AdminVerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<VerificationStatus>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  const [correlationId, setCorrelationId] = useState('');

  useEffect(() => {
    const verifyToken = async () => {
      const token = searchParams.get('token');
      const uid = searchParams.get('uid');

      // Validate URL parameters
      if (!token || !uid) {
        setStatus('error');
        setErrorMessage('Invalid verification link. Missing token or uid parameter.');
        return;
      }

      try {
        const response = await fetch('/api/admin/verify-access', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, uid }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Verification failed');
        }

        setCorrelationId(data.correlationId || '');
        setStatus('success');

        // Redirect to admin panel after 5 seconds
        setTimeout(() => {
          router.push('/admin');
        }, 5000);

      } catch (error) {
        console.error('Verification failed:', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Verification failed');
      }
    };

    verifyToken();
  }, [searchParams, router]);

  return (
    <div className="container max-w-2xl mx-auto py-12 px-4">
      <div className="space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
            Admin Verification
          </h1>
          <p className="text-muted-foreground">
            Verifying your identity...
          </p>
        </div>

        {status === 'verifying' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                <CardTitle>Verifying Token</CardTitle>
              </div>
              <CardDescription className="text-center">
                Please wait while we verify your verification link...
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center text-sm text-muted-foreground">
                <p>This should only take a moment.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {status === 'success' && (
          <Card className="border-green-500/50 bg-green-50/10">
            <CardHeader>
              <div className="flex items-center justify-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
                <CardTitle className="text-green-900 dark:text-green-100">
                  Verification Successful!
                </CardTitle>
              </div>
              <CardDescription className="text-center text-green-700 dark:text-green-300">
                Your identity has been verified. Redirecting to admin panel...
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Access granted</span>
                </div>
              </div>

              {correlationId && (
                <div className="text-xs text-center text-muted-foreground border-t pt-4">
                  <p>Correlation ID: <code className="bg-muted px-1 rounded">{correlationId}</code></p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {status === 'error' && (
          <Card className="border-red-500/50 bg-red-50/10">
            <CardHeader>
              <div className="flex items-center justify-center gap-3">
                <AlertCircle className="w-8 h-8 text-red-600" />
                <CardTitle className="text-red-900 dark:text-red-100">
                  Verification Failed
                </CardTitle>
              </div>
              <CardDescription className="text-center text-red-700 dark:text-red-300">
                We couldn't verify your identity. Please try again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md">
                <p className="text-sm text-red-900 dark:text-red-100">
                  <strong>Error:</strong> {errorMessage}
                </p>
              </div>

              <div className="text-sm text-muted-foreground space-y-2">
                <p><strong>Common reasons for verification failure:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>The verification link has expired (links expire after 10 minutes)</li>
                  <li>The link has already been used (single-use only)</li>
                  <li>The link was malformed or incomplete</li>
                  <li>The email address doesn't match the admin account</li>
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-4">
                <Button
                  onClick={() => router.push('/admin')}
                  variant="default"
                  className="flex-1"
                >
                  Request New Verification Link
                </Button>
                <Button
                  onClick={() => router.push('/dashboard')}
                  variant="outline"
                  className="flex-1"
                >
                  Back to Dashboard
                </Button>
              </div>

              {correlationId && (
                <div className="text-xs text-center text-muted-foreground border-t pt-4">
                  <p>
                    If this problem persists, please contact support with this reference:
                  </p>
                  <code className="bg-muted px-2 py-1 rounded mt-1 inline-block">{correlationId}</code>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
