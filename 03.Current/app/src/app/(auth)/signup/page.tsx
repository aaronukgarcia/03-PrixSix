// GUID: PAGE_SIGNUP-000-v08
// [Intent] Signup page — registration is invite-only. Without a valid ?invite= token this
//          renders the static "Registration Closed" card (unchanged from v07: no Firebase
//          SDK, no IndexedDB — BUG-ERR-003). With a valid token (validated SERVER-side via
//          Admin SDK, no client round-trip) it renders the InviteSignupForm where the friend
//          registers with email+PIN or Google/Apple sign-in.
// [Inbound Trigger] User navigates to /signup, usually via the hot link in an invite email
//                   (/signup?invite=<64-hex token> from /api/invites/create).
// [Downstream Impact] Valid token → InviteSignupForm → /api/auth/signup or OAuth →
//                     /complete-profile. Invalid/absent token → static closed card, no
//                     Firestore writes. Token validation reads the server-only `invites`
//                     collection.
// @FIX(v07) Registration closed — replaced form with static invite-only card.
// @FIX(v08) SEC-SIGNUP-001 friend invites — server-validated invite tokens re-open a
//           single-use signup path while public registration stays closed.

import Link from "next/link";
import { Lock, MailX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { validateInvite } from "@/lib/invites";
import { InviteSignupForm } from "./InviteSignupForm";

export const dynamic = "force-dynamic";

// GUID: PAGE_SIGNUP-002-v01
// [Intent] Static "Registration Closed" card, shown for tokenless visits (identical UX to
//          v07) and for invalid/expired tokens (with an explanatory note).
// [Inbound Trigger] Rendered by SignupPage when no valid invite token is present.
// [Downstream Impact] Pure UI, links to /login. No side-effects.
function ClosedCard({ inviteNote }: { inviteNote?: string }) {
  return (
    <main className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Logo size="md" />
          </div>
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-muted p-3">
              {inviteNote ? (
                <MailX className="h-6 w-6 text-muted-foreground" />
              ) : (
                <Lock className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
          </div>
          <CardTitle className="text-2xl font-headline">Registration Closed</CardTitle>
          <CardDescription>
            Prix Six is a private league — new players join by invitation from a league member.
            If you&apos;ve been invited, use the link in your invite email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {inviteNote && (
            <p className="text-sm text-amber-600 dark:text-amber-500">{inviteNote}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Already have an account?
          </p>
          <Button asChild className="w-full">
            <Link href="/login">Go to Login</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Need access? Ask a Prix Six player to send you an invite.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

// GUID: PAGE_SIGNUP-001-v08
// [Intent] Server component — validates the ?invite= token with the Admin SDK before any
//          client JS loads. Only a VALID token ships the interactive form (and with it the
//          Firebase client SDK); every other visitor gets the static card.
// [Inbound Trigger] Route navigation to /signup.
// [Downstream Impact] Renders ClosedCard or InviteSignupForm. Token validation is read-only
//                     (LIB_INVITES-003); consumption happens in the signup APIs.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  if (!invite) {
    return <ClosedCard />;
  }

  let validation: Awaited<ReturnType<typeof validateInvite>>;
  try {
    const { db } = await getFirebaseAdmin();
    validation = await validateInvite(db, invite);
  } catch {
    // Fail closed: if the invite cannot be verified, show the closed card.
    return (
      <ClosedCard inviteNote="We couldn't verify your invite link right now. Please try again in a few minutes." />
    );
  }

  if (!validation.valid) {
    const note =
      validation.reason === "expired"
        ? "This invite link has expired — ask your friend to send you a fresh one."
        : validation.reason === "used"
          ? "This invite link has already been used. If that was you, just log in!"
          : "This invite link isn't valid — check you copied the full link from the email, or ask your friend to send a new one.";
    return <ClosedCard inviteNote={note} />;
  }

  return (
    <InviteSignupForm
      inviteToken={validation.token}
      invitedEmail={validation.invite.email}
      inviterTeamName={validation.invite.invitedByTeamName}
    />
  );
}
