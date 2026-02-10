
// GUID: ADMIN_LEAGUES-000-v03
// [Intent] Admin component for viewing all leagues, their owners, member counts, invite codes, and expandable member lists.
// [Inbound Trigger] Rendered within the admin panel when the "Leagues" tab is selected.
// [Downstream Impact] Read-only view of the leagues collection. Only clipboard write (invite code copy) has a side effect. No Firestore mutations.

"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ChevronDown, ChevronUp } from "lucide-react";
import type { User } from "@/firebase/provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection, useFirestore } from "@/firebase";
import { collection, query } from "firebase/firestore";
import type { League } from "@/lib/types/league";
import { SYSTEM_OWNER_ID } from "@/lib/types/league";

// GUID: ADMIN_LEAGUES-001-v03
// [Intent] Defines the props contract for LeaguesManager, requiring the full user list and its loading state for team name resolution.
// [Inbound Trigger] Passed from the parent admin page which fetches all users.
// [Downstream Impact] The component resolves user IDs to team names via allUsers for display in the leagues table.
interface LeaguesManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

// GUID: ADMIN_LEAGUES-002-v03
// [Intent] Main LeaguesManager component rendering a table of all leagues with expandable member details and invite code copy functionality.
// [Inbound Trigger] Rendered by the admin page when the Leagues tab is active.
// [Downstream Impact] Reads the leagues Firestore collection via useCollection. No write operations apart from clipboard copy.
export function LeaguesManager({ allUsers, isUserLoading }: LeaguesManagerProps) {
    const firestore = useFirestore();
    const [expandedLeagueId, setExpandedLeagueId] = useState<string | null>(null);

    // GUID: ADMIN_LEAGUES-003-v03
    // [Intent] Memoised Firestore query for the entire leagues collection, used by the useCollection hook.
    // [Inbound Trigger] Recomputed when the firestore instance changes.
    // [Downstream Impact] Feeds the useCollection hook which provides real-time league data for the table.
    const leaguesQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'leagues'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: leagues, isLoading: isLeaguesLoading } = useCollection<League>(leaguesQuery);

    // GUID: ADMIN_LEAGUES-004-v03
    // [Intent] Creates a Map from user ID to team name for efficient lookup when resolving league member and owner names.
    // [Inbound Trigger] Recomputed when allUsers changes.
    // [Downstream Impact] Used by resolveTeamName to display human-readable team names instead of raw user IDs.
    const userMap = useMemo(() => {
        if (!allUsers) return new Map<string, string>();
        return new Map(allUsers.map(u => [u.id, u.teamName]));
    }, [allUsers]);

    // GUID: ADMIN_LEAGUES-005-v03
    // [Intent] Resolves a user ID to a human-readable team name, with special handling for the system owner.
    // [Inbound Trigger] Called for each league owner and member ID during render.
    // [Downstream Impact] Display-only; falls back to the raw user ID if no match is found in the user map.
    const resolveTeamName = (userId: string) => {
        if (userId === SYSTEM_OWNER_ID) return "System";
        return userMap.get(userId) || userId;
    };

    // GUID: ADMIN_LEAGUES-006-v03
    // [Intent] REMOVED - Invite codes are now masked for security (ADMIN-005 fix).
    // Previous functionality: Copied league invite codes to clipboard.
    // [Security] Displaying and copying private league invite codes in admin panel enabled
    // unauthorized access. Codes are now masked with ••••••••.

    // GUID: ADMIN_LEAGUES-007-v03
    // [Intent] Toggles the expanded/collapsed state for a league row to show or hide member details.
    // [Inbound Trigger] Clicking anywhere on a league table row or the chevron button.
    // [Downstream Impact] Controls whether the member detail sub-row is visible for the clicked league.
    const toggleExpand = (leagueId: string) => {
        setExpandedLeagueId(prev => prev === leagueId ? null : leagueId);
    };

    const isLoading = isUserLoading || isLeaguesLoading;

    // GUID: ADMIN_LEAGUES-008-v03
    // [Intent] Renders the leagues table with columns for name, owner, member count, invite code, and an expand/collapse control.
    // [Inbound Trigger] Component render cycle; displays skeleton rows while isLoading is true.
    // [Downstream Impact] Provides the visual interface for league inspection. Expanded rows show member badges resolved to team names.
    return (
        <Card>
            <CardHeader>
                <CardTitle>Leagues</CardTitle>
                <CardDescription>View all leagues, their invite codes, and members.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead>Members</TableHead>
                            <TableHead>Invite Code</TableHead>
                            <TableHead className="text-right">Details</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                                </TableRow>
                            ))
                        ) : leagues?.map((league) => (
                            <Fragment key={league.id}>
                                <TableRow className="cursor-pointer" onClick={() => toggleExpand(league.id)}>
                                    <TableCell className="font-medium">
                                        {league.name}
                                        {league.isGlobal && (
                                            <Badge variant="secondary" className="ml-2">Global</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>{resolveTeamName(league.ownerId)}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            {league.memberUserIds?.length ?? 0}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {!league.isGlobal && league.inviteCode ? (
                                            <code className="text-sm bg-muted px-2 py-0.5 rounded text-muted-foreground">••••••••</code>
                                        ) : (
                                            <span className="text-muted-foreground text-sm">&mdash;</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                            {expandedLeagueId === league.id
                                                ? <ChevronUp className="h-4 w-4" />
                                                : <ChevronDown className="h-4 w-4" />}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                                {expandedLeagueId === league.id && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="bg-muted/50 p-4">
                                            <div className="text-sm font-medium mb-2">Members ({league.memberUserIds?.length ?? 0})</div>
                                            {league.memberUserIds?.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {league.memberUserIds.map(uid => (
                                                        <Badge key={uid} variant="outline">{resolveTeamName(uid)}</Badge>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-muted-foreground text-sm">No members</p>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </Fragment>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
