// GUID: ADMIN_INVITES_TREE-000-v01
// [Intent] INVITE-TREE-001 — Admin "Invites" tab: renders the referral genealogy tree showing
//          who invited whom across generations (e.g. Aaron → Garth → Pablo). Built entirely
//          from the users collection the admin page already fetches: each user's optional
//          invitedBy field ({ uid, teamName, tokenId, at }) links them to their inviter.
//          Users without invitedBy (legacy/pre-feature accounts, open-gate signups) are roots.
// [Inbound Trigger] Rendered within the admin panel when the "Invites" tab is selected
//          (PAGE_ADMIN-INVITES-003). Receives allUsers + isUserLoading as props.
// [Downstream Impact] Read-only — no Firestore queries or mutations of its own. Pending
//          (not-yet-consumed) invites are NOT shown: the invites collection is server-only
//          by design (client rules deny all access) and only consumed invites create users.

"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, UserPlus, Users } from "lucide-react";
import type { User } from "@/firebase/provider";

// GUID: ADMIN_INVITES_TREE-001-v01
// [Intent] Props contract — the full user list and its loading state, supplied by the admin
//          page's shared users subscription (PAGE_ADMIN-004).
// [Inbound Trigger] Passed from AdminPageClient.
// [Downstream Impact] No independent data fetch, so this tab stays consistent with every
//          other user-consuming admin tab.
interface InvitesManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

// GUID: ADMIN_INVITES_TREE-002-v01
// [Intent] Tree node shape and builder. Groups users into parent→children chains by
//          invitedBy.uid. Roots are (a) users without invitedBy and (b) users whose inviter
//          uid no longer resolves to a member (inviter deleted) — the latter are flagged as
//          orphans so the snapshot teamName from invitedBy can still be displayed. A visited
//          set guards against pathological invitedBy cycles (impossible via normal signup —
//          an inviter always exists before the invitee — but data is never trusted, GR#16).
// [Inbound Trigger] useMemo over allUsers in the component below.
// [Downstream Impact] Display-only structure; sorting is by team name for stable rendering.
interface ReferralNode {
    user: User;
    children: ReferralNode[];
    /** Total invitees in this subtree (direct + indirect). */
    descendantCount: number;
    /** Set when invitedBy exists but the inviter is no longer a member. */
    orphanedInviterTeamName?: string;
}

function buildReferralForest(allUsers: User[]): { roots: ReferralNode[]; invitedCount: number } {
    const byId = new Map<string, User>(allUsers.map((u) => [u.id, u]));
    const childrenOf = new Map<string, User[]>();
    const roots: { user: User; orphanedInviterTeamName?: string }[] = [];
    let invitedCount = 0;

    for (const u of allUsers) {
        const inviterUid = typeof u.invitedBy?.uid === "string" ? u.invitedBy.uid : null;
        if (inviterUid && inviterUid !== u.id) {
            invitedCount++;
            if (byId.has(inviterUid)) {
                const list = childrenOf.get(inviterUid) ?? [];
                list.push(u);
                childrenOf.set(inviterUid, list);
            } else {
                // Inviter left the league — show as root but keep the lineage annotation.
                roots.push({ user: u, orphanedInviterTeamName: u.invitedBy?.teamName || "a former member" });
            }
        } else {
            roots.push({ user: u });
        }
    }

    const visited = new Set<string>();
    const toNode = (user: User, orphanedInviterTeamName?: string): ReferralNode => {
        visited.add(user.id);
        const kids = (childrenOf.get(user.id) ?? [])
            .filter((k) => !visited.has(k.id)) // cycle guard — never trust stored shapes
            .sort((a, b) => (a.teamName || "").localeCompare(b.teamName || ""))
            .map((k) => toNode(k));
        return {
            user,
            children: kids,
            descendantCount: kids.reduce((sum, k) => sum + 1 + k.descendantCount, 0),
            orphanedInviterTeamName,
        };
    };

    const forest = roots
        .sort((a, b) => (a.user.teamName || "").localeCompare(b.user.teamName || ""))
        .map((r) => toNode(r.user, r.orphanedInviterTeamName));

    return { roots: forest, invitedCount };
}

