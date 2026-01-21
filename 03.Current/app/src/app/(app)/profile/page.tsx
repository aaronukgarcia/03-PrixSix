
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import React, { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useFirestore, addDocumentNonBlocking } from "@/firebase";
import { logAuditEvent } from "@/lib/audit";
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
import { generateTeamName } from "@/ai/flows/team-name-generator";
import { Frown, Wand2, AlertTriangle, User, Mail, Key, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { useSession } from "@/contexts/session-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const profileFormSchema = z.object({
  rankingChanges: z.boolean().default(false).optional(),
  raceReminders: z.boolean().default(true).optional(),
  newsFeed: z.boolean().default(false).optional(),
  resultsNotifications: z.boolean().default(true).optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const secondTeamSchema = z.object({
  teamName: z.string().min(3, "Team name must be at least 3 characters."),
});
type SecondTeamValues = z.infer<typeof secondTeamSchema>;

const changePinSchema = z.object({
  newPin: z.string().length(6, "PIN must be 6 digits."),
  confirmPin: z.string().length(6, "PIN must be 6 digits."),
}).refine(data => data.newPin === data.confirmPin, {
    message: "PINs do not match.",
    path: ["confirmPin"],
});
type ChangePinValues = z.infer<typeof changePinSchema>;


export default function ProfilePage() {
  const { user, logout, addSecondaryTeam, resetPin, changePin, firebaseUser, isEmailVerified, sendVerificationEmail, refreshEmailVerificationStatus } = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { sessionId } = useSession();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isRefreshingVerification, setIsRefreshingVerification] = useState(false);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      rankingChanges: user?.emailPreferences?.rankingChanges ?? true,
      raceReminders: user?.emailPreferences?.raceReminders ?? true,
      newsFeed: user?.emailPreferences?.newsFeed ?? false,
      resultsNotifications: user?.emailPreferences?.resultsNotifications ?? true,
    },
  });

  // Update form when user data loads
  useEffect(() => {
    if (user?.emailPreferences) {
      profileForm.reset({
        rankingChanges: user.emailPreferences.rankingChanges ?? true,
        raceReminders: user.emailPreferences.raceReminders ?? true,
        newsFeed: user.emailPreferences.newsFeed ?? false,
        resultsNotifications: user.emailPreferences.resultsNotifications ?? true,
      });
    }
  }, [user, profileForm]);

  const secondTeamForm = useForm<SecondTeamValues>({
    resolver: zodResolver(secondTeamSchema),
    defaultValues: {
      teamName: "",
    },
  });

  const changePinForm = useForm<ChangePinValues>({
      resolver: zodResolver(changePinSchema),
      defaultValues: {
          newPin: "",
          confirmPin: "",
      }
  });

  useEffect(() => {
    if (user?.secondaryTeamName) {
      secondTeamForm.setValue("teamName", user.secondaryTeamName);
    }
  }, [user, secondTeamForm]);


  async function onProfileSubmit(data: ProfileFormValues) {
    if (!firebaseUser || !firestore) return;

    try {
      const newPreferences = {
        rankingChanges: data.rankingChanges ?? true,
        raceReminders: data.raceReminders ?? true,
        newsFeed: data.newsFeed ?? false,
        resultsNotifications: data.resultsNotifications ?? true,
      };

      const userRef = doc(firestore, "users", firebaseUser.uid);
      await updateDoc(userRef, {
        emailPreferences: newPreferences,
      });

      // Audit log the preference update
      await logAuditEvent(firestore, firebaseUser.uid, 'UPDATE_EMAIL_PREFERENCES', {
        email: user?.email,
        teamName: user?.teamName,
        preferences: newPreferences,
        isAdmin: user?.isAdmin || false,
      });

      toast({
        title: "Preferences Updated",
        description: "Your notification settings have been saved.",
      });
    } catch (error) {
      console.error("Error saving preferences:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not save preferences. Please try again.",
      });
    }
  }
  
  async function handleRequestPin() {
    if (!user) return;
    const result = await resetPin(user.email);
    if(result.success) {
        toast({
            title: "New PIN Requested",
            description: `A new temporary PIN has been sent to ${user?.email}.`,
        });
    } else {
        toast({
            variant: "destructive",
            title: "Request Failed",
            description: result.message
        })
    }
  }

  function handleCloseAccount() {
    if (!firebaseUser || !firestore) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not close account. Please try again.",
      });
      return;
    }
    // Delete the presence document
    const presenceRef = doc(firestore, "presence", firebaseUser.uid);
    deleteDocumentNonBlocking(presenceRef);
    
    // Delete the user document
    const userRef = doc(firestore, "users", firebaseUser.uid);
    deleteDocumentNonBlocking(userRef);

    toast({
        title: "Account Closed",
        description: "Your account and all associated data have been removed.",
    });
    logout();
  }

  async function handleSuggestName() {
    if (!user?.teamName) return;
    setIsGenerating(true);
    try {
        const result = await generateTeamName({ existingTeamName: user.teamName });
        if (result.teamName) {
            secondTeamForm.setValue("teamName", result.teamName);
        }
    } catch (error) {
        console.error("Error generating team name:", error);
        toast({
            variant: "destructive",
            title: "Could not generate name",
            description: "There was an issue with the AI name generator. Please try again."
        });
    } finally {
        setIsGenerating(false);
    }
  }

  async function onSecondTeamSubmit(values: SecondTeamValues) {
    setIsCreating(true);
    try {
      const result = await addSecondaryTeam(values.teamName);
       if (result.success) {
            toast({
                title: "Second Team Created!",
                description: `Your second team, ${values.teamName}, is ready to race.`,
            });
        } else {
             toast({
                variant: "destructive",
                title: "Creation Failed",
                description: result.message,
            });
        }
    } catch(e: any) {
         toast({
            variant: "destructive",
            title: "Creation Failed",
            description: e.message,
        });
    } finally {
        setIsCreating(false);
    }
  }

  async function onChangePinSubmit(values: ChangePinValues) {
    if (!user) return;
    setIsChangingPin(true);
    try {
      const result = await changePin(user.email, values.newPin);
       if (result.success) {
            toast({
                title: "PIN Changed & Logged Out",
                description: "Your new PIN is set. For security, you have been logged out. Please sign in again.",
                duration: 8000,
            });
            changePinForm.reset();
        } else {
             toast({
                variant: "destructive",
                title: "PIN Change Failed",
                description: result.message,
            });
        }
    } catch(e: any) {
         toast({
            variant: "destructive",
            title: "PIN Change Failed",
            description: e.message,
        });
    } finally {
        setIsChangingPin(false);
    }
  }

  async function handleSendVerificationEmail() {
    setIsSendingVerification(true);
    try {
      const result = await sendVerificationEmail();
      if (result.success) {
        toast({
          title: "Verification Email Sent",
          description: "Please check your inbox and click the verification link.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Failed to Send",
          description: result.message,
        });
      }
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function handleRefreshVerificationStatus() {
    setIsRefreshingVerification(true);
    try {
      await refreshEmailVerificationStatus();
      if (isEmailVerified) {
        toast({
          title: "Email Verified!",
          description: "Your email address has been verified.",
        });
      } else {
        toast({
          title: "Not Yet Verified",
          description: "Please click the link in the verification email.",
        });
      }
    } finally {
      setIsRefreshingVerification(false);
    }
  }

  return (
    <div className="space-y-6">
        <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Profile & Settings</h1>
            <p className="text-muted-foreground">Manage your account and notification preferences.</p>
        </div>

        {/* Personal Information Card */}
        <Card>
            <CardHeader>
                <CardTitle>Your Profile</CardTitle>
                <CardDescription>Your account information and current session details.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-start gap-6">
                    <Avatar className="h-20 w-20">
                        <AvatarImage src={`https://picsum.photos/seed/${user?.id}/200/200`} data-ai-hint="person avatar"/>
                        <AvatarFallback className="text-2xl">{user?.teamName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    Team Name
                                </p>
                                <p className="text-lg font-semibold">{user?.teamName}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                    <Mail className="h-4 w-4" />
                                    Email Address
                                </p>
                                <p className="text-lg font-semibold">{user?.email}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  {isEmailVerified ? (
                                    <span className="flex items-center gap-1 text-sm text-green-600">
                                      <CheckCircle2 className="h-4 w-4" />
                                      Verified
                                    </span>
                                  ) : (
                                    <>
                                      <span className="flex items-center gap-1 text-sm text-yellow-600">
                                        <XCircle className="h-4 w-4" />
                                        Not verified
                                      </span>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleSendVerificationEmail}
                                        disabled={isSendingVerification}
                                        className="h-7 text-xs"
                                      >
                                        {isSendingVerification ? (
                                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                        ) : (
                                          <Mail className="mr-1 h-3 w-3" />
                                        )}
                                        Send verification
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleRefreshVerificationStatus}
                                        disabled={isRefreshingVerification}
                                        className="h-7 text-xs"
                                      >
                                        {isRefreshingVerification ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3 w-3" />
                                        )}
                                      </Button>
                                    </>
                                  )}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                <Key className="h-4 w-4" />
                                Session ID
                            </p>
                            <p className="font-mono text-sm text-muted-foreground bg-muted px-2 py-1 rounded inline-block">
                                {sessionId || 'Loading...'}
                            </p>
                        </div>
                        {user?.isAdmin && (
                            <div className="pt-2">
                                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                                    Administrator
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>

        {user?.mustChangePin && (
            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Action Required: Change Your PIN</AlertTitle>
                <AlertDescription>
                    For your security, you must change your temporary PIN before you can continue.
                </AlertDescription>
            </Alert>
        )}

      {!user?.mustChangePin && <Card>
          <CardHeader>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>Choose what you want to be notified about.</CardDescription>
          </CardHeader>
        <CardContent>
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-8">
              <FormField
                control={profileForm.control}
                name="rankingChanges"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Team Ranking Changes</FormLabel>
                      <FormDescription>
                        Receive an email when your rank changes after a race.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={profileForm.control}
                name="raceReminders"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Race Reminders</FormLabel>
                      <FormDescription>
                        Get a reminder before qualifying starts to submit your predictions.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={profileForm.control}
                name="newsFeed"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Hot News Feed</FormLabel>
                      <FormDescription>
                        Get the AI Hot News feed emailed to you before each race weekend.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={profileForm.control}
                name="resultsNotifications"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Race Results</FormLabel>
                      <FormDescription>
                        Receive an email when race results are submitted with your score.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit">Update preferences</Button>
            </form>
          </Form>
        </CardContent>
      </Card>}

      {!user?.mustChangePin && <Card>
        <CardHeader>
            <CardTitle>My Teams</CardTitle>
            <CardDescription>Manage your primary and secondary teams.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="rounded-lg border p-4">
              <h3 className="font-medium text-base">Primary Team: <span className="font-bold text-accent">{user?.teamName}</span></h3>
              <p className="text-sm text-muted-foreground">This is your main team for the season.</p>
           </div>
           
            <div className="rounded-lg border p-4 space-y-4">
              <h3 className="text-base font-medium">Secondary Team</h3>
              {user?.secondaryTeamName ? (
                <div>
                  <p>Your second team is <span className="font-bold text-accent">{user.secondaryTeamName}</span>.</p>
                </div>
              ) : (
                <Form {...secondTeamForm}>
                  <form onSubmit={secondTeamForm.handleSubmit(onSecondTeamSubmit)} className="space-y-4">
                     <p className="text-sm text-muted-foreground">Create a second team to compete with a different strategy.</p>
                     <FormField
                        control={secondTeamForm.control}
                        name="teamName"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel>Team Name</FormLabel>
                            <div className="flex gap-2">
                            <FormControl>
                                <Input placeholder="Your second team's name..." {...field} disabled={isGenerating || isCreating} />
                            </FormControl>
                            <Button type="button" variant="outline" onClick={handleSuggestName} aria-label="Suggest a team name" disabled={isGenerating || isCreating}>
                                {isGenerating ? <Skeleton className="h-4 w-4 animate-spin"/> : <Wand2 className="h-4 w-4" />}
                            </Button>
                            </div>
                            </FormItem>
                        )}
                        />
                      <Button type="submit" disabled={isGenerating || isCreating}>
                        {isCreating ? "Creating Team..." : "Create Second Team"}
                      </Button>
                  </form>
                </Form>
              )}
           </div>
        </CardContent>
      </Card>}
      
      <Card>
        <CardHeader>
            <CardTitle>Account Management</CardTitle>
            <CardDescription>Manage your sign-in and account status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
             <div className="rounded-lg border p-4 space-y-4">
                <h3 className="text-base font-medium">{user?.mustChangePin ? "Set Your New PIN" : "Change PIN"}</h3>
                 <Form {...changePinForm}>
                  <form onSubmit={changePinForm.handleSubmit(onChangePinSubmit)} className="space-y-4">
                      <FormField
                        control={changePinForm.control}
                        name="newPin"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>New 6-Digit PIN</FormLabel>
                                <FormControl>
                                    <Input type="password" placeholder="••••••" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                         <FormField
                        control={changePinForm.control}
                        name="confirmPin"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Confirm New PIN</FormLabel>
                                <FormControl>
                                    <Input type="password" placeholder="••••••" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                      <Button type="submit" disabled={isChangingPin}>
                        {isChangingPin ? "Saving..." : (user?.mustChangePin ? "Set New PIN" : "Change PIN")}
                      </Button>
                  </form>
                </Form>
            </div>
            {!user?.mustChangePin && <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-destructive/50 p-4">
                <div>
                    <h3 className="text-base font-medium text-destructive">Close Account</h3>
                    <p className="text-sm text-muted-foreground">Permanently delete your account and all of your data.</p>
                </div>
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="mt-2 sm:mt-0">Close Account</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete your
                            account and remove your data from our servers.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCloseAccount}>Continue</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>}
        </CardContent>
      </Card>

    </div>
  );
}
