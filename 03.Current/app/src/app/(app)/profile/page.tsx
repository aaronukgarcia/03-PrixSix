
// GUID: PAGE_PROFILE-000-v03
// [Intent] Profile & Settings page — allows users to manage their account, notification preferences,
//   secondary email, secondary team, profile photo, PIN, email verification, and account closure.
// [Inbound Trigger] Navigation to /profile route by authenticated user.
// [Downstream Impact] Changes propagate to Firestore users collection (emailPreferences, photoUrl,
//   secondaryTeamName, secondaryEmail), Firebase Auth (verification, PIN), and audit_log collection.

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
import { useAuth, useFirestore, useStorage, addDocumentNonBlocking } from "@/firebase";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generateTeamName } from "@/ai/flows/team-name-generator";
import { Frown, Wand2, AlertTriangle, User, Mail, Key, CheckCircle2, XCircle, Loader2, RefreshCw, Camera, X, Upload, Trash2, Link2, Unlink } from "lucide-react";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";
import { validateImageFile, uploadProfilePhoto, compressImage, type UploadProgress } from "@/lib/file-upload";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { collection, deleteDoc, deleteField, doc, updateDoc } from "firebase/firestore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { deleteDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { useSession } from "@/contexts/session-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// GUID: PAGE_PROFILE-001-v03
// [Intent] Zod schema for email notification preferences form validation.
// [Inbound Trigger] Used by react-hook-form to validate the notification preferences form.
// [Downstream Impact] Controls shape of data written to users/{uid}/emailPreferences in Firestore.
const profileFormSchema = z.object({
  rankingChanges: z.boolean().default(false).optional(),
  raceReminders: z.boolean().default(true).optional(),
  newsFeed: z.boolean().default(false).optional(),
  resultsNotifications: z.boolean().default(true).optional(),
});

// GUID: PAGE_PROFILE-002-v03
// [Intent] TypeScript type inferred from profileFormSchema for type-safe form handling.
// [Inbound Trigger] Used by useForm<ProfileFormValues> and onProfileSubmit handler.
// [Downstream Impact] None — type-only artifact.
type ProfileFormValues = z.infer<typeof profileFormSchema>;

// GUID: PAGE_PROFILE-003-v03
// [Intent] Zod schema for the secondary team name form — enforces minimum 3-character name.
// [Inbound Trigger] Used by react-hook-form to validate secondary team creation.
// [Downstream Impact] Controls the teamName value passed to addSecondaryTeam auth function.
const secondTeamSchema = z.object({
  teamName: z.string().min(3, "Team name must be at least 3 characters."),
});
type SecondTeamValues = z.infer<typeof secondTeamSchema>;

// GUID: PAGE_PROFILE-004-v03
// [Intent] Zod schema for PIN change form — enforces 6-digit length and match between new/confirm.
// [Inbound Trigger] Used by react-hook-form to validate the Change PIN form.
// [Downstream Impact] Controls values passed to changePin auth function; mismatch triggers FormMessage.
const changePinSchema = z.object({
  newPin: z.string().length(6, "PIN must be 6 digits."),
  confirmPin: z.string().length(6, "PIN must be 6 digits."),
}).refine(data => data.newPin === data.confirmPin, {
    message: "PINs do not match.",
    path: ["confirmPin"],
});
type ChangePinValues = z.infer<typeof changePinSchema>;


