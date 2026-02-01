// GUID: PAGE_SIGNUP-000-v03
// [Intent] Signup page for Prix Six. Allows new players to register with a team name,
//          email, and 6-digit PIN. Includes weak PIN rejection and fun team name suggestions.
// [Inbound Trigger] User navigates to /signup from the login page link.
// [Downstream Impact] Successful signup calls useAuth().signup which creates Firebase Auth user
//                     and Firestore user document, then redirects to /login.

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wand2, Frown, Loader2 } from 'lucide-react';
import React, { useState, useEffect } from "react";

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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/firebase";
import { Logo } from "@/components/Logo";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { doesTeamNameMatchEmail } from '@/lib/team-name-suggestions';

// GUID: PAGE_SIGNUP-002-v03
// [Intent] Blocklist of common weak PINs to prevent trivially guessable credentials.
// [Inbound Trigger] Zod .refine() validation checks submitted PIN against this list.
// [Downstream Impact] If PIN matches, form validation fails with "too easy to guess" message.
const weakPins = [
    "123456", "654321", "111111", "222222", "333333", "444444",
    "555555", "666666", "777777", "888888", "999999", "000000",
    "123123", "121212", "112233", "001122", "102030", "112211",
];

// GUID: PAGE_SIGNUP-003-v03
// [Intent] Zod schema for signup form — validates team name (min 3 chars), email,
//          6-digit numeric PIN (not weak), and PIN confirmation match.
// [Inbound Trigger] Form submission triggers zodResolver validation.
// [Downstream Impact] Invalid input prevents onSubmit; FormMessage shows per-field errors.
const formSchema = z.object({
  teamName: z.string().min(3, { message: "Team name must be at least 3 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
  pin: z.string()
    .length(6, { message: "PIN must be exactly 6 digits." })
    .regex(/^\d{6}$/, { message: "PIN must contain only digits." })
    .refine((pin) => !weakPins.includes(pin), {
      message: "This PIN is too easy to guess. Please choose a stronger one.",
    }),
  confirmPin: z.string().length(6, { message: "Please confirm your PIN." }),
}).refine((data) => data.pin === data.confirmPin, {
  message: "PINs don't match.",
  path: ["confirmPin"],
});

// GUID: PAGE_SIGNUP-004-v03
// [Intent] Main signup page component — renders registration form with team name suggestion,
//          email, PIN, and confirm PIN fields. Handles registration and error display.
// [Inbound Trigger] Route navigation to /signup.
// [Downstream Impact] Calls useAuth().signup which hits /api/signup. On success, redirects to /login.
//                     On failure, displays error with PX error code and correlation ID.
export default function SignupPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { signup, signInWithGoogle, signInWithApple } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isAppleLoading, setIsAppleLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestionIndex, setSuggestionIndex] = useState(0);
    const [showEmailMatchDialog, setShowEmailMatchDialog] = useState(false);
    const [pendingValues, setPendingValues] = useState<z.infer<typeof formSchema> | null>(null);
    const [dialogSuggestions, setDialogSuggestions] = useState<string[]>([]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            teamName: "",
            email: "",
            pin: "",
            confirmPin: "",
        },
    });

    // GUID: PAGE_SIGNUP-005-v04
    // [Intent] Fetch dynamic team name suggestions from the API on mount, then set the first
    //          suggestion in the form field. Falls back gracefully if the fetch fails.
    // [Inbound Trigger] Component mounts on client (empty dependency array).
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

    // GUID: PAGE_SIGNUP-006-v04
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

    // GUID: PAGE_SIGNUP-006b-v01
    // [Intent] Intercepts form submission to check if team name resembles the user's email.
    //          If it does, shows a dialog with fun alternatives. If not, proceeds normally.
    // [Inbound Trigger] Form submission after validation passes.
    // [Downstream Impact] Either shows the email-match dialog or calls onSubmit directly.
    function handleFormSubmit(values: z.infer<typeof formSchema>) {
        if (doesTeamNameMatchEmail(values.teamName, values.email)) {
            setPendingValues(values);
            // Pick 5 random suggestions for the dialog
            const shuffled = [...suggestions].sort(() => Math.random() - 0.5);
            setDialogSuggestions(shuffled.slice(0, 5));
            setShowEmailMatchDialog(true);
        } else {
            onSubmit(values);
        }
    }

    // GUID: PAGE_SIGNUP-007-v04
    // [Intent] Form submission handler — calls signup API, shows success toast and redirects
    //          to /login, or displays error with PX code and client-generated correlation ID.
    // [Inbound Trigger] User clicks "Sign Up" button and form validation passes.
    // [Downstream Impact] Success: toast + redirect to /login. Failure: error with PX-9001 and Ref ID.
    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);
        setError(null);
        try {
            const result = await signup(values.email, values.teamName, values.pin);
            if (result.success) {
                toast({
                    title: "Registration Complete!",
                    description: "Your account has been created. Please use your PIN to log in.",
                    duration: 5000,
                });
                router.push("/login");
            } else {
                setError(result.message);
                // Extract error code for toast title if present
                const errorCodeMatch = result.message.match(/\[PX-\d+\]/);
                toast({
                    variant: "destructive",
                    title: errorCodeMatch ? `Registration Failed ${errorCodeMatch[0]}` : "Registration Failed",
                    description: result.message.split('[PX-')[0].trim(),
                });
            }
        } catch (e: any) {
            const correlationId = generateClientCorrelationId();
            console.error(`Signup page error [${correlationId}]:`, e);
            const errorMessage = `${e.message || 'An unexpected error occurred'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
            setError(errorMessage);
            toast({
                variant: "destructive",
                title: `Registration Failed [${ERRORS.UNKNOWN_ERROR.code}]`,
                description: e.message || 'An unexpected error occurred',
            });
        } finally {
            setLoading(false);
        }
    }

    // GUID: PAGE_SIGNUP-008-v03
    // [Intent] Handle Google OAuth sign-in from signup page. New users go to /complete-profile;
    //          existing users are signed in directly.
    // [Inbound Trigger] User clicks "Continue with Google" button.
    // [Downstream Impact] On success, triggers onAuthStateChanged which routes appropriately.
    async function handleGoogleSignIn() {
        setError(null);
        setIsGoogleLoading(true);
        try {
            const result = await signInWithGoogle();
            if (result.success) {
                router.push('/dashboard');
            } else if (result.message) {
                setError(result.message);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsGoogleLoading(false);
        }
    }

    // GUID: PAGE_SIGNUP-009-v03
    // [Intent] Handle Apple OAuth sign-in from signup page.
    // [Inbound Trigger] User clicks "Continue with Apple" button.
    // [Downstream Impact] Same routing as handleGoogleSignIn.
    async function handleAppleSignIn() {
        setError(null);
        setIsAppleLoading(true);
        try {
            const result = await signInWithApple();
            if (result.success) {
                router.push('/dashboard');
            } else if (result.message) {
                setError(result.message);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsAppleLoading(false);
        }
    }

  return (
    <main className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md mx-4">
            <CardHeader className="text-center">
                 <div className="flex justify-center items-center mb-4">
                    <Logo size="md" />
                </div>
                <CardTitle className="text-3xl font-headline">Create Your Team</CardTitle>
                <CardDescription>Join the Prix Six league and start predicting.</CardDescription>
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
                                    <Input placeholder="Your unique team name" {...field} />
                                </FormControl>
                                <Button type="button" variant="outline" onClick={suggestName} aria-label="Suggest a team name">
                                    <Wand2 className="h-4 w-4" />
                                </Button>
                                </div>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                    <Input placeholder="team.principal@example.com" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="pin"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Choose Your PIN</FormLabel>
                                <FormControl>
                                    <Input
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        placeholder="6-digit PIN"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="confirmPin"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Confirm PIN</FormLabel>
                                <FormControl>
                                    <Input
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        placeholder="Confirm your PIN"
                                        {...field}
                                    />
                                </FormControl>
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
                            {loading ? "Registering..." : "Sign Up"}
                        </Button>
                    </form>
                </Form>
                {/* GUID: PAGE_SIGNUP-010-v03
                    [Intent] OAuth sign-up divider and buttons for Google and Apple.
                    [Inbound Trigger] Rendered below the PIN signup form.
                    [Downstream Impact] Clicking triggers handleGoogleSignIn/handleAppleSignIn. */}
                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or sign up with</span>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Button
                        variant="outline"
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={loading || isGoogleLoading || isAppleLoading}
                        className="w-full"
                    >
                        {isGoogleLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <GoogleIcon className="mr-2" size={18} />
                        )}
                        Google
                    </Button>
                    <Button
                        variant="outline"
                        type="button"
                        onClick={handleAppleSignIn}
                        disabled={loading || isGoogleLoading || isAppleLoading}
                        className="w-full"
                    >
                        {isAppleLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <AppleIcon className="mr-2" size={18} />
                        )}
                        Apple
                    </Button>
                </div>
                <div className="mt-4 text-center text-sm">
                    Already have an account?{" "}
                    <Link href="/login" className="underline text-accent">
                        Sign in
                    </Link>
                </div>
            </CardContent>
        </Card>

        {/* GUID: PAGE_SIGNUP-011-v01
            [Intent] AlertDialog shown when the chosen team name resembles the user's email.
                     Offers 5 random fun suggestions as clickable buttons, plus options to
                     go back and change or keep the current name.
            [Inbound Trigger] handleFormSubmit detects email-like team name.
            [Downstream Impact] User picks a suggestion (updates form + submits) or keeps name. */}
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
