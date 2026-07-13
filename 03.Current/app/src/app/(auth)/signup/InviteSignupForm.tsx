// GUID: COMPONENT_INVITE_SIGNUP-000-v01
// [Intent] Client-side invite signup form, rendered by /signup ONLY after the server has
//          validated the invite token. Offers two join paths: (a) Google/Apple one-tap —
//          the token is stashed in sessionStorage so /complete-profile can forward it to
//          the API after the OAuth redirect; (b) email + team name + 6-digit PIN via
//          useAuth().signup(), which forwards the token to /api/auth/signup.
// [Inbound Trigger] Rendered with a valid pending invite (PAGE_SIGNUP-001-v08).
// [Downstream Impact] Successful signup consumes the single-use invite (LIB_INVITES-004)
//                     and signs the new player in; failures show selectable errors with
//                     correlation IDs (Golden Rule #1).

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { Loader2, PartyPopper } from "lucide-react";
import React, { useState } from "react";
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
import { Logo } from "@/components/Logo";
import { useAuth } from "@/firebase";
import { GoogleIcon, AppleIcon } from "@/components/icons/OAuthIcons";
import { generateClientCorrelationId } from "@/lib/error-codes";
import { CLIENT_ERRORS } from "@/lib/error-registry-client";

// GUID: COMPONENT_INVITE_SIGNUP-001-v01
// [Intent] sessionStorage key carrying the invite token across the OAuth redirect to
//          /complete-profile. sessionStorage (not state) because signInWithGoogle uses a
//          full-page redirect on mobile, losing all React state.
// [Inbound Trigger] Written before OAuth starts; read+cleared by /complete-profile.
// [Downstream Impact] Key name must match PAGE_COMPLETE_PROFILE's reader exactly.
export const INVITE_TOKEN_STORAGE_KEY = "prix6InviteToken";

// GUID: COMPONENT_INVITE_SIGNUP-002-v01
// [Intent] Zod schema for the email/PIN join path — valid email, team name ≥ 3 chars
//          (server enforces uniqueness), PIN exactly 6 digits entered twice.
// [Inbound Trigger] Form submission via zodResolver.
// [Downstream Impact] Mirrors /api/auth/signup validation so users rarely see server 400s.
const formSchema = z
  .object({
    email: z.string().email({ message: "Invalid email address." }),
    teamName: z.string().min(3, { message: "Team name must be at least 3 characters." }).max(50),
    pin: z.string().regex(/^\d{6}$/, { message: "PIN must be exactly 6 digits." }),
    confirmPin: z.string(),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "PINs do not match.",
    path: ["confirmPin"],
  });

interface InviteSignupFormProps {
  inviteToken: string;
  invitedEmail: string;
  inviterTeamName: string;
}

// GUID: COMPONENT_INVITE_SIGNUP-003-v01
// [Intent] Main invite signup component — welcome header naming the inviter, OAuth buttons,
//          divider, email/PIN form, and error/loading states.
// [Inbound Trigger] Rendered by the /signup server component with validated invite props.
// [Downstream Impact] Calls useAuth().signup / signInWithGoogle / signInWithApple. On
//                     success routes to /dashboard (OAuth new users are re-routed to
//                     /complete-profile by the auth provider).
export function InviteSignupForm({ inviteToken, invitedEmail, inviterTeamName }: InviteSignupFormProps) {
  const { signup, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: invitedEmail, teamName: "", pin: "", confirmPin: "" },
  });

  // GUID: COMPONENT_INVITE_SIGNUP-004-v01
  // [Intent] Email/PIN submission — calls the provider signup() with the invite token and
  //          routes to the dashboard on success (signup() already signed us in).
  // [Inbound Trigger] Join form submit.
  // [Downstream Impact] Server consumes the invite; on failure the token stays live so the
  //                     user can retry (LIB_INVITES-005 revert).
  async function onSubmit(values: z.infer<typeof formSchema>) {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signup(values.email, values.teamName, values.pin, inviteToken);
      if (result.success) {
        router.push("/dashboard");
      } else {
        setError(result.message);
      }
    } catch (e: unknown) {
      if (process.env.NODE_ENV !== "production") console.error("[InviteSignupForm] onSubmit catch:", e);
      const cid = generateClientCorrelationId();
      setError(`${CLIENT_ERRORS.UNKNOWN_ERROR.message} [${CLIENT_ERRORS.UNKNOWN_ERROR.code}] (Ref: ${cid})`);
    } finally {
      setIsSubmitting(false);
    }
  }

  // GUID: COMPONENT_INVITE_SIGNUP-005-v01
  // [Intent] OAuth join paths — stash the invite token for /complete-profile, then run the
  //          shared provider sign-in. New users are auto-routed to /complete-profile by the
  //          auth provider's onAuthStateChanged handler.
  // [Inbound Trigger] Google/Apple button clicks.
  // [Downstream Impact] sessionStorage token is read+cleared by /complete-profile and
  //                     forwarded to /api/auth/complete-oauth-profile as the gate bypass.
  async function handleOAuth(providerFn: typeof signInWithGoogle, setLoading: (b: boolean) => void) {
    setError(null);
    setLoading(true);
    try {
      sessionStorage.setItem(INVITE_TOKEN_STORAGE_KEY, inviteToken);
      const result = await providerFn();
      if (result.success) {
        router.push("/dashboard");
      } else if (result.message) {
        setError(result.message);
      }
    } catch (e: unknown) {
      if (process.env.NODE_ENV !== "production") console.error("[InviteSignupForm] OAuth catch:", e);
      const cid = generateClientCorrelationId();
      setError(`${CLIENT_ERRORS.AUTH_OAUTH_PROVIDER_ERROR.message} [${CLIENT_ERRORS.AUTH_OAUTH_PROVIDER_ERROR.code}] (Ref: ${cid})`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-background py-8">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Logo size="md" />
          </div>
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-muted p-3">
              <PartyPopper className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-headline">You&apos;re Invited!</CardTitle>
          <CardDescription>
            <strong>{inviterTeamName}</strong> has invited you to join Prix Six — the private
            F1 prediction league. Pick a team name and you&apos;re on the grid.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth(signInWithGoogle, setIsGoogleLoading)}
              disabled={isGoogleLoading || isAppleLoading || isSubmitting}
            >
              {isGoogleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-4 w-4" />}
              Continue with Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth(signInWithApple, setIsAppleLoading)}
              disabled={isGoogleLoading || isAppleLoading || isSubmitting}
            >
              {isAppleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AppleIcon className="mr-2 h-4 w-4" />}
              Continue with Apple
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or join with email &amp; PIN</span>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="teamName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Turbo Tortoises" {...field} />
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
                    <FormLabel>Choose a 6-digit PIN</FormLabel>
                    <FormControl>
                      <Input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" {...field} />
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
                      <Input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <p className="text-sm text-destructive select-text break-words" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting || isGoogleLoading || isAppleLoading}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Join the League
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="underline hover:text-foreground">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
