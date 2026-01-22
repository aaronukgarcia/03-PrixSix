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
    const { newsFeed, lastUpdated } = await getHotNewsFeed();

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
                    <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    <div className="h-4 bg-muted animate-pulse rounded w-5/6" />
                    <div className="h-4 bg-muted animate-pulse rounded w-4/6" />
                </div>
            </CardContent>
        </Card>
    );
}
