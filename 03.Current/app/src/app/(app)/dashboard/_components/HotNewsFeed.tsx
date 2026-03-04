// GUID: DASHBOARD_HOT_NEWS_FEED-000-v01
// [Intent] Server component that fetches the latest AI-generated Hot News Feed content from getHotNewsFeed() and renders it as a card with timestamp and refresh counter; also exports HotNewsFeedSkeleton for Suspense boundaries.
// [Inbound Trigger] Rendered by the dashboard page inside a React Suspense boundary; re-fetches on each page load (no client-side caching).
// [Downstream Impact] Displays the Vertex AI-generated paddock news to all players; refresh counter shown as subtle four-digit ID.
import { getHotNewsFeed } from "@/ai/flows/hot-news-feed";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Newspaper, Clock } from "lucide-react";

// Format the lastUpdated timestamp for display
function formatNewsTimestamp(isoString?: string) {
    if (!isoString) return null;
    const date = new Date(isoString);
    return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export async function HotNewsFeed() {
    const { newsFeed, lastUpdated, refreshCount } = await getHotNewsFeed();

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Newspaper className="h-6 w-6 text-primary"/>
                    <CardTitle>Hot News Feed</CardTitle>
                </div>
                <CardDescription className="flex items-center justify-between">
                    <span>Hourly updates from the paddock.</span>
                    {lastUpdated && (
                        <span className="flex items-center gap-1 text-xs">
                            <Clock className="h-3 w-3" />
                            Last updated: {formatNewsTimestamp(lastUpdated)}
                        </span>
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{newsFeed}</p>
                {refreshCount !== undefined && (
                    <p className="mt-3 text-right text-[10px] text-muted-foreground/40 font-mono select-none">
                        #{String(refreshCount).padStart(4, '0')}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export function HotNewsFeedSkeleton() {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Newspaper className="h-6 w-6 text-primary"/>
                    <CardTitle>Hot News Feed</CardTitle>
                </div>
                <CardDescription>
                    <span>Loading latest paddock news...</span>
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-full [animation-delay:75ms]" />
                    <div className="h-4 bg-muted animate-pulse rounded w-5/6 [animation-delay:100ms]" />
                    <div className="h-4 bg-muted animate-pulse rounded w-4/6 [animation-delay:125ms]" />
                </div>
            </CardContent>
        </Card>
    );
}
