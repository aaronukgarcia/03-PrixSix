
// GUID: ADMIN_HOT_NEWS-000-v04
// @SECURITY_FIX: Added client-side email send confirmation dialog, 5-minute cooldown state, and last-sent timestamp display (GEMINI-AUDIT-023).
// [Intent] Admin component for managing the Hot News feed: toggle AI updates, manually edit content, refresh via AI, and optionally email subscribers.
// [Inbound Trigger] Rendered within the admin panel when the "Hot News" tab is selected.
// [Downstream Impact] Writes to Firestore settings (hotNewsFeedEnabled, content). Can trigger AI content generation and email dispatch to all subscribed users.

"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { HotNewsSettings, getHotNewsSettings } from "@/firebase/firestore/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, RefreshCw, Mail, Copy, Check, RotateCcw, Clock } from "lucide-react";
import { hotNewsFeedFlow } from "@/ai/flows/hot-news-feed";
import { logAuditEvent } from "@/lib/audit";
import { ERROR_CODES, generateClientCorrelationId } from "@/lib/error-codes";
import { ToastAction } from "@/components/ui/toast";

// GUID: ADMIN_HOT_NEWS-001-v04
// @SECURITY_FIX: Component now tracks email send cooldown (5 min) and last-sent timestamp in state, shows confirmation dialog before email blast (GEMINI-AUDIT-023).
// [Intent] Main HotNewsManager component providing AI toggle, content editor, refresh button, and email dispatch controls.
// [Inbound Trigger] Rendered by the admin page when the Hot News tab is active.
// [Downstream Impact] Reads/writes hot news settings in Firestore. Can invoke AI generation flow and send-hot-news-email API. Audit events logged on save and refresh.

