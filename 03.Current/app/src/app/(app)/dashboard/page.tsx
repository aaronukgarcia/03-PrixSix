import { getHotNewsFeed } from "@/ai/flows/hot-news-feed";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNextRace } from "@/lib/data";
import { Newspaper, Flag, Calendar, Clock } from "lucide-react";
import { DashboardClient } from "./_components/DashboardClient";
import { APP_VERSION } from '@/lib/version';


// Force dynamic rendering to avoid build-time Firestore access
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const { newsFeed, lastUpdated } = await getHotNewsFeed();

    // Format the lastUpdated timestamp for display
    const formatNewsTimestamp = (isoString?: string) => {
        if (!isoString) return null;
        const date = new Date(isoString);
        return date.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };
    const nextRace = findNextRace();
    
    const isPitlaneOpen = new Date(nextRace.qualifyingTime) > new Date();

    const qualifyingDate = new Date(nextRace.qualifyingTime);
    const raceDate = new Date(nextRace.raceTime);

    return (
        <div className="grid gap-6">
            <DashboardClient nextRace={nextRace} />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Pit Lane Status</CardTitle>
                        {isPitlaneOpen ? (
                           <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                            <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                    </CardHeader>
                    <CardContent>
                       {isPitlaneOpen ? (
                            <Alert className="border-green-500/50 text-green-500 [&>svg]:text-green-500">
                                <CheckCircle2 className="h-4 w-4" />
                                <AlertTitle className="font-bold">Open</AlertTitle>
                                <AlertDescription>
                                    Predictions are open. Submit or edit your picks!
                                </AlertDescription>
                            </Alert>
                       ) : (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle className="font-bold">Closed</AlertTitle>
                                <AlertDescription>
                                    Qualifying has started. Predictions are locked.
                                </AlertDescription>
                            </Alert>
                       )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Qualifying</CardTitle>
                        <Flag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {qualifyingDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {qualifyingDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (Your Time)
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Race Day</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                           {raceDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                         <p className="text-xs text-muted-foreground">
                            {raceDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} (Your Time)
                        </p>
                    </CardContent>
                </Card>
            </div>
           
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

            <div className="text-center">
                <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
            </div>
        </div>
    )
}
