
// GUID: ADMIN_TEAM-000-v04
// @SECURITY_FIX: Added input validation for team name changes (ADMINCOMP-022).
// [Intent] Admin component for managing user teams: view, edit, delete, toggle admin status, and unlock locked accounts.
// [Inbound Trigger] Rendered within the admin panel when the "Teams" tab is selected.
// [Downstream Impact] Modifies user records in Firestore via useAuth() hooks. Changes to team name, email, admin status, and account lock state propagate to all user-facing components.

"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/firebase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Shield, Trash2, Lock, Unlock } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import type { User } from "@/firebase/provider";
import { Skeleton } from "@/components/ui/skeleton";


// GUID: ADMIN_TEAM-001-v03
// [Intent] Defines the props contract for TeamManager, requiring the full user list and its loading state.
// [Inbound Trigger] Passed from the parent admin page which fetches all users.
// [Downstream Impact] The component cannot render meaningful content without allUsers; isUserLoading controls skeleton display.
interface TeamManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

// GUID: ADMIN_TEAM-002-v03
// [Intent] Main TeamManager component that renders a table of all users with edit, admin toggle, and delete actions.
// [Inbound Trigger] Rendered by the admin page when the Teams management tab is active.
// [Downstream Impact] All user mutations (edit, delete, admin toggle, unlock) flow through useAuth() hooks which update Firestore user documents.
export function TeamManager({ allUsers, isUserLoading }: TeamManagerProps) {
    const { toast } = useToast();
    const { updateUser, deleteUser } = useAuth();

    // GUID: ADMIN_TEAM-003-v03
    // [Intent] Local state for the edit dialog: tracks which user is selected and what editable fields contain.
    // [Inbound Trigger] Populated when handleEditClick is called with a user row.
    // [Downstream Impact] These values are written to Firestore when handleSaveChanges is invoked.
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [editedTeamName, setEditedTeamName] = useState("");
    const [editedEmail, setEditedEmail] = useState("");
    const [editedIsAdmin, setEditedIsAdmin] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // GUID: ADMIN_TEAM-004-v03
    // [Intent] Opens the edit dialog and pre-populates form fields with the selected user's current data.
    // [Inbound Trigger] Clicking the Edit (pencil) icon button on a user row.
    // [Downstream Impact] Sets selectedUser and form state; the Dialog component becomes visible.
    const handleEditClick = (user: User) => {
        setSelectedUser(user);
        setEditedTeamName(user.teamName);
        setEditedEmail(user.email);
        setEditedIsAdmin(user.isAdmin);
        setIsEditDialogOpen(true);
    };

    // GUID: ADMIN_TEAM-005-v04
    // @SECURITY_FIX: Added input validation for team names (ADMINCOMP-022).
    //   Validates length (2-50 chars), trims whitespace, blocks dangerous characters.
    // [Intent] Persists edited user fields (teamName, email, isAdmin) to Firestore and closes the dialog.
    // [Inbound Trigger] Clicking the "Save changes" button in the edit dialog.
    // [Downstream Impact] Updates the user document in Firestore; all components consuming user data will reflect changes on next read.
    const handleSaveChanges = async () => {
        if (!selectedUser) return;

        // SECURITY: Validate team name input (ADMINCOMP-022 fix)
        const trimmedTeamName = editedTeamName.trim();

        if (!trimmedTeamName) {
            toast({ variant: "destructive", title: "Validation Error", description: "Team name cannot be empty" });
            return;
        }

        if (trimmedTeamName.length < 2) {
            toast({ variant: "destructive", title: "Validation Error", description: "Team name must be at least 2 characters" });
            return;
        }

        if (trimmedTeamName.length > 50) {
            toast({ variant: "destructive", title: "Validation Error", description: "Team name must be 50 characters or less" });
            return;
        }

        // Check for dangerous characters that could cause issues
        const dangerousChars = /[<>{}[\]\\]/;
        if (dangerousChars.test(trimmedTeamName)) {
            toast({ variant: "destructive", title: "Validation Error", description: "Team name contains invalid characters (<>{}[]\\)" });
            return;
        }

        setIsSaving(true);
        const result = await updateUser(selectedUser.id, {
            teamName: trimmedTeamName,
            email: editedEmail,
            isAdmin: editedIsAdmin,
        });

        if (result.success) {
            toast({ title: "Team Updated", description: `${editedTeamName}'s details have been saved.` });
        } else {
            toast({ variant: "destructive", title: "Update Failed", description: result.message });
        }

        setIsSaving(false);
        setIsEditDialogOpen(false);
        setSelectedUser(null);
    };

    // GUID: ADMIN_TEAM-006-v03
    // [Intent] Toggles a user's admin status between admin and regular user.
    // [Inbound Trigger] Clicking the Shield icon button on a user row.
    // [Downstream Impact] Changes the isAdmin field in Firestore; affects the user's access to admin pages and features.
    const handleToggleAdmin = async (user: User) => {
        const result = await updateUser(user.id, { isAdmin: !user.isAdmin });
         if (result.success) {
            toast({ title: "Admin Status Changed", description: `${user.teamName} is ${user.isAdmin ? "no longer" : "now"} an admin.` });
        } else {
            toast({ variant: "destructive", title: "Update Failed", description: result.message });
        }
    };

    // GUID: ADMIN_TEAM-007-v03
    // [Intent] Permanently deletes a user and all their data from the system.
    // [Inbound Trigger] Clicking "Delete" in the confirmation AlertDialog after pressing the Trash icon.
    // [Downstream Impact] Removes the user document from Firestore. Irreversible action that affects standings, predictions, and team references.
    const handleDeleteUser = async (userId: string) => {
        const userToDelete = allUsers?.find(u => u.id === userId);
        const result = await deleteUser(userId);
         if (result.success && userToDelete) {
             toast({ variant: "destructive", title: "Team Deleted", description: `${userToDelete.teamName} has been removed.` });
        } else {
            toast({ variant: "destructive", title: "Delete Failed", description: result.message });
        }
    };

    // GUID: ADMIN_TEAM-008-v03
    // [Intent] Resets a locked user's badLoginAttempts counter to zero, unlocking their account.
    // [Inbound Trigger] Clicking the "Unlock Account" button in the edit dialog for a locked user (badLoginAttempts >= 5).
    // [Downstream Impact] Sets badLoginAttempts to 0 in Firestore, allowing the user to log in again.
    const handleUnlockUser = async () => {
        if (!selectedUser) return;
        setIsSaving(true);
        const result = await updateUser(selectedUser.id, { badLoginAttempts: 0 });
        if (result.success) {
            toast({ title: "Account Unlocked", description: `${selectedUser.teamName}'s account has been unlocked.` });
        } else {
            toast({ variant: "destructive", title: "Unlock Failed", description: result.message });
        }
        setIsSaving(false);
        setIsEditDialogOpen(false);
    }

    // GUID: ADMIN_TEAM-009-v03
    // [Intent] Renders the team management UI: a table of users with action buttons and an edit dialog.
    // [Inbound Trigger] Component render cycle; displays skeleton rows while isUserLoading is true.
    // [Downstream Impact] Provides the visual interface for all team management operations (edit, admin toggle, delete, unlock).
    return (
        <Card>
            <CardHeader>
                <CardTitle>Manage Teams</CardTitle>
                <CardDescription>View, edit, or remove teams from the league.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Team Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isUserLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                                    <TableCell className="text-right"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                                </TableRow>
                            ))
                        ) : allUsers?.map((user) => (
                            <TableRow key={user.id}>
                                <TableCell className="font-medium">{user.teamName}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>
                                    <Badge variant={user.isAdmin ? "default" : "secondary"}>
                                        {user.isAdmin ? "Admin" : "User"}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                     {(user.badLoginAttempts || 0) >= 5 ? (
                                        <Badge variant="destructive">
                                            <Lock className="mr-1 h-3 w-3" />
                                            Locked
                                        </Badge>
                                     ) : (
                                        <Badge variant="secondary">Active</Badge>
                                     )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end items-center gap-2">
                                        <Button variant="ghost" size="icon" onClick={() => handleEditClick(user)}>
                                            <Edit className="h-4 w-4"/>
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleAdmin(user)}>
                                            <Shield className="h-4 w-4"/>
                                        </Button>
                                         <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This action cannot be undone. This will permanently delete the team
                                                    and all their data.
                                                </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteUser(user.id)}>Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit {selectedUser?.teamName}</DialogTitle>
                            <DialogDescription>
                                Make changes to the user's profile here. Click save when you're done.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="teamName" className="text-right">Team Name</Label>
                                <Input id="teamName" value={editedTeamName} onChange={(e) => setEditedTeamName(e.target.value)} className="col-span-3" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="email" className="text-right">Email</Label>
                                <Input id="email" value={editedEmail} onChange={(e) => setEditedEmail(e.target.value)} className="col-span-3" />
                            </div>
                             <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="isAdmin" className="text-right">Admin</Label>
                                <Switch id="isAdmin" checked={editedIsAdmin} onCheckedChange={setEditedIsAdmin} />
                            </div>
                             {(selectedUser?.badLoginAttempts || 0) >= 5 && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right text-destructive">Account Locked</Label>
                                    <div className="col-span-3">
                                        <Button variant="outline" onClick={handleUnlockUser} disabled={isSaving}>
                                            <Unlock className="mr-2 h-4 w-4"/>
                                            Unlock Account
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleSaveChanges} disabled={isSaving}>
                                {isSaving ? "Saving..." : "Save changes"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            </CardContent>
        </Card>
    );
}