// GUID: PAGE_PROFILE-005-v03
// [Intent] Main Profile page component — renders all profile management cards and handles all
//   user account actions (preferences, photo, teams, PIN, verification, account closure).
// [Inbound Trigger] React Router renders this component when user navigates to /profile.
// [Downstream Impact] Writes to Firestore users collection, Firebase Auth, audit_log. Calls
//   multiple auth context functions (logout, addSecondaryTeam, resetPin, changePin, etc.).
export default function ProfilePage() {
  const { user, logout, addSecondaryTeam, resetPin, changePin, firebaseUser, isEmailVerified, sendVerificationEmail, refreshEmailVerificationStatus, updateSecondaryEmail, sendSecondaryVerificationEmail, linkGoogle, linkApple, unlinkProvider } = useAuth();
  const firestore = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  const { sessionId } = useSession();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRemovingTeam, setIsRemovingTeam] = useState(false);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isRefreshingVerification, setIsRefreshingVerification] = useState(false);
  const [isPhotoDialogOpen, setIsPhotoDialogOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [secondaryEmailInput, setSecondaryEmailInput] = useState("");
  const [isSavingSecondaryEmail, setIsSavingSecondaryEmail] = useState(false);
  const [isSendingSecondaryVerification, setIsSendingSecondaryVerification] = useState(false);
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const [isLinkingApple, setIsLinkingApple] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState<string | null>(null);

  // GUID: PAGE_PROFILE-006-v03
  // [Intent] Initialise notification preferences form with user's saved values or sensible defaults.
  // [Inbound Trigger] Component mount; re-initialises when user data changes.
  // [Downstream Impact] Populates the profileForm used in the Email Notifications card.
  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      rankingChanges: user?.emailPreferences?.rankingChanges ?? true,
      raceReminders: user?.emailPreferences?.raceReminders ?? true,
      newsFeed: user?.emailPreferences?.newsFeed ?? false,
      resultsNotifications: user?.emailPreferences?.resultsNotifications ?? true,
    },
  });

  // GUID: PAGE_PROFILE-007-v03
  // [Intent] Reset form values when user data loads or changes (e.g. after Firestore round-trip).
  // [Inbound Trigger] user or user.emailPreferences changes.
  // [Downstream Impact] Keeps form controls in sync with persisted preferences.
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

  // GUID: PAGE_PROFILE-008-v03
  // [Intent] Initialise secondary team form with existing secondary team name if one exists.
  // [Inbound Trigger] Component mount; re-initialises when user data changes.
  // [Downstream Impact] Pre-fills the team name input in the secondary team card.
  const secondTeamForm = useForm<SecondTeamValues>({
    resolver: zodResolver(secondTeamSchema),
    defaultValues: {
      teamName: "",
    },
  });

  // GUID: PAGE_PROFILE-009-v03
  // [Intent] Initialise change PIN form with empty defaults.
  // [Inbound Trigger] Component mount.
  // [Downstream Impact] Provides controlled inputs for the PIN change card.
  const changePinForm = useForm<ChangePinValues>({
      resolver: zodResolver(changePinSchema),
      defaultValues: {
          newPin: "",
          confirmPin: "",
      }
  });

  // GUID: PAGE_PROFILE-010-v03
  // [Intent] Sync secondary team name into form when user data loads.
  // [Inbound Trigger] user.secondaryTeamName changes.
  // [Downstream Impact] Pre-fills the secondary team name input field.
  useEffect(() => {
    if (user?.secondaryTeamName) {
      secondTeamForm.setValue("teamName", user.secondaryTeamName);
    }
  }, [user, secondTeamForm]);

  // GUID: PAGE_PROFILE-011-v03
  // [Intent] Sync secondary email into local state when user data loads.
  // [Inbound Trigger] user.secondaryEmail changes.
  // [Downstream Impact] Pre-fills the secondary email input field.
  useEffect(() => {
    if (user?.secondaryEmail) {
      setSecondaryEmailInput(user.secondaryEmail);
    } else {
      setSecondaryEmailInput("");
    }
  }, [user?.secondaryEmail]);


  // GUID: PAGE_PROFILE-012-v03
  // [Intent] Save notification preferences to Firestore and log audit event.
  // [Inbound Trigger] User submits the Email Notifications form.
  // [Downstream Impact] Updates users/{uid}.emailPreferences in Firestore; writes audit log entry.
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

  // GUID: PAGE_PROFILE-013-v03
  // [Intent] Request a new temporary PIN to be emailed to the user.
  // [Inbound Trigger] User clicks the "Request New PIN" action.
  // [Downstream Impact] Calls resetPin auth function which emails a temporary PIN.
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

  // GUID: PAGE_PROFILE-014-v03
  // [Intent] Permanently close the user's account by deleting presence and user documents, then logging out.
  // [Inbound Trigger] User confirms the "Close Account" alert dialog.
  // [Downstream Impact] Deletes presence/{uid} and users/{uid} from Firestore; triggers logout.
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

  // GUID: PAGE_PROFILE-015-v03
  // [Intent] Use AI to suggest a fun secondary team name based on the user's primary team name.
  // [Inbound Trigger] User clicks the wand/suggest button next to the secondary team name input.
  // [Downstream Impact] Sets the secondTeamForm teamName field to the AI-generated suggestion.
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

  // GUID: PAGE_PROFILE-016-v03
  // [Intent] Create the user's secondary team via the auth context function.
  // [Inbound Trigger] User submits the secondary team creation form.
  // [Downstream Impact] Calls addSecondaryTeam which writes secondaryTeamName to Firestore users doc.
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

  // GUID: PAGE_PROFILE-017-v03
  // [Intent] Change the user's PIN and force re-login for security.
  // [Inbound Trigger] User submits the Change PIN form with matching new/confirm PINs.
  // [Downstream Impact] Calls changePin auth function; on success resets form and logs user out.
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

  // GUID: PAGE_PROFILE-018-v03
  // [Intent] Send a verification email to the user's primary email address.
  // [Inbound Trigger] User clicks "Send verification" button next to unverified email.
  // [Downstream Impact] Triggers Firebase email verification flow via sendVerificationEmail auth function.
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

  // GUID: PAGE_PROFILE-019-v03
  // [Intent] Refresh the email verification status from Firebase Auth.
  // [Inbound Trigger] User clicks the refresh icon next to unverified email status.
  // [Downstream Impact] Updates isEmailVerified state via refreshEmailVerificationStatus auth function.
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

  // GUID: PAGE_PROFILE-020-v03
  // [Intent] Save or update the user's secondary email address.
  // [Inbound Trigger] User clicks "Save" button next to the secondary email input.
  // [Downstream Impact] Calls updateSecondaryEmail auth function; writes to Firestore users doc.
  async function handleSaveSecondaryEmail() {
    if (!secondaryEmailInput.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid Email",
        description: "Please enter a valid email address.",
      });
      return;
    }

    setIsSavingSecondaryEmail(true);
    try {
      const result = await updateSecondaryEmail(secondaryEmailInput.trim());
      if (result.success) {
        toast({
          title: "Secondary Email Updated",
          description: result.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Update Failed",
          description: result.message,
        });
      }
    } finally {
      setIsSavingSecondaryEmail(false);
    }
  }

  // GUID: PAGE_PROFILE-021-v03
  // [Intent] Remove the user's secondary email by passing null to the update function.
  // [Inbound Trigger] User clicks "Remove" button next to the secondary email input.
  // [Downstream Impact] Clears secondaryEmail field in Firestore users doc via updateSecondaryEmail.
  async function handleRemoveSecondaryEmail() {
    setIsSavingSecondaryEmail(true);
    try {
      const result = await updateSecondaryEmail(null);
      if (result.success) {
        setSecondaryEmailInput("");
        toast({
          title: "Secondary Email Removed",
          description: "Your secondary email has been removed.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Removal Failed",
          description: result.message,
        });
      }
    } finally {
      setIsSavingSecondaryEmail(false);
    }
  }

  // GUID: PAGE_PROFILE-022-v03
  // [Intent] Remove the user's secondary team by deleting the secondaryTeamName field from Firestore.
  // [Inbound Trigger] User confirms the "Remove Secondary Team" alert dialog.
  // [Downstream Impact] Deletes secondaryTeamName from users/{uid}; writes audit log entry.
  async function handleRemoveSecondaryTeam() {
    if (!firestore || !user) return;
    setIsRemovingTeam(true);
    try {
      await updateDoc(doc(firestore, "users", user.id), {
        secondaryTeamName: deleteField(),
      });
      await logAuditEvent(firestore, {
        userId: user.id,
        action: "REMOVE_SECONDARY_TEAM",
        details: `Removed secondary team`,
        sessionId,
      });
      toast({
        title: "Secondary Team Removed",
        description: "Your secondary team has been removed.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Removal Failed",
        description: error.message || "Failed to remove secondary team",
      });
    } finally {
      setIsRemovingTeam(false);
    }
  }

  // GUID: PAGE_PROFILE-023-v03
  // [Intent] Send a verification email to the user's secondary email address.
  // [Inbound Trigger] User clicks "Send verification" next to unverified secondary email status.
  // [Downstream Impact] Triggers secondary email verification flow via sendSecondaryVerificationEmail.
  async function handleSendSecondaryVerification() {
    setIsSendingSecondaryVerification(true);
    try {
      const result = await sendSecondaryVerificationEmail();
      if (result.success) {
        toast({
          title: "Verification Email Sent",
          description: "Please check your secondary inbox and click the verification link.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Failed to Send",
          description: result.message,
        });
      }
    } finally {
      setIsSendingSecondaryVerification(false);
    }
  }

  // GUID: PAGE_PROFILE-024-v03
  // [Intent] Save a profile photo URL (from manual entry or preset selection) to Firestore.
  // [Inbound Trigger] User clicks "Save Photo" in the photo dialog after entering a URL or choosing a preset.
  // [Downstream Impact] Updates users/{uid}.photoUrl in Firestore; writes audit log entry.
  async function handleSavePhoto() {
    if (!firebaseUser || !firestore) return;
    setIsSavingPhoto(true);
    try {
      const userRef = doc(firestore, "users", firebaseUser.uid);
      const newPhotoUrl = photoUrl.trim() || null;
      await updateDoc(userRef, { photoUrl: newPhotoUrl });

      await logAuditEvent(firestore, firebaseUser.uid, 'UPDATE_PROFILE_PHOTO', {
        email: user?.email,
        teamName: user?.teamName,
        photoUrl: newPhotoUrl,
      });

      toast({
        title: "Photo Updated",
        description: newPhotoUrl ? "Your profile photo has been changed." : "Your profile photo has been removed.",
      });
      setIsPhotoDialogOpen(false);
    } catch (error) {
      console.error("Error saving photo:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not save photo. Please try again.",
      });
    } finally {
      setIsSavingPhoto(false);
    }
  }

  // GUID: PAGE_PROFILE-025-v03
  // [Intent] Handle file upload for profile photo — validates, compresses, uploads to Firebase Storage,
  //   then updates Firestore with the download URL.
  // [Inbound Trigger] User selects a file via the file input in the photo dialog.
  // [Downstream Impact] Writes compressed image to Firebase Storage; updates users/{uid}.photoUrl;
  //   writes audit log entry.
  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !firebaseUser || !storage) return;

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast({
        variant: "destructive",
        title: "Invalid File",
        description: validation.error,
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress({ progress: 0, state: 'running' });

    try {
      // Compress image before uploading
      const compressedFile = await compressImage(file, 400, 0.85);

      // Upload to Firebase Storage
      const downloadUrl = await uploadProfilePhoto(
        storage,
        firebaseUser.uid,
        compressedFile,
        (progress) => setUploadProgress(progress)
      );

      // Update Firestore with the new URL
      const userRef = doc(firestore, "users", firebaseUser.uid);
      await updateDoc(userRef, { photoUrl: downloadUrl });

      await logAuditEvent(firestore, firebaseUser.uid, 'UPDATE_PROFILE_PHOTO', {
        email: user?.email,
        teamName: user?.teamName,
        photoUrl: downloadUrl,
        source: 'file_upload',
      });

      // Update local state
      setPhotoUrl(downloadUrl);

      toast({
        title: "Photo Uploaded",
        description: "Your profile photo has been updated.",
      });
      setIsPhotoDialogOpen(false);
    } catch (error: any) {
      console.error("Error uploading photo:", error);
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message || "Could not upload photo. Please try again.",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      // Reset file input
      event.target.value = '';
    }
  }

  // GUID: PAGE_PROFILE-028-v03
  // [Intent] Link Google account to current user from profile page.
  // [Inbound Trigger] User clicks "Link" button next to Google in Linked Sign-In Methods card.
  // [Downstream Impact] Calls linkGoogle from provider; updates providers array via onAuthStateChanged.
  async function handleLinkGoogle() {
    setIsLinkingGoogle(true);
    try {
      const result = await linkGoogle();
      toast({
        variant: result.success ? "default" : "destructive",
        title: result.success ? "Google Linked" : "Link Failed",
        description: result.message,
      });
    } finally {
      setIsLinkingGoogle(false);
    }
  }

  // GUID: PAGE_PROFILE-029-v03
  // [Intent] Link Apple account to current user from profile page.
  // [Inbound Trigger] User clicks "Link" button next to Apple in Linked Sign-In Methods card.
  // [Downstream Impact] Calls linkApple from provider.
  async function handleLinkApple() {
    setIsLinkingApple(true);
    try {
      const result = await linkApple();
      toast({
        variant: result.success ? "default" : "destructive",
        title: result.success ? "Apple Linked" : "Link Failed",
        description: result.message,
      });
    } finally {
      setIsLinkingApple(false);
    }
  }

  // GUID: PAGE_PROFILE-030-v03
  // [Intent] Unlink a provider from the current user, preventing unlinking the last provider.
  // [Inbound Trigger] User clicks "Unlink" button next to a linked provider.
  // [Downstream Impact] Removes provider from Firebase Auth providerData; synced to Firestore.
  async function handleUnlinkProvider(providerId: string) {
    const providers = user?.providers || [];
    if (providers.length <= 1) {
      toast({
        variant: "destructive",
        title: "Cannot Unlink",
        description: "You must have at least one sign-in method linked to your account.",
      });
      return;
    }

    setIsUnlinking(providerId);
    try {
      const result = await unlinkProvider(providerId);
      toast({
        variant: result.success ? "default" : "destructive",
        title: result.success ? "Provider Unlinked" : "Unlink Failed",
        description: result.message,
      });
    } finally {
      setIsUnlinking(null);
    }
  }

  // GUID: PAGE_PROFILE-026-v03
  // [Intent] Preset avatar options generated from external avatar services using the user's ID/team name.
  // [Inbound Trigger] Computed on render; displayed in the profile photo dialog.
  // [Downstream Impact] Selected URL is set into photoUrl state and saved via handleSavePhoto.
  const presetAvatars = [
    `https://picsum.photos/seed/${user?.id}/200/200`,
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.teamName || 'User')}`,
    `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.id}`,
    `https://api.dicebear.com/7.x/pixel-art/svg?seed=${user?.id}`,
    `https://api.dicebear.com/7.x/thumbs/svg?seed=${user?.id}`,
    `https://api.dicebear.com/7.x/shapes/svg?seed=${user?.id}`,
  ];

  // GUID: PAGE_PROFILE-027-v03
  // [Intent] Derive the current avatar URL — user's saved photo or a fallback generated avatar.
  // [Inbound Trigger] Computed on render from user state.
  // [Downstream Impact] Displayed as the profile avatar in the Personal Information card.
  const currentAvatarUrl = user?.photoUrl || `https://picsum.photos/seed/${user?.id}/200/200`;

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
                    <Dialog open={isPhotoDialogOpen} onOpenChange={(open) => {
                      setIsPhotoDialogOpen(open);
                      if (open) setPhotoUrl(user?.photoUrl || "");
                    }}>
                      <DialogTrigger asChild>
                        <button className="relative group cursor-pointer">
                          <Avatar className="h-20 w-20 transition-opacity group-hover:opacity-75">
                            <AvatarImage src={currentAvatarUrl} data-ai-hint="person avatar"/>
                            <AvatarFallback className="text-2xl">{user?.teamName?.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/60 rounded-full p-2">
                              <Camera className="h-5 w-5 text-white" />
                            </div>
                          </div>
                        </button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Change Profile Photo</DialogTitle>
                          <DialogDescription>
                            Enter a URL for your profile photo or choose from a preset.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="flex justify-center">
                            <Avatar className="h-24 w-24">
                              <AvatarImage src={photoUrl || currentAvatarUrl} />
                              <AvatarFallback className="text-3xl">{user?.teamName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                          </div>

                          {/* File Upload Section */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Upload a photo</label>
                            <div className="flex gap-2">
                              <Input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={handleFileUpload}
                                disabled={isUploading || isSavingPhoto}
                                className="cursor-pointer file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">JPG, PNG, or WebP. Max 5MB.</p>
                            {isUploading && uploadProgress && (
                              <div className="space-y-1">
                                <Progress value={uploadProgress.progress} className="h-2" />
                                <p className="text-xs text-muted-foreground text-center">
                                  Uploading... {Math.round(uploadProgress.progress)}%
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                              <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                              <span className="bg-background px-2 text-muted-foreground">Or</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-medium">Enter image URL</label>
                            <div className="flex gap-2">
                              <Input
                                placeholder="https://example.com/photo.jpg"
                                value={photoUrl}
                                onChange={(e) => setPhotoUrl(e.target.value)}
                                disabled={isUploading}
                              />
                              {photoUrl && (
                                <Button variant="ghost" size="icon" onClick={() => setPhotoUrl("")} disabled={isUploading}>
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Or choose a preset</label>
                            <div className="grid grid-cols-6 gap-2">
                              {presetAvatars.map((url, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setPhotoUrl(url)}
                                  disabled={isUploading}
                                  className={`rounded-full overflow-hidden border-2 transition-all ${photoUrl === url ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-muted-foreground/50'} ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                  <Avatar className="h-10 w-10">
                                    <AvatarImage src={url} />
                                    <AvatarFallback>{idx + 1}</AvatarFallback>
                                  </Avatar>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsPhotoDialogOpen(false)} disabled={isUploading}>
                            Cancel
                          </Button>
                          <Button onClick={handleSavePhoto} disabled={isSavingPhoto || isUploading}>
                            {isSavingPhoto ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Save Photo
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
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

        {/* Secondary Email Card */}
        {!user?.mustChangePin && (
          <Card>
            <CardHeader>
              <CardTitle>Secondary Email</CardTitle>
              <CardDescription>
                Add a secondary email to receive communications at both addresses. Secondary email is for notifications only and cannot be used for login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="secondary@example.com"
                  value={secondaryEmailInput}
                  onChange={(e) => setSecondaryEmailInput(e.target.value)}
                  disabled={isSavingSecondaryEmail}
                  className="flex-1"
                />
                <Button
                  onClick={handleSaveSecondaryEmail}
                  disabled={isSavingSecondaryEmail || !secondaryEmailInput.trim() || secondaryEmailInput === user?.secondaryEmail}
                >
                  {isSavingSecondaryEmail ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                {user?.secondaryEmail && (
                  <Button
                    variant="outline"
                    onClick={handleRemoveSecondaryEmail}
                    disabled={isSavingSecondaryEmail}
                  >
                    Remove
                  </Button>
                )}
              </div>

              {user?.secondaryEmail && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  {user.secondaryEmailVerified ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-600">Verified - communications will be sent to both addresses</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-yellow-600" />
                      <span className="text-sm text-yellow-600">Not verified</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSendSecondaryVerification}
                        disabled={isSendingSecondaryVerification}
                        className="h-7 text-xs ml-2"
                      >
                        {isSendingSecondaryVerification ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Mail className="mr-1 h-3 w-3" />
                        )}
                        Send verification
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* GUID: PAGE_PROFILE-031-v03
            [Intent] Linked Sign-In Methods card showing PIN, Google, and Apple provider status
                     with Link/Unlink buttons. Prevents unlinking the last remaining provider.
            [Inbound Trigger] Rendered for all users (not behind mustChangePin gate).
            [Downstream Impact] Calls handleLinkGoogle/handleLinkApple/handleUnlinkProvider. */}
        {!user?.mustChangePin && (
          <Card>
            <CardHeader>
              <CardTitle>Linked Sign-In Methods</CardTitle>
              <CardDescription>Manage how you sign in to Prix Six.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* PIN (Password) */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">PIN</p>
                    <p className="text-sm text-muted-foreground">Email + 6-digit PIN</p>
                  </div>
                </div>
                {(user?.providers || []).includes('password') ? (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Linked
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not linked</span>
                )}
              </div>

              {/* Google */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <GoogleIcon size={20} />
                  <div>
                    <p className="font-medium">Google</p>
                    <p className="text-sm text-muted-foreground">Sign in with Google</p>
                  </div>
                </div>
                {(user?.providers || []).includes('google.com') ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Linked
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnlinkProvider('google.com')}
                      disabled={isUnlinking === 'google.com' || (user?.providers || []).length <= 1}
                      className="h-7 text-xs text-muted-foreground"
                    >
                      {isUnlinking === 'google.com' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Unlink className="mr-1 h-3 w-3" />
                          Unlink
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLinkGoogle}
                    disabled={isLinkingGoogle}
                    className="h-7 text-xs"
                  >
                    {isLinkingGoogle ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Link2 className="mr-1 h-3 w-3" />
                    )}
                    Link
                  </Button>
                )}
              </div>

              {/* Apple */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <AppleIcon size={20} />
                  <div>
                    <p className="font-medium">Apple</p>
                    <p className="text-sm text-muted-foreground">Sign in with Apple</p>
                  </div>
                </div>
                {(user?.providers || []).includes('apple.com') ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Linked
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnlinkProvider('apple.com')}
                      disabled={isUnlinking === 'apple.com' || (user?.providers || []).length <= 1}
                      className="h-7 text-xs text-muted-foreground"
                    >
                      {isUnlinking === 'apple.com' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Unlink className="mr-1 h-3 w-3" />
                          Unlink
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLinkApple}
                    disabled={isLinkingApple}
                    className="h-7 text-xs"
                  >
                    {isLinkingApple ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Link2 className="mr-1 h-3 w-3" />
                    )}
                    Link
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

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
                <div className="flex items-center justify-between">
                  <p>Your second team is <span className="font-bold text-accent">{user.secondaryTeamName}</span>.</p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove Secondary Team?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove your secondary team &quot;{user.secondaryTeamName}&quot;. Any predictions and scores for this team will remain in the system but the team will no longer appear in your profile.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRemoveSecondaryTeam} disabled={isRemovingTeam}>
                          {isRemovingTeam ? "Removing..." : "Remove Team"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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
                                    <Input
                                      type="password"
                                      placeholder="••••••"
                                      maxLength={6}
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      {...field}
                                    />
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
                                    <Input
                                      type="password"
                                      placeholder="••••••"
                                      maxLength={6}
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      {...field}
                                    />
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
