'use client';

import { useState, useEffect } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, query, where, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckCircle2, X } from 'lucide-react';

interface ResolvedItem {
  id: string;
  type: 'bug' | 'feature';
  text: string;
  resolvedVersion: string;
}

/**
 * One-time notification shown on the dashboard when a user's
 * feedback has been resolved. Once dismissed, the item's
 * `resolvedNotifiedAt` field is set so it never re-appears.
 */
export function ResolvedFeedbackNotifier() {
  const firestore = useFirestore();
  const { user } = useAuth();
  const [items, setItems] = useState<ResolvedItem[]>([]);

  useEffect(() => {
    if (!firestore || !user) return;

    const fetchResolved = async () => {
      try {
        // Feedback belonging to this user, resolved, not yet notified
        const q = query(
          collection(firestore, 'feedback'),
          where('userId', '==', user.id),
          where('status', '==', 'resolved'),
          where('resolvedNotifiedAt', '==', null),
        );
        const snap = await getDocs(q);
        const resolved: ResolvedItem[] = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.resolvedVersion) {
            resolved.push({
              id: d.id,
              type: data.type,
              text: data.text,
              resolvedVersion: data.resolvedVersion,
            });
          }
        });
        setItems(resolved);
      } catch {
        // Silently ignore — non-critical UI
      }
    };

    fetchResolved();
  }, [firestore, user]);

  const dismiss = async (id: string) => {
    if (!firestore) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await updateDoc(doc(firestore, 'feedback', id), {
        resolvedNotifiedAt: serverTimestamp(),
      });
    } catch {
      // Best-effort
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Alert
          key={item.id}
          className="border-green-500 bg-green-50 dark:bg-green-950/20 pr-10 relative"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200 text-sm">
            Your {item.type === 'bug' ? 'bug report' : 'feature request'}{' '}
            <span className="font-medium">&quot;{item.text.length > 60 ? item.text.substring(0, 60) + '...' : item.text}&quot;</span>{' '}
            was {item.type === 'bug' ? 'fixed' : 'implemented'} in{' '}
            <span className="font-mono font-semibold">v{item.resolvedVersion}</span>.
          </AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6 text-green-600 hover:text-green-800"
            onClick={() => dismiss(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </Alert>
      ))}
    </div>
  );
}