// GUID: ADMIN_INVITES_TREE-003-v01
// [Intent] Defensive Firestore-timestamp → display-string coercion (GR#16). Accepts a client
//          Timestamp (toDate()), a Date, an ISO string, or millis; anything else renders "".
//          new Date(badInput) yields Invalid Date silently, so validity is checked explicitly.
// [Inbound Trigger] Called per node for invitedBy.at (fallback: createdAt).
// [Downstream Impact] Display-only; a bad value degrades to no date, never a crash or "Invalid Date".
function formatJoinDate(value: unknown): string {
    let d: Date | null = null;
    if (value && typeof (value as any).toDate === "function") {
        d = (value as any).toDate();
    } else if (value instanceof Date) {
        d = value;
    } else if (typeof value === "string" || typeof value === "number") {
        d = new Date(value);
    }
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// GUID: ADMIN_INVITES_TREE-004-v01
// [Intent] Recursive tree-node renderer — indented rows with a left connector border, team
//          name, email, join date, and an "invited N" badge on inviters. Orphaned-inviter
//          roots show a muted "invited by <snapshot name> (no longer a member)" note.
// [Inbound Trigger] Mapped over the forest in the main component render.
// [Downstream Impact] Presentation only.
function ReferralNodeRow({ node, depth }: { node: ReferralNode; depth: number }) {
    const joined = formatJoinDate(node.user.invitedBy?.at) || formatJoinDate(node.user.createdAt);
    return (
        <div className={depth > 0 ? "ml-5 border-l border-muted-foreground/20 pl-4" : ""}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                {depth === 0 ? (
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                    <UserPlus className="h-4 w-4 shrink-0 text-primary" />
                )}
                <span className="font-medium">{node.user.teamName || node.user.id}</span>
                <span className="text-xs text-muted-foreground">{node.user.email}</span>
                {joined && <span className="text-xs text-muted-foreground">· joined {joined}</span>}
                {node.children.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                        invited {node.children.length}
                        {node.descendantCount > node.children.length ? ` (${node.descendantCount} total)` : ""}
                    </Badge>
                )}
                {node.orphanedInviterTeamName && (
                    <span className="text-xs italic text-muted-foreground">
                        invited by {node.orphanedInviterTeamName} (no longer a member)
                    </span>
                )}
            </div>
            {node.children.map((child) => (
                <ReferralNodeRow key={child.user.id} node={child} depth={depth + 1} />
            ))}
        </div>
    );
}

// GUID: ADMIN_INVITES_TREE-005-v01
// [Intent] Main InvitesManager component — summary stats (members, invited, roots) and the
//          indented referral forest. Roots first (legacy/original members), each with their
//          full invite chain nested beneath.
// [Inbound Trigger] Rendered by AdminPageClient when the Invites tab is active.
// [Downstream Impact] Read-only view; no side effects.
export function InvitesManager({ allUsers, isUserLoading }: InvitesManagerProps) {
    const { roots, invitedCount } = useMemo(() => {
        if (!allUsers || allUsers.length === 0) return { roots: [] as ReferralNode[], invitedCount: 0 };
        return buildReferralForest(allUsers);
    }, [allUsers]);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-primary" />
                    <CardTitle>Referral Tree</CardTitle>
                </div>
                <CardDescription>
                    Who invited whom, across generations. Members without a recorded inviter
                    (accounts created before invite tracking, or via open registration) appear as roots.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {isUserLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-2/3" />
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-6 w-3/5" />
                    </div>
                ) : !allUsers || allUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members found.</p>
                ) : (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">{allUsers.length} members</Badge>
                            <Badge variant="outline">{invitedCount} joined via invite</Badge>
                            <Badge variant="outline">{roots.length} roots</Badge>
                        </div>
                        <div className="divide-y divide-muted/40">
                            {roots.map((node) => (
                                <ReferralNodeRow key={node.user.id} node={node} depth={0} />
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
