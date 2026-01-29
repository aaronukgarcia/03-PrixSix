
"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Users, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@/firebase/provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useCollection, useFirestore } from "@/firebase";
import { collection, query } from "firebase/firestore";
import type { League } from "@/lib/types/league";
import { SYSTEM_OWNER_ID } from "@/lib/types/league";

interface LeaguesManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

export function LeaguesManager({ allUsers, isUserLoading }: LeaguesManagerProps) {
    const { toast } = useToast();
    const firestore = useFirestore();
    const [expandedLeagueId, setExpandedLeagueId] = useState<string | null>(null);

    const leaguesQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'leagues'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: leagues, isLoading: isLeaguesLoading } = useCollection<League>(leaguesQuery);

    const userMap = useMemo(() => {
        if (!allUsers) return new Map<string, string>();
        return new Map(allUsers.map(u => [u.id, u.teamName]));
    }, [allUsers]);

    const resolveTeamName = (userId: string) => {
        if (userId === SYSTEM_OWNER_ID) return "System";
        return userMap.get(userId) || userId;
    };

    const handleCopyInviteCode = async (code: string) => {
        await navigator.clipboard.writeText(code);
        toast({ title: "Copied", description: `Invite code "${code}" copied to clipboard.` });
    };

    const toggleExpand = (leagueId: string) => {
        setExpandedLeagueId(prev => prev === leagueId ? null : leagueId);
    };

    const isLoading = isUserLoading || isLeaguesLoading;

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
                                            <div className="flex items-center gap-2">
                                                <code className="text-sm bg-muted px-2 py-0.5 rounded">{league.inviteCode}</code>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCopyInviteCode(league.inviteCode!);
                                                    }}
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
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
