// GUID: PAGE_COMPLETE_PROFILE-000-v03
// [Intent] Profile completion page for new OAuth users. After signing in with Google/Apple
//          for the first time, the user lands here to enter their team name before they can
//          access the main app. The Firebase Auth user already exists; this page creates the
//          Firestore user document via the /api/auth/complete-oauth-profile API.
// [Inbound Trigger] FirebaseProvider redirects here when isNewOAuthUser is true (OAuth user
//                   with no Firestore doc).
// [Downstream Impact] On success, the Firestore user doc is created, onAuthStateChanged picks
//                     it up, and the user is redirected to /dashboard.

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Wand2, Frown, Loader2 } from 'lucide-react';
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/firebase";
import { Logo } from "@/components/Logo";
import { useToast } from "@/hooks/use-toast";
import { getProviderIds } from "@/services/authService";
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { doesTeamNameMatchEmail } from '@/lib/team-name-suggestions';

// GUID: PAGE_COMPLETE_PROFILE-002-v03
// [Intent] Zod schema for team name — minimum 3 characters.
// [Inbound Trigger] Form submission triggers validation.
// [Downstream Impact] Invalid input prevents submission; FormMessage shows error.
const formSchema = z.object({
  teamName: z.string().min(3, { message: "Team name must be at least 3 characters." }),
});

