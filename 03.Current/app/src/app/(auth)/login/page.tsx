// GUID: PAGE_LOGIN-000-v03
// [Intent] Login page for Prix Six. Authenticates users via email + 6-digit PIN,
//          displays version number, and redirects to dashboard on success.
// [Inbound Trigger] User navigates to /login or root route (/ renders this page).
// [Downstream Impact] Successful login sets auth context (useAuth), redirects to /dashboard.
//                     Failed login displays selectable error with correlation ID.

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { Frown, Loader2 } from 'lucide-react';
import React, { useState, useEffect } from "react";
import { APP_VERSION } from '@/lib/version';

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/firebase";
import { Logo } from "@/components/Logo";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";


// GUID: PAGE_LOGIN-001-v03
// [Intent] Zod validation schema for login form — enforces valid email and exactly 6-digit PIN.
// [Inbound Trigger] Form submission triggers zodResolver validation.
// [Downstream Impact] Invalid input prevents onSubmit from executing; FormMessage displays errors.
const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  pin: z.string().min(6, { message: "PIN must be 6 digits." }).max(6),
});

// GUID: PAGE_LOGIN-002-v03
// [Intent] Main login page component — renders email/PIN form, handles authentication,
//          and manages loading/redirect/error UI states.
// [Inbound Trigger] Route navigation to /login (or / via PAGE_ROOT).
// [Downstream Impact] Calls useAuth().login which hits /api/login. On success, pushes to /dashboard.
//                     On failure, displays error inline with selectable correlation ID.
export default function LoginPage() {
    const { login, signInWithGoogle, signInWithApple, clearPendingCredential, user, isUserLoading } = useAuth();
    const { toast } = useToast();
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isAppleLoading, setIsAppleLoading] = useState(false);
    const [showLinkingDialog, setShowLinkingDialog] = useState(false);
    const router = useRouter();

    // GUID: PAGE_LOGIN-008-v03
    // [Intent] Redirect already-authenticated users to the dashboard. This handles the case where
    //          a mobile redirect-based OAuth flow (Apple/Google) completes and the browser returns
    //          to the login page with the user already signed in via getRedirectResult.
    // [Inbound Trigger] User state changes after redirect-based OAuth completes, or user navigates
    //                   to /login while already authenticated.
    // [Downstream Impact] Prevents authenticated users from seeing the login form; sends them to /dashboard.
    useEffect(() => {
        if (!isUserLoading && user) {
            router.push('/dashboard');
        }
    }, [user, isUserLoading, router]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
            pin: "",
        },
    });

    // GUID: PAGE_LOGIN-003-v03
    // [Intent] Form submission handler — calls login API, manages submit/redirect states,
    //          and displays error with correlation ID on failure.
    // [Inbound Trigger] User clicks "Sign In" button and form validation passes.
    // [Downstream Impact] Success: sets isRedirecting, pushes to /dashboard.
    //                     Failure: shows destructive toast and inline error with Ref ID.
    async function onSubmit(values: z.infer<typeof formSchema>) {
        setError(null);
        setIsSubmitting(true);
        try {
            const result = await login(values.email, values.pin);
            if (result.success) {
                setIsRedirecting(true);
                router.push('/dashboard');
                // Don't reset isSubmitting - keep button disabled during redirect
            } else {
                 setError(result.message); // Use the message from the login function
                 toast({
                     variant: "destructive",
                     title: "Login Failed",
                     description: result.message,
                 });
                 setIsSubmitting(false);
            }
        } catch (e: any) {
             setError(e.message);
             toast({
                variant: "destructive",
                title: "Login Failed",
                description: e.message,
            });
            setIsSubmitting(false);
        }
    }

    // GUID: PAGE_LOGIN-004-v03
    // [Intent] Handle Google OAuth sign-in. If the user's email already has a PIN account,
    //          show linking dialog instead of auto-linking.
    // [Inbound Trigger] User clicks "Continue with Google" button.
    // [Downstream Impact] On success, redirects to /dashboard or /complete-profile (new users).
    async function handleGoogleSignIn() {
        setError(null);
        setIsGoogleLoading(true);
        try {
            const result = await signInWithGoogle();
            if (result.success) {
                setIsRedirecting(true);
                // New OAuth users go to complete-profile; existing users go to dashboard.
                // The onAuthStateChanged handler redirects new OAuth users, so push dashboard
                // as the default — if the user is new, the provider will override this.
                router.push('/dashboard');
            } else if (result.needsLinking) {
                setShowLinkingDialog(true);
            } else if (result.message) {
                setError(result.message);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsGoogleLoading(false);
        }
    }

    // GUID: PAGE_LOGIN-005-v03
    // [Intent] Handle Apple OAuth sign-in with same linking-dialog pattern as Google.
    // [Inbound Trigger] User clicks "Continue with Apple" button.
    // [Downstream Impact] Same as handleGoogleSignIn.
    async function handleAppleSignIn() {
        setError(null);
        setIsAppleLoading(true);
        try {
            const result = await signInWithApple();
            if (result.success) {
                setIsRedirecting(true);
                router.push('/dashboard');
            } else if (result.needsLinking) {
                setShowLinkingDialog(true);
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
                <CardTitle className="text-3xl font-headline">Welcome to Prix Six</CardTitle>
                <CardDescription>Enter your credentials to access your team.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                    <Input placeholder="toto.wolff@mercedes.com" {...field} />
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
                                <div className="flex justify-between items-center">
                                    <FormLabel>PIN</FormLabel>
                                    <Link href="/forgot-pin" className="text-xs text-accent underline">
                                        Forgot my PIN
                                    </Link>
                                </div>
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

                        <Button type="submit" className="w-full" disabled={isSubmitting || isRedirecting}>
                            {isRedirecting ? "Welcome! Loading..." : isSubmitting ? "Signing In..." : "Sign In"}
                        </Button>
                    </form>
                </Form>
                {/* GUID: PAGE_LOGIN-006-v03
                    [Intent] OAuth sign-in divider and buttons for Google and Apple.
                    [Inbound Trigger] Rendered below the PIN form.
                    [Downstream Impact] Clicking triggers handleGoogleSignIn/handleAppleSignIn. */}
                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Button
                        variant="outline"
                        onClick={handleGoogleSignIn}
                        disabled={isSubmitting || isRedirecting || isGoogleLoading || isAppleLoading}
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
                        onClick={handleAppleSignIn}
                        disabled={isSubmitting || isRedirecting || isGoogleLoading || isAppleLoading}
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
                    Don&apos;t have an account?{" "}
                    <Link href="/signup" className="underline text-accent">
                        Sign up
                    </Link>
                </div>
                <div className="mt-6 text-center">
                    <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
                </div>

                {/* GUID: PAGE_LOGIN-007-v03
                    [Intent] Dialog explaining that the email already has a PIN account and
                             how to link the OAuth provider from the profile page.
                    [Inbound Trigger] Shown when OAuth returns needsLinking=true.
                    [Downstream Impact] Directs user to sign in with PIN first, then link from profile. */}
                <Dialog open={showLinkingDialog} onOpenChange={(open) => {
                    setShowLinkingDialog(open);
                    if (!open) clearPendingCredential();
                }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Account Already Exists</DialogTitle>
                            <DialogDescription>
                                This email is already registered with a PIN. To link your Google or Apple account,
                                please sign in with your PIN first, then go to your Profile page to link additional
                                sign-in methods.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button onClick={() => setShowLinkingDialog(false)}>
                                Got it
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    </main>
  );
}