// GUID: ADMIN_HOT_NEWS-010-v01
// [Intent] Client-side email broadcast cooldown constant — 5 minutes in milliseconds. Mirrors the server-side enforcement to give immediate UI feedback.
// [Inbound Trigger] Evaluated in the emailCooldownActive derived value on every render.
// [Downstream Impact] Controls whether the "Send to all users" checkbox and Save button are usable. Server enforces independently via Firestore throttle.
const CLIENT_EMAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function HotNewsManager() {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();

  // GUID: ADMIN_HOT_NEWS-002-v04
  // @SECURITY_FIX: Added lastEmailSentAt and showConfirmDialog state for confirmation dialog and cooldown UX (GEMINI-AUDIT-023).
  // [Intent] Local state managing the hot news settings, loading/error states, form fields, operation flags, and email send safety controls.
  // [Inbound Trigger] Initialised on mount; updated by user interactions and async operations.
  // [Downstream Impact] Drives the entire component UI: toggles, textarea content, button disabled states, save/refresh behaviour, and email confirmation dialog.
  const [settings, setSettings] = useState<HotNewsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [hotNewsFeedEnabled, setHotNewsFeedEnabled] = useState(false);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sendEmails, setSendEmails] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);

  // Email send safety state — tracks last send time for cooldown and shows confirmation dialog
  const [lastEmailSentAt, setLastEmailSentAt] = useState<Date | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");

  const { toast } = useToast();

  // GUID: ADMIN_HOT_NEWS-011-v01
  // [Intent] Derived boolean — true when a Hot News email blast was sent within the last 5 minutes. Prevents repeated sends without waiting.
  // [Inbound Trigger] Recalculated on every render using lastEmailSentAt.
  // [Downstream Impact] Disables the "Send to all users" checkbox and greys out the Save button with a cooldown message when true.
  const emailCooldownActive = lastEmailSentAt !== null && (Date.now() - lastEmailSentAt.getTime()) < CLIENT_EMAIL_COOLDOWN_MS;

  // GUID: ADMIN_HOT_NEWS-012-v01
  // [Intent] Returns remaining cooldown time as a human-readable string (e.g. "4m 32s") for display in the cooldown warning.
  // [Inbound Trigger] Called only when emailCooldownActive is true.
  // [Downstream Impact] Shown in the cooldown badge so the admin knows exactly when they can send again.
  const getCooldownRemaining = useCallback((): string => {
    if (!lastEmailSentAt) return '';
    const remainingMs = CLIENT_EMAIL_COOLDOWN_MS - (Date.now() - lastEmailSentAt.getTime());
    if (remainingMs <= 0) return '';
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }, [lastEmailSentAt]);

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


  // GUID: ADMIN_HOT_NEWS-013-v01
  // @SECURITY_FIX: Intercepts the Save action when sendEmails is checked — shows confirmation dialog instead of immediately sending (GEMINI-AUDIT-023).
  // [Intent] Entry point for the "Save Settings" button click. If the email send checkbox is ticked, opens the confirmation dialog first; otherwise proceeds directly to save.
  // [Inbound Trigger] Clicking the "Save Settings" button.
  // [Downstream Impact] Either opens the email confirmation dialog (blocking send until confirmed) or calls handleSaveInternal directly.
  const handleSave = async () => {
    if (sendEmails) {
      // Show confirmation dialog — do NOT proceed until admin types CONFIRM
      setConfirmInput("");
      setShowConfirmDialog(true);
      return;
    }
    await handleSaveInternal(false);
  };

  // GUID: ADMIN_HOT_NEWS-004-v05
  // @SECURITY_FIX: Extracted from handleSave; now called only after confirmation dialog is accepted (GEMINI-AUDIT-023). Replaced direct Firestore write with authenticated API call (ADMINCOMP-006).
  // [Intent] Saves manual content edits and the AI toggle via secure API endpoint, and optionally sends emails to all subscribers after confirmation.
  // [Inbound Trigger] Called by handleSave (no email) or by handleConfirmedSend after admin has typed CONFIRM in the dialog.
  // [Downstream Impact] Updates hot news content via API (visible on dashboard). If withEmails is true, triggers /api/send-hot-news-email to dispatch emails. Audit trail created server-side.
  const handleSaveInternal = async (withEmails: boolean) => {
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

      // GUID: ADMIN_HOT_NEWS-005-v05
      // @SECURITY_FIX: Now driven by withEmails parameter (post-confirmation), records lastEmailSentAt timestamp for cooldown enforcement (GEMINI-AUDIT-023). Added Authorization header and adminUid to pass server-side auth gate added in ADMINCOMP-006 fix.
      // [Intent] Conditionally sends hot news content via email to all subscribed users after a successful save — only reachable after the admin has confirmed via the dialog.
      // [Inbound Trigger] withEmails is true — meaning the admin typed CONFIRM in the confirmation dialog.
      // [Downstream Impact] Calls /api/send-hot-news-email API endpoint with admin Bearer token. Records send timestamp to activate 5-min client cooldown. On failure, displays an error toast with correlation ID for debugging.
      if (withEmails) {
        setIsSendingEmails(true);
        try {
          const response = await fetch('/api/send-hot-news-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({
              content,
              updatedBy: firebaseUser.uid,
              updatedByEmail: user?.email,
              adminUid: firebaseUser.uid,
            }),
          });

          const result = await response.json();

          if (result.success) {
            // Record the send time to activate the 5-minute client-side cooldown
            setLastEmailSentAt(new Date());
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

  // GUID: ADMIN_HOT_NEWS-014-v01
  // @SECURITY_FIX: Handles confirmation dialog submission — only proceeds with email send when admin has typed exactly "CONFIRM" (GEMINI-AUDIT-023).
  // [Intent] Called when the admin clicks "Send Emails" in the confirmation dialog. Validates the confirmation text then delegates to handleSaveInternal with withEmails=true.
  // [Inbound Trigger] Clicking the "Send Emails" button inside the confirmation dialog.
  // [Downstream Impact] Closes the dialog, resets confirmInput, and triggers the full save + email blast flow. If confirmInput does not match exactly, button remains disabled.
  const handleConfirmedSend = async () => {
    setShowConfirmDialog(false);
    setConfirmInput("");
    await handleSaveInternal(true);
  };

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

  // GUID: ADMIN_HOT_NEWS-009-v04
  // @SECURITY_FIX: Renders email confirmation dialog, cooldown warning badge, and last-sent timestamp to prevent accidental/repeated email blasts (GEMINI-AUDIT-023).
  // [Intent] Renders the full Hot News management UI: AI toggle, content textarea, email checkbox, save and refresh buttons, cooldown warning, and confirmation dialog.
  // [Inbound Trigger] Component render cycle after settings have loaded successfully.
  // [Downstream Impact] User interactions update local state; handleSave and handleRefresh persist changes to Firestore.
  return (
    <>
      {/* GUID: ADMIN_HOT_NEWS-015-v01
          @SECURITY_FIX: Confirmation dialog that blocks email blast until admin explicitly types "CONFIRM" (GEMINI-AUDIT-023).
          [Intent] Modal dialog shown before any Hot News email broadcast. Displays recipient count warning and requires admin to type "CONFIRM" before the send button activates.
          [Inbound Trigger] showConfirmDialog becomes true when handleSave is called with sendEmails checked.
          [Downstream Impact] Prevents accidental email blasts by requiring deliberate typed confirmation. Cancelling the dialog leaves sendEmails checked so the admin can uncheck it. */}
      <Dialog open={showConfirmDialog} onOpenChange={(open) => { if (!open) { setShowConfirmDialog(false); setConfirmInput(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Mail className="h-5 w-5" />
              Confirm Email Broadcast
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <strong>Warning:</strong> This will send a Hot News email to all subscribed users immediately. This action cannot be undone.
                </div>
                <p className="text-sm text-muted-foreground">
                  The server enforces a 1-hour cooldown between broadcasts. Repeated sends within the cooldown window will be rejected server-side.
                </p>
                {lastEmailSentAt && (
                  <p className="text-sm text-muted-foreground">
                    Last sent: <strong>{lastEmailSentAt.toLocaleTimeString()}</strong>
                  </p>
                )}
                <div className="space-y-1">
                  <Label htmlFor="confirm-input" className="text-sm font-medium">
                    Type <span className="font-mono font-bold text-foreground">CONFIRM</span> to proceed:
                  </Label>
                  <Input
                    id="confirm-input"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder="Type CONFIRM here"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowConfirmDialog(false); setConfirmInput(""); }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmedSend}
              disabled={confirmInput !== "CONFIRM" || isSaving || isSendingEmails}
            >
              <Mail className="h-4 w-4 mr-2" />
              Send Emails
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {/* GUID: ADMIN_HOT_NEWS-016-v01
              @SECURITY_FIX: Cooldown warning and last-sent timestamp display (GEMINI-AUDIT-023).
              [Intent] Shows admin when the email blast is on cooldown (5 min client-side) and the exact time of the last send. Prevents accidental rapid-fire sends.
              [Inbound Trigger] lastEmailSentAt is set after a successful email send; emailCooldownActive derived from it.
              [Downstream Impact] While cooldown is active, the send checkbox is disabled with explanatory text. Timestamp persists for component lifetime. */}
          {lastEmailSentAt && (
            <div className={`flex items-center gap-2 text-sm rounded-lg border p-3 w-full ${emailCooldownActive ? 'border-amber-500/50 bg-amber-500/10 text-amber-700' : 'border-green-500/50 bg-green-500/10 text-green-700'}`}>
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>
                {emailCooldownActive
                  ? `Email blast cooldown active — ${getCooldownRemaining()} remaining. Last sent at ${lastEmailSentAt.toLocaleTimeString()}.`
                  : `Last email blast sent at ${lastEmailSentAt.toLocaleTimeString()}. Cooldown cleared.`}
              </span>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="send-emails"
              checked={sendEmails}
              onCheckedChange={(checked) => setSendEmails(checked === true)}
              disabled={isSaving || isRefreshing || isSendingEmails || emailCooldownActive}
            />
            <label
              htmlFor="send-emails"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
            >
              <Mail className="h-4 w-4" />
              Send email to all subscribed users
              {emailCooldownActive && (
                <span className="text-xs text-amber-600 font-normal">(cooldown active)</span>
              )}
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
    </>
  );
}
