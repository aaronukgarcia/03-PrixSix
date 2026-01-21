
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
import { HotNewsSettings, updateHotNewsContent, getHotNewsSettings } from "@/firebase/firestore/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Mail, Copy, Check } from "lucide-react";
import { hotNewsFeedFlow } from "@/ai/flows/hot-news-feed";
import { serverTimestamp } from "firebase/firestore";
import { logAuditEvent } from "@/lib/audit";
import { ERROR_CODES, generateClientCorrelationId } from "@/lib/error-codes";

export function HotNewsManager() {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();

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


  const handleSave = async () => {
    if (!firestore || !firebaseUser) return;
    setIsSaving(true);
    try {
      // Save the manual edits, enabled toggle, and update the timestamp
      await updateHotNewsContent(firestore, {
        content,
        hotNewsFeedEnabled,
        lastUpdated: serverTimestamp() as any // Update timestamp on every save
      });

      // Audit log the update
      await logAuditEvent(firestore, firebaseUser.uid, 'UPDATE_HOT_NEWS', {
        email: user?.email,
        teamName: user?.teamName,
        contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        contentLength: content.length,
        hotNewsFeedEnabled,
      });

      toast({
        title: "Success",
        description: "Hot News settings have been updated.",
      });

      // Send emails to subscribers if checkbox was checked
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

  const handleRefresh = async () => {
    if (!firestore || !firebaseUser) return;
    setIsRefreshing(true);
    try {
      const output = await hotNewsFeedFlow();
      if (output?.newsFeed) {
        setContent(output.newsFeed);
        await updateHotNewsContent(firestore, {
            content: output.newsFeed,
            lastUpdated: serverTimestamp() as any // Cast because SDK types differ
        });

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
        toast({
            variant: "destructive",
            title: `Error ${ERROR_CODES.AI_GENERATION_FAILED.code}`,
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
        setIsRefreshing(false);
    }
  }

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
