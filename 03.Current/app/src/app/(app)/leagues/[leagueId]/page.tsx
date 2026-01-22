'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirestore, useAuth } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  Globe,
  Users,
  Crown,
  Copy,
  RefreshCw,
  Trash2,
  UserMinus,
  ArrowLeft,
  Loader2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  regenerateInviteCode,
  updateLeagueName,
  removeMember,
  deleteLeague,
  leaveLeague,
} from '@/lib/leagues';
import type { League } from '@/lib/types/league';
import { GLOBAL_LEAGUE_ID } from '@/lib/types/league';

interface MemberInfo {
  id: string;
  teamName: string;
  email: string;
}

export default function LeagueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useAuth();
  const { toast } = useToast();

  const leagueId = params.leagueId as string;

  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isOwner = league?.ownerId === user?.id;
  const isGlobal = league?.isGlobal;
  const isMember = league?.memberUserIds.includes(user?.id || '');

  // Subscribe to league updates
  useEffect(() => {
    if (!firestore || !leagueId) return;

    const unsubscribe = onSnapshot(
      doc(firestore, 'leagues', leagueId),
      async (snapshot) => {
        if (!snapshot.exists()) {
          setLeague(null);
          setIsLoading(false);
          return;
        }

        const leagueData = { ...snapshot.data(), id: snapshot.id } as League;
        setLeague(leagueData);
        setEditName(leagueData.name);

        // Fetch member details
        const memberPromises = leagueData.memberUserIds.map(async (memberId) => {
          const userDoc = await getDoc(doc(firestore, 'users', memberId));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            return {
              id: memberId,
              teamName: userData.teamName || 'Unknown',
              email: userData.email || '',
            };
          }
          return { id: memberId, teamName: 'Unknown', email: '' };
        });

        const memberData = await Promise.all(memberPromises);
        setMembers(memberData);
        setIsLoading(false);
      },
      (error: any) => {
        console.error('Error fetching league:', error);
        const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
        let errorMsg: string;
        if (error?.code === 'permission-denied') {
          errorMsg = `Permission denied. You may not be a member of this league. [PX-1001] (Ref: ${correlationId})`;
        } else {
          errorMsg = `Error loading league: ${error?.message || 'Unknown error'} [PX-9001] (Ref: ${correlationId})`;
        }
        setLoadError(errorMsg);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, leagueId]);

  const handleRegenerateCode = async () => {
    if (!user) return;

    setIsRegenerating(true);
    const result = await regenerateInviteCode(firestore, leagueId, user.id);

    if (result.success) {
      toast({
        title: 'Code Regenerated',
        description: `New invite code: ${result.newCode}`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to regenerate code.',
      });
    }
    setIsRegenerating(false);
  };

  const handleSaveName = async () => {
    if (!user || !editName.trim()) return;

    setIsSavingName(true);
    const result = await updateLeagueName(firestore, leagueId, user.id, editName.trim());

    if (result.success) {
      toast({
        title: 'Name Updated',
        description: 'League name has been updated.',
      });
      setIsEditingName(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to update name.',
      });
    }
    setIsSavingName(false);
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!user) return;

    const result = await removeMember(firestore, leagueId, user.id, memberId);

    if (result.success) {
      toast({
        title: 'Member Removed',
        description: `${memberName} has been removed from the league.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to remove member.',
      });
    }
  };

  const handleLeave = async () => {
    if (!user || !league) return;

    const result = await leaveLeague(firestore, leagueId, user.id);

    if (result.success) {
      toast({
        title: 'Left League',
        description: `You have left "${league.name}".`,
      });
      router.push('/leagues');
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to leave league.',
      });
    }
  };

  const handleDelete = async () => {
    if (!user || !league) return;

    const result = await deleteLeague(firestore, leagueId, user.id);

    if (result.success) {
      toast({
        title: 'League Deleted',
        description: `"${league.name}" has been deleted.`,
      });
      router.push('/leagues');
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to delete league.',
      });
    }
  };

  const copyInviteCode = () => {
    if (league?.inviteCode) {
      navigator.clipboard.writeText(league.inviteCode);
      toast({
        title: 'Copied',
        description: 'Invite code copied to clipboard.',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push('/leagues')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Leagues
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold text-destructive">Error Loading League</h3>
            <p className="text-muted-foreground mt-2 select-all">
              {loadError}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push('/leagues')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Leagues
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">League Not Found</h3>
            <p className="text-muted-foreground">
              This league may have been deleted or you don't have access to it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isMember && !isGlobal) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push('/leagues')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Leagues
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-muted-foreground">
              You are not a member of this league.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/leagues')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          {isGlobal ? (
            <Globe className="h-8 w-8 text-blue-500" />
          ) : (
            <Users className="h-8 w-8 text-green-500" />
          )}
          {isEditingName && !isGlobal ? (
            <div className="flex items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-9 w-48"
                autoFocus
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={handleSaveName}
                disabled={isSavingName}
              >
                {isSavingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => {
                  setEditName(league.name);
                  setIsEditingName(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <h1 className="text-2xl font-headline font-bold flex items-center gap-2">
              {league.name}
              {isOwner && !isGlobal && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setIsEditingName(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </h1>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* League Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              League Info
              {isOwner && !isGlobal && (
                <Badge variant="secondary" className="gap-1">
                  <Crown className="h-3 w-3" />
                  Owner
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {league.memberUserIds.length} member{league.memberUserIds.length !== 1 && 's'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isGlobal && league.inviteCode && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Invite Code</label>
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                  <code className="font-mono text-lg font-bold tracking-widest flex-1">
                    {league.inviteCode}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copyInviteCode}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleRegenerateCode}
                      disabled={isRegenerating}
                    >
                      {isRegenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this code with friends to invite them to join.
                </p>
              </div>
            )}

            {!isGlobal && (
              <div className="flex gap-2 pt-4 border-t">
                {!isOwner && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
                        <UserMinus className="h-4 w-4" />
                        Leave League
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Leave League?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to leave "{league.name}"? You can rejoin later with an invite code.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleLeave}>Leave</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {isOwner && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="gap-2">
                        <Trash2 className="h-4 w-4" />
                        Delete League
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete League?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{league.name}"? This action cannot be undone and all members will be removed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Members Card */}
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} member{members.length !== 1 && 's'} in this league
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {members.map((member) => {
                  const isMemberOwner = member.id === league.ownerId;
                  const isCurrentUser = member.id === user?.id;

                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium">
                            {member.teamName.substring(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            {member.teamName}
                            {isMemberOwner && !isGlobal && (
                              <Crown className="h-4 w-4 text-yellow-500" />
                            )}
                            {isCurrentUser && (
                              <Badge variant="secondary" className="text-xs">You</Badge>
                            )}
                          </p>
                        </div>
                      </div>

                      {isOwner && !isGlobal && !isMemberOwner && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            >
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Member?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {member.teamName} from the league?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveMember(member.id, member.teamName)}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
