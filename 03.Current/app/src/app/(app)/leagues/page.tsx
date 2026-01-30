// GUID: PAGE_LEAGUES-000-v03
// [Intent] Leagues listing page — displays all leagues the current user belongs to as cards,
//   with dialogs to create a new league or join an existing one via invite code.
//   Shows league metadata (member count, invite code, owner badge) and provides leave/delete actions.
// [Inbound Trigger] User navigates to /leagues in the app layout.
// [Downstream Impact] Reads from league-context (which subscribes to Firestore "leagues" collection).
//   Calls createLeague, joinLeagueByCode, leaveLeague, deleteLeague from lib/leagues.
//   Navigation to /leagues/[leagueId] on view or after creation.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useAuth } from '@/firebase';
import { useLeague } from '@/contexts/league-context';
import { useToast } from '@/hooks/use-toast';
import { Globe, Users, Plus, LogIn, Copy, LogOut, Trash2, Crown, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { createLeague, joinLeagueByCode, leaveLeague, deleteLeague } from '@/lib/leagues';
import { GLOBAL_LEAGUE_ID } from '@/lib/types/league';

// GUID: PAGE_LEAGUES-001-v03
// [Intent] Main page component that renders the league listing grid with create/join dialogs,
//   leave/delete confirmations, and invite code copy functionality.
// [Inbound Trigger] Rendered by Next.js router when user visits /leagues.
// [Downstream Impact] Consumes useLeague context for league data, useAuth for current user, and lib/leagues
//   for all CRUD operations. Navigates to league detail page on creation or view.
export default function LeaguesPage() {
  const firestore = useFirestore();
  const { user } = useAuth();
  const { leagues, isLoading, setSelectedLeague } = useLeague();
  const { toast } = useToast();
  const router = useRouter();

  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selectedTeamForJoin, setSelectedTeamForJoin] = useState<'primary' | 'secondary'>('primary');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  const hasSecondaryTeam = !!user?.secondaryTeamName;

  // GUID: PAGE_LEAGUES-002-v03
  // [Intent] Creates a new league via Firestore and navigates to the new league detail page on success.
  // [Inbound Trigger] User submits the "Create a New League" dialog form.
  // [Downstream Impact] Calls createLeague from lib/leagues which writes to Firestore "leagues" collection.
  //   On success, navigates to /leagues/[leagueId]. Shows toast on success or failure.
  const handleCreate = async () => {
    if (!user || !createName.trim()) return;

    setIsCreating(true);
    const result = await createLeague(firestore, {
      name: createName.trim(),
      ownerId: user.id,
    });

    if (result.success) {
      toast({
        title: 'League Created',
        description: `Your league "${createName}" has been created.`,
      });
      setCreateName('');
      setCreateDialogOpen(false);
      // Navigate to the new league
      if (result.leagueId) {
        router.push(`/leagues/${result.leagueId}`);
      }
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to create league.',
      });
    }
    setIsCreating(false);
  };

  // GUID: PAGE_LEAGUES-003-v03
  // [Intent] Joins an existing league using a 6-character invite code, with support for primary or secondary team selection.
  // [Inbound Trigger] User submits the "Join a League" dialog form with a valid 6-character code.
  // [Downstream Impact] Calls joinLeagueByCode from lib/leagues which updates Firestore "leagues" document.
  //   Team ID format differs for secondary teams (userId-secondary). Shows toast on success or failure.
  const handleJoin = async () => {
    if (!user || !joinCode.trim()) return;

    setIsJoining(true);

    // Determine team ID based on selection
    const teamId = selectedTeamForJoin === 'secondary' && hasSecondaryTeam
      ? `${user.id}-secondary`
      : user.id;

    const result = await joinLeagueByCode(firestore, joinCode.trim(), user.id, teamId);

    if (result.success) {
      const teamName = selectedTeamForJoin === 'secondary' ? user.secondaryTeamName : user.teamName;
      toast({
        title: 'Joined League',
        description: `${teamName} has joined "${result.leagueName}".`,
      });
      setJoinCode('');
      setSelectedTeamForJoin('primary');
      setJoinDialogOpen(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to join league.',
      });
    }
    setIsJoining(false);
  };

  // GUID: PAGE_LEAGUES-004-v03
  // [Intent] Removes the current user from a league they are a member of (non-owners only).
  // [Inbound Trigger] User confirms the "Leave League?" alert dialog on a non-owned league card.
  // [Downstream Impact] Calls leaveLeague from lib/leagues which removes userId from Firestore league memberUserIds.
  const handleLeave = async (leagueId: string, leagueName: string) => {
    if (!user) return;

    const result = await leaveLeague(firestore, leagueId, user.id);

    if (result.success) {
      toast({
        title: 'Left League',
        description: `You have left "${leagueName}".`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to leave league.',
      });
    }
  };

  // GUID: PAGE_LEAGUES-005-v03
  // [Intent] Permanently deletes a league (owners only), removing all member associations.
  // [Inbound Trigger] User confirms the "Delete League?" alert dialog on an owned league card.
  // [Downstream Impact] Calls deleteLeague from lib/leagues which deletes the Firestore "leagues" document.
  //   All members lose access to the league immediately.
  const handleDelete = async (leagueId: string, leagueName: string) => {
    if (!user) return;

    const result = await deleteLeague(firestore, leagueId, user.id);

    if (result.success) {
      toast({
        title: 'League Deleted',
        description: `"${leagueName}" has been deleted.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to delete league.',
      });
    }
  };

  // GUID: PAGE_LEAGUES-006-v03
  // [Intent] Copies a league invite code to the clipboard and confirms via toast.
  // [Inbound Trigger] User clicks the copy button next to an invite code on a league card.
  // [Downstream Impact] Uses navigator.clipboard API; no Firestore interaction.
  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: 'Copied',
      description: 'Invite code copied to clipboard.',
    });
  };

  // GUID: PAGE_LEAGUES-007-v03
  // [Intent] Sets the selected league in context and navigates to the league detail page.
  // [Inbound Trigger] User clicks "View Details" button on a league card.
  // [Downstream Impact] Updates league-context selectedLeague (affects LeagueSelector across all pages)
  //   and navigates to /leagues/[leagueId].
  const handleViewLeague = (leagueId: string) => {
    const league = leagues.find(l => l.id === leagueId);
    if (league) {
      setSelectedLeague(league);
    }
    router.push(`/leagues/${leagueId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">
            My Leagues
          </h1>
          <p className="text-muted-foreground">
            Create private leagues with friends or join existing ones.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <LogIn className="h-4 w-4" />
                Join League
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join a League</DialogTitle>
                <DialogDescription>
                  Enter the 6-character invite code to join a league.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (joinCode.length === 6 && !isJoining) handleJoin();
                }}
                className="space-y-4 py-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="join-code">Invite Code</Label>
                  <Input
                    id="join-code"
                    placeholder="ABC123"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    className="font-mono text-lg tracking-widest"
                  />
                </div>
                {hasSecondaryTeam && (
                  <div className="space-y-2">
                    <Label>Join with team</Label>
                    <RadioGroup
                      value={selectedTeamForJoin}
                      onValueChange={(v) => setSelectedTeamForJoin(v as 'primary' | 'secondary')}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="primary" id="team-primary" />
                        <Label htmlFor="team-primary" className="font-normal cursor-pointer">
                          {user?.teamName} (Primary)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="secondary" id="team-secondary" />
                        <Label htmlFor="team-secondary" className="font-normal cursor-pointer">
                          {user?.secondaryTeamName} (Secondary)
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={isJoining || joinCode.length !== 6}>
                    {isJoining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Join
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Create League
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a New League</DialogTitle>
                <DialogDescription>
                  Create a private league and invite your friends to compete.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (createName.trim() && !isCreating) handleCreate();
                }}
                className="space-y-4 py-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="league-name">League Name</Label>
                  <Input
                    id="league-name"
                    placeholder="My Awesome League"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    maxLength={50}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isCreating || !createName.trim()}>
                    {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))
        ) : leagues.length > 0 ? (
          leagues.map((league) => {
            const isOwner = league.ownerId === user?.id;
            const isGlobal = league.isGlobal;

            return (
              <Card key={league.id} className="relative">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {isGlobal ? (
                        <Globe className="h-5 w-5 text-blue-500" />
                      ) : (
                        <Users className="h-5 w-5 text-green-500" />
                      )}
                      <div>
                        <CardTitle className="text-lg">{league.name}</CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          {league.memberUserIds.length} member{league.memberUserIds.length !== 1 && 's'}
                          {isOwner && !isGlobal && (
                            <Badge variant="secondary" className="gap-1">
                              <Crown className="h-3 w-3" />
                              Owner
                            </Badge>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!isGlobal && league.inviteCode && (
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                      <span className="text-xs text-muted-foreground">Invite:</span>
                      <code className="font-mono text-sm font-bold tracking-wider flex-1">
                        {league.inviteCode}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyInviteCode(league.inviteCode!)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleViewLeague(league.id)}
                    >
                      View Details
                    </Button>

                    {!isGlobal && !isOwner && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive">
                            <LogOut className="h-4 w-4" />
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
                            <AlertDialogAction onClick={() => handleLeave(league.id, league.name)}>
                              Leave
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    {!isGlobal && isOwner && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
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
                              onClick={() => handleDelete(league.id, league.name)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No Leagues Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create a league to compete with friends or join one with an invite code.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
