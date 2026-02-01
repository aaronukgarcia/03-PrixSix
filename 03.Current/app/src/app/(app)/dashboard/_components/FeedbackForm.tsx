'use client';

import { useState } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, doc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Bug, Lightbulb, Send, CheckCircle2, Frown, Copy, Check, Bell } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';

export function FeedbackForm() {
  const firestore = useFirestore();
  const { user } = useAuth();
  const { toast } = useToast();

  const [type, setType] = useState<'bug' | 'feature'>('bug');
  const [text, setText] = useState('');
  const [notifyOnFix, setNotifyOnFix] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !firestore || !user) return;

    setSubmitting(true);
    setError(null);

    // Generate correlation ID upfront
    const correlationId = generateClientCorrelationId();

    try {
      const counterDocId = type === 'bug' ? 'feedback_bugs' : 'feedback_features';
      const prefix = type === 'bug' ? 'BG' : 'FB';

      await runTransaction(firestore, async (transaction) => {
        const counterRef = doc(firestore, 'counters', counterDocId);
        const counterSnap = await transaction.get(counterRef);

        let nextId = 1;
        if (counterSnap.exists()) {
          nextId = (counterSnap.data().nextId || 0) + 1;
        }

        const referenceId = `${prefix}-${String(nextId).padStart(3, '0')}`;

        const feedbackRef = doc(collection(firestore, 'feedback'));
        transaction.set(feedbackRef, {
          type,
          text: text.trim(),
          userId: user.id,
          userEmail: user.email || 'unknown',
          teamName: user.teamName || 'Unknown',
          createdAt: serverTimestamp(),
          status: 'new',
          notifyOnFix,
          referenceId,
        });

        transaction.set(counterRef, { nextId }, { merge: true });
      });

      const wantsNotification = notifyOnFix;
      setSubmitted(true);
      setText('');
      setNotifyOnFix(false);

      toast({
        title: 'Feedback Submitted',
        description: wantsNotification
          ? "Thank you! We'll notify you when this is addressed."
          : 'Thank you for your feedback!',
      });

      // Reset after 3 seconds
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err: any) {
      console.error(`[Feedback Error ${correlationId}]`, err);

      // Log to error_logs via API
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId,
          errorCode: ERRORS.FIRESTORE_WRITE_FAILED.code,
          error: err?.message || 'Failed to submit feedback',
          stack: err?.stack,
          context: {
            route: '/dashboard',
            action: 'submit_feedback',
            feedbackType: type,
            userId: user?.id,
            errorType: err?.code || 'FirestoreWriteError',
          },
        }),
      }).catch(() => {});

      const errorMessage = `Failed to submit feedback. [${ERRORS.FIRESTORE_WRITE_FAILED.code}] (Ref: ${correlationId})`;
      setError(errorMessage);

      toast({
        variant: 'destructive',
        title: `Error [${ERRORS.FIRESTORE_WRITE_FAILED.code}]`,
        description: 'Failed to submit feedback. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold text-green-500">Thank You!</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Your feedback has been submitted and will be reviewed.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5" />
          Bug Report / Feature Request
        </CardTitle>
        <CardDescription>
          Found a bug or have an idea? Let us know!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setType('bug')}
              className={cn(
                'flex-1 gap-2',
                type === 'bug' && 'border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-500'
              )}
            >
              <Bug className="h-4 w-4" />
              Bug Report
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setType('feature')}
              className={cn(
                'flex-1 gap-2',
                type === 'feature' && 'border-emerald-500 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-500'
              )}
            >
              <Lightbulb className="h-4 w-4" />
              Feature Request
            </Button>
          </div>

          {/* Text Area */}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={type === 'bug' ? 'Describe the bug you encountered...' : 'Describe your feature idea...'}
            rows={4}
            maxLength={1000}
            disabled={submitting}
          />

          {/* Notify on Fix Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="notify-on-fix"
              checked={notifyOnFix}
              onCheckedChange={(checked) => setNotifyOnFix(checked === true)}
              disabled={submitting}
            />
            <Label
              htmlFor="notify-on-fix"
              className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1.5"
            >
              <Bell className="h-3.5 w-3.5" />
              Notify me when this is {type === 'bug' ? 'fixed' : 'implemented'}
            </Label>
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              <div className="flex items-center gap-x-2">
                <Frown className="h-4 w-4 flex-shrink-0" />
                <p>{error.includes('(Ref:') ? error.split('(Ref:')[0].trim() : error}</p>
              </div>
              {error.includes('(Ref:') && (
                <div className="mt-2 pt-2 border-t border-destructive/20 flex items-center gap-2">
                  <code className="text-xs select-all cursor-pointer bg-destructive/10 px-2 py-1 rounded flex-1">
                    {error.match(/\(Ref:\s*([^)]+)\)/)?.[1] || ''}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopy(error.match(/\(Ref:\s*([^)]+)\)/)?.[1] || '')}
                  >
                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {text.length}/1000 characters
            </span>
            <Button
              type="submit"
              disabled={submitting || !text.trim()}
              className="gap-2"
            >
              {submitting ? (
                'Submitting...'
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Submit
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
