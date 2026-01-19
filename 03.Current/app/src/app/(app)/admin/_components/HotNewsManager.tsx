
"use client";

import { useEffect, useState } from "react";
import { useFirestore } from "@/firebase";
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
import { useToast } from "@/hooks/use-toast";
import { HotNewsSettings, updateHotNewsContent, getHotNewsSettings } from "@/firebase/firestore/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw } from "lucide-react";
import { hotNewsFeedFlow } from "@/ai/flows/hot-news-feed";
import { serverTimestamp } from "firebase/firestore";

export function HotNewsManager() {
  const firestore = useFirestore();
  
  const [settings, setSettings] = useState<HotNewsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [hotNewsFeedEnabled, setHotNewsFeedEnabled] = useState(false);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    if (!firestore) return;
    setIsSaving(true);
    try {
      // Save the manual edits, enabled toggle, and update the timestamp
      await updateHotNewsContent(firestore, {
        content,
        hotNewsFeedEnabled,
        lastUpdated: serverTimestamp() as any // Update timestamp on every save
      });
      toast({
        title: "Success",
        description: "Hot News settings have been updated.",
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error updating settings",
        description: e.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!firestore) return;
    setIsRefreshing(true);
    try {
      const output = await hotNewsFeedFlow();
      if (output?.newsFeed) {
        setContent(output.newsFeed);
        await updateHotNewsContent(firestore, { 
            content: output.newsFeed, 
            lastUpdated: serverTimestamp() as any // Cast because SDK types differ
        });
        toast({
          title: "News Refreshed",
          description: "Latest content has been fetched and updated.",
        });
      }
    } catch (e: any) {
        toast({
            variant: "destructive",
            title: "Refresh Failed",
            description: e.message,
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
      <CardFooter className="gap-2">
        <Button onClick={handleSave} disabled={isSaving || isRefreshing}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
         <Button onClick={handleRefresh} variant="outline" disabled={isSaving || isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? "Refreshing..." : "Refresh Now"}
        </Button>
      </CardFooter>
    </Card>
  );
}
