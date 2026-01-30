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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/firebase";
import { Logo } from "@/components/Logo";
import { useToast } from "@/hooks/use-toast";
import { getProviderIds } from "@/services/authService";

// GUID: PAGE_COMPLETE_PROFILE-001-v03
// [Intent] Fun F1-themed team name suggestions (same pool as signup page).
// [Inbound Trigger] suggestName() picks a random entry on mount and on button click.
// [Downstream Impact] Populates the teamName form field with a fun default value.
const funnyNames = [
  "Shortcrust Piastri",
  "Checo yourself",
  "Smooth Operator",
  "Thorpe Park Ferme",
  "Vettel Attend",
  "Toto Recall",
  "Max Power",
];

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

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      teamName: "",
    },
  });

  // GUID: PAGE_COMPLETE_PROFILE-004-v03
  // [Intent] Set a random team name suggestion on mount (client-only to avoid SSR mismatch).
  // [Inbound Trigger] Component mounts on client.
  // [Downstream Impact] Populates teamName field if empty.
  useEffect(() => {
    if (!form.getValues("teamName")) {
      suggestName();
    }
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

  function suggestName() {
    const name = funnyNames[Math.floor(Math.random() * funnyNames.length)];
    form.setValue("teamName", name);
  }

  // GUID: PAGE_COMPLETE_PROFILE-006-v03
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
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      console.error(`Complete profile error [${correlationId}]:`, e);
      const errorMessage = `${e.message || 'An unexpected error occurred'} [PX-9001] (Ref: ${correlationId})`;
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
    </main>
  );
}
