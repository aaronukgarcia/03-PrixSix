
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


interface TeamManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

export function TeamManager({ allUsers, isUserLoading }: TeamManagerProps) {
    const { toast } = useToast();
    const { updateUser, deleteUser } = useAuth();
    
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [editedTeamName, setEditedTeamName] = useState("");
    const [editedEmail, setEditedEmail] = useState("");
    const [editedIsAdmin, setEditedIsAdmin] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleEditClick = (user: User) => {
        setSelectedUser(user);
        setEditedTeamName(user.teamName);
        setEditedEmail(user.email);
        setEditedIsAdmin(user.isAdmin);
        setIsEditDialogOpen(true);
    };

    const handleSaveChanges = async () => {
        if (!selectedUser) return;
        setIsSaving(true);
        const result = await updateUser(selectedUser.id, {
            teamName: editedTeamName,
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
    
    const handleToggleAdmin = async (user: User) => {
        const result = await updateUser(user.id, { isAdmin: !user.isAdmin });
         if (result.success) {
            toast({ title: "Admin Status Changed", description: `${user.teamName} is ${user.isAdmin ? "no longer" : "now"} an admin.` });
        } else {
            toast({ variant: "destructive", title: "Update Failed", description: result.message });
        }
    };

    const handleDeleteUser = async (userId: string) => {
        const userToDelete = allUsers?.find(u => u.id === userId);
        const result = await deleteUser(userId);
         if (result.success && userToDelete) {
             toast({ variant: "destructive", title: "Team Deleted", description: `${userToDelete.teamName} has been removed.` });
        } else {
            toast({ variant: "destructive", title: "Delete Failed", description: result.message });
        }
    };
    
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
