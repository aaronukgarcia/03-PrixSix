// GUID: PAGE_INVITE-000-v01
// [Intent] "Invite a Friend" page — a logged-in player enters a friend's email and Prix Six
//          sends them a welcoming invite email containing a single-use signup hot link
//          (SEC-SIGNUP-001 friend-invite system). Shows the link for manual sharing too.
// [Inbound Trigger] Sidebar "Invite a Friend" item (COMPONENT_APP_SIDEBAR-001B-v06).
// [Downstream Impact] Calls POST /api/invites/create with the Firebase ID token. Rate
//                     limited server-side (5/day per player). Errors display selectable
//                     codes + correlation IDs (Golden Rule #1).

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Loader2, MailCheck, UserPlus, Copy } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { generateClientCorrelationId } from "@/lib/error-codes";
import { CLIENT_ERRORS } from "@/lib/error-registry-client";

// GUID: PAGE_INVITE-002-v01
// [Intent] Zod schema — the friend's email address.
// [Inbound Trigger] Form submission via zodResolver.
// [Downstream Impact] Server re-validates with the stricter EmailSchema; this is UX-level.
const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

interface SentInvite {
  email: string;
  inviteUrl: string;
}

// GUID: PAGE_INVITE-001-v01
// [Intent] Main invite page component — email form, POST to /api/invites/create with
//          Bearer token, success state with copyable link, selectable errors.
// [Inbound Trigger] Route navigation to /invite (authenticated layout).
// [Downstream Impact] Each successful call creates/refreshes a pending invite and sends
//                     the invite email; audit-logged server-side as INVITE_SENT.
export default function InvitePage() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [lastSent, setLastSent] = useState<SentInvite | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firebaseUser) return;
    setError(null);
    setIsSending(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch("/api/invites/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: values.email }),
      });
      const result = await response.json();

      if (result.success) {
        setLastSent({ email: values.email, inviteUrl: result.inviteUrl });
        form.reset();
        toast({
          title: "Invite sent! 🏎️",
          description: `${values.email} has been invited to Prix Six.`,
          duration: 5000,
        });
      } else {
        let message = result.error || "Invite could not be sent";
        if (result.errorCode) message = `${message} [${result.errorCode}]`;
        if (result.correlationId) message = `${message} (Ref: ${result.correlationId})`;
        setError(message);
      }
    } catch (e: unknown) {
      if (process.env.NODE_ENV !== "production") console.error("[InvitePage] onSubmit catch:", e);
      const cid = generateClientCorrelationId();
      setError(`${CLIENT_ERRORS.INVITE_SEND_FAILED.message} [${CLIENT_ERRORS.INVITE_SEND_FAILED.code}] (Ref: ${cid})`);
    } finally {
      setIsSending(false);
    }
  }

  // GUID: PAGE_INVITE-003-v01
  // [Intent] Copy the invite link so members can share it directly (e.g. via WhatsApp)
  //          when the friend's inbox is unreliable.
  // [Inbound Trigger] "Copy link" button on the success panel.
  // [Downstream Impact] Clipboard only; the link is the same single-use token the email holds.
  async function copyLink() {
    if (!lastSent) return;
    try {
      await navigator.clipboard.writeText(lastSent.inviteUrl);
      toast({ title: "Link copied", description: "Paste it anywhere — it's the same single-use invite." });
    } catch {
      toast({ variant: "destructive", title: "Couldn't copy", description: "Select and copy the link manually." });
    }
  }

  return (
    <main className="container max-w-2xl py-8 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl font-headline">Invite a Friend</CardTitle>
              <CardDescription>
                Know someone who fancies their chances? Send them a personal invite — they can
                join with email &amp; PIN or their Google/Apple account.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Friend&apos;s email address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="friend@example.com" autoComplete="off" {...field} />
                    </FormControl>
                    <FormDescription>
                      They&apos;ll get a personal link that&apos;s valid for 14 days and works once.
                      You can send up to 5 invites a day.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <p className="text-sm text-destructive select-text break-words" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isSending || !firebaseUser}>
                {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Invite
              </Button>
            </form>
          </Form>

          {lastSent && (
            <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MailCheck className="h-4 w-4 text-green-600" />
                Invite sent to {lastSent.email}
              </div>
              <p className="text-xs text-muted-foreground break-all select-text">{lastSent.inviteUrl}</p>
              <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                <Copy className="mr-2 h-3 w-3" />
                Copy link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