// GUID: PAGE_COMPLETE_PROFILE-003-v03
// [Intent] Main page component. Renders team name form for new OAuth users.
//          Redirects to /login if accessed without valid state (no firebaseUser or not isNewOAuthUser).
// [Inbound Trigger] Route navigation to /complete-profile.
// [Downstream Impact] Submits to /api/auth/complete-oauth-profile. On success, onAuthStateChanged
//                     picks up the new Firestore doc and navigates to /dashboard.
export default function CompleteProfilePage() {
  const { firebaseUser, isNewOAuthUser, isUserLoading } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [showEmailMatchDialog, setShowEmailMatchDialog] = useState(false);
  const [pendingValues, setPendingValues] = useState<z.infer<typeof formSchema> | null>(null);
  const [dialogSuggestions, setDialogSuggestions] = useState<string[]>([]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      teamName: "",
    },
  });

  // GUID: PAGE_COMPLETE_PROFILE-004-v04
  // [Intent] Fetch dynamic team name suggestions from the API on mount, then set the first
  //          suggestion in the form field. Falls back gracefully if the fetch fails.
  // [Inbound Trigger] Component mounts on client.
  // [Downstream Impact] Populates suggestions state and sets initial teamName field value.
  useEffect(() => {
    let cancelled = false;
    async function fetchSuggestions() {
      try {
        const res = await fetch('/api/team-name-suggestions');
        const data = await res.json();
        if (!cancelled && data.suggestions?.length > 0) {
          setSuggestions(data.suggestions);
          if (!form.getValues("teamName")) {
            form.setValue("teamName", data.suggestions[0]);
            setSuggestionIndex(1);
          }
        }
      } catch {
        // Fail silently — user can still type their own name
      }
    }
    fetchSuggestions();
    return () => { cancelled = true; };
  }, []);

  // GUID: PAGE_COMPLETE_PROFILE-005-v03
  // [Intent] Redirect to /login if this page is accessed without valid OAuth state.
  // [Inbound Trigger] When isUserLoading completes and state is invalid.
  // [Downstream Impact] Prevents direct URL access to this page without OAuth context.
  useEffect(() => {
    if (!isUserLoading && (!firebaseUser || !isNewOAuthUser)) {
      router.push('/login');
    }
  }, [isUserLoading, firebaseUser, isNewOAuthUser, router]);

  // GUID: PAGE_COMPLETE_PROFILE-005b-v01
  // [Intent] Cycles through the fetched suggestions sequentially. Wraps around when the
  //          end of the list is reached.
  // [Inbound Trigger] Called when user clicks the Wand2 button.
  // [Downstream Impact] Updates the teamName form field value and advances the index.
  function suggestName() {
    if (suggestions.length === 0) return;
    const name = suggestions[suggestionIndex % suggestions.length];
    form.setValue("teamName", name);
    setSuggestionIndex((prev) => (prev + 1) % suggestions.length);
  }

  // GUID: PAGE_COMPLETE_PROFILE-005c-v01
  // [Intent] Intercepts form submission to check if team name resembles the user's email.
  //          If it does, shows a dialog with fun alternatives. If not, proceeds normally.
  // [Inbound Trigger] Form submission after validation passes.
  // [Downstream Impact] Either shows the email-match dialog or calls onSubmit directly.
  function handleFormSubmit(values: z.infer<typeof formSchema>) {
    const email = firebaseUser?.email || '';
    if (doesTeamNameMatchEmail(values.teamName, email)) {
      setPendingValues(values);
      const shuffled = [...suggestions].sort(() => Math.random() - 0.5);
      setDialogSuggestions(shuffled.slice(0, 5));
      setShowEmailMatchDialog(true);
    } else {
      onSubmit(values);
    }
  }

  // GUID: PAGE_COMPLETE_PROFILE-006-v04
  // [Intent] Submit team name to complete-oauth-profile API.
  // [Inbound Trigger] User clicks "Join Prix Six" and form validation passes.
  // [Downstream Impact] Creates Firestore user doc. On success, toast + redirect happens
  //                     automatically via onAuthStateChanged detecting the new doc.
  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);

    try {
      const providers = getProviderIds(firebaseUser);

      const response = await fetch('/api/auth/complete-oauth-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          teamName: values.teamName,
          email: firebaseUser.email,
          photoUrl: firebaseUser.photoURL || undefined,
          providers,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Welcome to Prix Six!",
          description: "Your team has been created. Loading your dashboard...",
          duration: 5000,
        });
        // The onAuthStateChanged listener will detect the new Firestore doc
        // and redirect to /dashboard automatically
      } else {
        setError(result.error || 'Failed to complete profile');
        const errorCodeMatch = result.error?.match(/\[PX-\d+\]/);
        toast({
          variant: "destructive",
          title: errorCodeMatch ? `Setup Failed ${errorCodeMatch[0]}` : "Setup Failed",
          description: result.error?.split('[PX-')[0]?.trim() || 'Please try again.',
        });
      }
    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`Complete profile error [${correlationId}]:`, e);
      const errorMessage = `${e.message || 'An unexpected error occurred'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
      setError(errorMessage);
      toast({
        variant: "destructive",
        title: "Setup Failed",
        description: e.message || 'An unexpected error occurred',
      });
    } finally {
      setLoading(false);
    }
  }

  // Don't render until we know the user state
  if (isUserLoading || !firebaseUser || !isNewOAuthUser) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Logo size="md" />
          </div>
          <div className="flex justify-center mb-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={firebaseUser.photoURL || undefined} />
              <AvatarFallback className="text-xl">
                {firebaseUser.email?.charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle className="text-3xl font-headline">Almost There!</CardTitle>
          <CardDescription>
            Welcome, {firebaseUser.email}! Choose a team name to start predicting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="teamName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Name</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input placeholder="Your unique team name" {...field} disabled={loading} />
                      </FormControl>
                      <Button type="button" variant="outline" onClick={suggestName} aria-label="Suggest a team name" disabled={loading}>
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  <div className="flex items-center gap-x-2">
                    <Frown className="h-4 w-4 flex-shrink-0" />
                    <p>{error.includes('(Ref:') ? error.split('(Ref:')[0].trim() : error}</p>
                  </div>
                  {error.includes('(Ref:') && (
                    <div className="mt-2 pt-2 border-t border-destructive/20">
                      <code className="text-xs select-all cursor-pointer bg-destructive/10 px-2 py-1 rounded">
                        {error.match(/\(Ref:\s*([^)]+)\)/)?.[1] || ''}
                      </code>
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Team...
                  </>
                ) : (
                  "Join Prix Six"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* GUID: PAGE_COMPLETE_PROFILE-007-v01
          [Intent] AlertDialog shown when the chosen team name resembles the user's email.
                   Offers 5 random fun suggestions as clickable buttons, plus options to
                   go back and change or keep the current name.
          [Inbound Trigger] handleFormSubmit detects email-like team name.
          [Downstream Impact] User picks a suggestion (updates form) or keeps name (submits). */}
      <AlertDialog open={showEmailMatchDialog} onOpenChange={setShowEmailMatchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure about that name?</AlertDialogTitle>
            <AlertDialogDescription>
              Your team name looks like it might be based on your email. Most players go with a funny name! How about:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {dialogSuggestions.map((name) => (
              <Button
                key={name}
                variant="outline"
                className="justify-start text-left"
                onClick={() => {
                  form.setValue("teamName", name);
                  setShowEmailMatchDialog(false);
                  setPendingValues(null);
                }}
              >
                <Wand2 className="h-4 w-4 mr-2 flex-shrink-0" />
                {name}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowEmailMatchDialog(false);
              setPendingValues(null);
            }}>
              Let me change it
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowEmailMatchDialog(false);
              if (pendingValues) {
                onSubmit(pendingValues);
                setPendingValues(null);
              }
            }}>
              Keep my name
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
