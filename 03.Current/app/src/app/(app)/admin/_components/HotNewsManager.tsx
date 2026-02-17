
// GUID: ADMIN_HOT_NEWS-000-v03
// [Intent] Admin component for managing the Hot News feed: toggle AI updates, manually edit content, refresh via AI, and optionally email subscribers.
// [Inbound Trigger] Rendered within the admin panel when the "Hot News" tab is selected.
// [Downstream Impact] Writes to Firestore settings (hotNewsFeedEnabled, content). Can trigger AI content generation and email dispatch to all subscribed users.

"use client";

import { useEffect, useState } from "react";
import { useFirestore, useAuth } from "@/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { HotNewsSettings, getHotNewsSettings } from "@/firebase/firestore/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Mail, Copy, Check, RotateCcw } from "lucide-react";
import { hotNewsFeedFlow } from "@/ai/flows/hot-news-feed";
import { logAuditEvent } from "@/lib/audit";
import { ERROR_CODES, generateClientCorrelationId } from "@/lib/error-codes";
import { ToastAction } from "@/components/ui/toast";

// GUID: ADMIN_HOT_NEWS-001-v03
// [Intent] Main HotNewsManager component providing AI toggle, content editor, refresh button, and email dispatch controls.
// [Inbound Trigger] Rendered by the admin page when the Hot News tab is active.
// [Downstream Impact] Reads/writes hot news settings in Firestore. Can invoke AI generation flow and send-hot-news-email API. Audit events logged on save and refresh.
export function HotNewsManager() {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();

  // GUID: ADMIN_HOT_NEWS-002-v03
  // [Intent] Local state managing the hot news settings, loading/error states, form fields, and operation flags.
  // [Inbound Trigger] Initialised on mount; updated by user interactions and async operations.
  // [Downstream Impact] Drives the entire component UI: toggles, textarea content, button disabled states, and save/refresh behaviour.
  const [settings, setSettings] = useState<HotNewsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [hotNewsFeedEnabled, setHotNewsFeedEnabled] = useState(false);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sendEmails, setSendEmails] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);

  const { toast } = useToast();

  // GUID: ADMIN_HOT_NEWS-003-v03
  // [Intent] Fetches the current hot news settings from Firestore on component mount and populates local state.
  // [Inbound Trigger] Runs when the firestore instance becomes available (useEffect dependency).
  // [Downstream Impact] Populates settings, hotNewsFeedEnabled, and content state variables. Sets error state if fetch fails.
  useEffect(() => {
    if (firestore) {
      const fetchSettings = async () => {
        try {
          setLoading(true);
          const currentSettings = await getHotNewsSettings(firestore);
          setSettings(currentSettings);
          setHotNewsFeedEnabled(currentSettings.hotNewsFeedEnabled);
          setContent(currentSettings.content);
          setError(null);
        } catch (e: any) {
          setError(e);
        } finally {
          setLoading(false);
        }
      };
      fetchSettings();
    }
  }, [firestore]);


  // GUID: ADMIN_HOT_NEWS-004-v04
  // @SECURITY_FIX: Replaced direct Firestore write with authenticated API call (ADMINCOMP-006).
  // [Intent] Saves manual content edits and the AI toggle via secure API endpoint, and optionally sends emails to all subscribers.
  // [Inbound Trigger] Clicking the "Save Settings" button.
  // [Downstream Impact] Updates hot news content via API (visible on dashboard). If sendEmails is checked, triggers /api/send-hot-news-email to dispatch emails. Audit trail created server-side.
  const handleSave = async () => {
    if (!firebaseUser) return;
    setIsSaving(true);
    try {
      // Get Firebase Auth token for API authentication
      const idToken = await firebaseUser?.getIdToken();
      if (!idToken) {
        throw new Error('Authentication token not available');
      }

      // Call secure API endpoint to update hot news content
      const response = await fetch('/api/admin/update-hot-news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          adminUid: firebaseUser.uid,
          content,
          hotNewsFeedEnabled,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to update hot news');
      }

      toast({
        title: "Success",
        description: "Hot News settings have been updated.",
      });

      // GUID: ADMIN_HOT_NEWS-005-v03
      // [Intent] Conditionally sends hot news content via email to all subscribed users after a successful save.
      // [Inbound Trigger] The sendEmails checkbox is checked when the save button is clicked.
      // [Downstream Impact] Calls /api/send-hot-news-email API endpoint. On failure, displays an error toast with correlation ID for debugging.
      if (sendEmails) {
        setIsSendingEmails(true);
        try {
          const response = await fetch('/api/send-hot-news-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              updatedBy: firebaseUser.uid,
              updatedByEmail: user?.email,
            }),
          });

          const result = await response.json();

          if (result.success) {
            toast({
              title: "Emails Sent",
              description: result.message,
            });
          } else {
            // Use correlation ID from API response or generate client-side
            const correlationId = result.correlationId || generateClientCorrelationId();
            const errorCode = result.errorCode || ERROR_CODES.EMAIL_SEND_FAILED.code;
            toast({
              variant: "destructive",
              title: `Error ${errorCode}`,
              description: (
                <div className="space-y-2">
                  <p>{result.error || "Failed to send emails"}</p>
                  <p className="text-xs font-mono bg-destructive-foreground/10 p-1 rounded select-all cursor-text">
                    ID: {correlationId}
                  </p>
                </div>
              ),
              duration: 15000, // Keep visible longer for copying
            });
          }
        } catch (emailError: any) {
          const correlationId = generateClientCorrelationId();
          toast({
            variant: "destructive",
            title: `Error ${ERROR_CODES.EMAIL_SEND_FAILED.code}`,
            description: (
              <div className="space-y-2">
                <p>{emailError.message}</p>
                <p className="text-xs font-mono bg-destructive-foreground/10 p-1 rounded select-all cursor-text">
                  ID: {correlationId}
                </p>
              </div>
            ),
            duration: 15000,
          });
        } finally {
          setIsSendingEmails(false);
          setSendEmails(false); // Reset checkbox
        }
      }
    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      toast({
        variant: "destructive",
        title: `Error ${ERROR_CODES.FIRESTORE_WRITE_FAILED.code}`,
        description: (
          <div className="space-y-2">
            <p>{e.message}</p>
            <p className="text-xs font-mono bg-destructive-foreground/10 p-1 rounded select-all cursor-text">
              ID: {correlationId}
            </p>
          </div>
        ),
        duration: 15000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // GUID: ADMIN_HOT_NEWS-006-v04
  // [Intent] Triggers the AI-powered hot news generation flow, updates the textarea content, and persists the result to Firestore.
  // [Inbound Trigger] Clicking the "Refresh Now" button.
  // [Downstream Impact] Overwrites the content textarea and saves AI-generated hot news content via API. Audit event logged with source 'ai_generated'.
  // [Error Handling] Detects stale Server Action hash (post-deployment cache mismatch) and prompts user to refresh the page.
  const handleRefresh = async () => {
    if (!firebaseUser) return;
    setIsRefreshing(true);
    try {
      const output = await hotNewsFeedFlow();
      if (output?.newsFeed) {
        setContent(output.newsFeed);

        // Get Firebase Auth token for API authentication
        const idToken = await firebaseUser?.getIdToken();
        if (!idToken) {
          throw new Error('Authentication token not available');
        }

        // Call secure API endpoint to update with AI-generated content
        const response = await fetch('/api/admin/update-hot-news', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            adminUid: firebaseUser.uid,
            content: output.newsFeed,
            hotNewsFeedEnabled, // Keep existing toggle state
          }),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to save AI-generated content');
        }

        // Audit log the AI refresh
        await logAuditEvent(firestore, firebaseUser.uid, 'REFRESH_HOT_NEWS_AI', {
          email: user?.email,
          teamName: user?.teamName,
          contentPreview: output.newsFeed.substring(0, 200) + (output.newsFeed.length > 200 ? '...' : ''),
          contentLength: output.newsFeed.length,
          source: 'ai_generated',
        });

        toast({
          title: "News Refreshed",
          description: "Latest content has been fetched and updated.",
        });
      }
    } catch (e: any) {
        const correlationId = generateClientCorrelationId();
        const isStaleAction = !!e?.digest || /not found|internal/i.test(e?.message);
        const moduleInfo = 'ADMIN_HOT_NEWS-006 (hotNewsFeedFlow)';

        console.error(`[${ERROR_CODES.AI_GENERATION_FAILED.code}] ${moduleInfo}`, {
          correlationId,
          digest: e?.digest,
          message: e?.message,
        });

        toast({
            variant: "destructive",
            title: `Error ${ERROR_CODES.AI_GENERATION_FAILED.code}`,
            description: (
              <div className="space-y-2">
                <p>
                  {isStaleAction
                    ? "The app has been updated. Please refresh the page."
                    : e.message}
                </p>
                <code className="block text-xs font-mono bg-destructive-foreground/10 p-1 rounded select-all cursor-text">
                  {correlationId}{e?.digest ? ` | digest:${e.digest}` : ''} | {moduleInfo}
                </code>
              </div>
            ),
            duration: 15000,
            ...(isStaleAction && {
              action: (
                <ToastAction altText="Refresh Page" onClick={() => window.location.reload()}>
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Refresh
                </ToastAction>
              ),
            }),
        });
    } finally {
        setIsRefreshing(false);
    }
  }

  // GUID: ADMIN_HOT_NEWS-007-v03
  // [Intent] Renders a loading skeleton while hot news settings are being fetched from Firestore.
  // [Inbound Trigger] loading state is true during the initial fetch.
  // [Downstream Impact] Prevents interaction with uninitialised form state; replaced by the full UI once data loads.
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
        <CardFooter>
          <Skeleton className="h-10 w-32" />
        </CardFooter>
      </Card>
    );
  }

  // GUID: ADMIN_HOT_NEWS-008-v03
  // [Intent] Renders an error alert when the initial settings fetch fails, blocking access to the editor.
  // [Inbound Trigger] error state is non-null after a failed fetch in the useEffect.
  // [Downstream Impact] User must reload the page to retry; no editing is possible in this state.
  if (error) {
    return (
        <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error Loading Settings</AlertTitle>
            <AlertDescription>
                There was a problem fetching the Hot News settings. Please check the console and try again.
            </AlertDescription>
        </Alert>
    )
  }

  // GUID: ADMIN_HOT_NEWS-009-v03
  // [Intent] Renders the full Hot News management UI: AI toggle, content textarea, email checkbox, save and refresh buttons.
  // [Inbound Trigger] Component render cycle after settings have loaded successfully.
  // [Downstream Impact] User interactions update local state; handleSave and handleRefresh persist changes to Firestore.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Hot News Feed</CardTitle>
        <CardDescription>
          Control the AI-powered news feed. You can enable or disable the feed to toggle
          automatic updates and manually edit the content.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="enable-ai" className="text-base">
              Enable AI Updates
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow the AI to automatically update the news feed every hour.
            </p>
          </div>
          <Switch
            id="enable-ai"
            checked={hotNewsFeedEnabled}
            onCheckedChange={setHotNewsFeedEnabled}
            aria-label="Enable AI Updates"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="news-content">News Content</Label>
          <Textarea
            id="news-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter the news content here..."
            rows={8}
            disabled={isSaving || isRefreshing}
          />
          <p className="text-sm text-muted-foreground">
            {hotNewsFeedEnabled
              ? "Content will be overwritten by the AI hourly."
              : "Content is static. AI updates are disabled."}
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="send-emails"
            checked={sendEmails}
            onCheckedChange={(checked) => setSendEmails(checked === true)}
            disabled={isSaving || isRefreshing || isSendingEmails}
          />
          <label
            htmlFor="send-emails"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
          >
            <Mail className="h-4 w-4" />
            Send email to all subscribed users
          </label>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving || isRefreshing || isSendingEmails}>
            {isSaving ? "Saving..." : isSendingEmails ? "Sending Emails..." : "Save Settings"}
          </Button>
          <Button onClick={handleRefresh} variant="outline" disabled={isSaving || isRefreshing || isSendingEmails}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? "Refreshing..." : "Refresh Now"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
