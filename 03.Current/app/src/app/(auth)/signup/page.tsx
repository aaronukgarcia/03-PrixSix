// GUID: PAGE_SIGNUP-000-v07
// [Intent] Signup page — registration is currently CLOSED. New players are provisioned
//          manually by the league admin. This page renders a "by invitation only" card
//          and links back to login. No Firebase SDK calls are made — avoids IndexedDB
//          storms on Safari iOS (BUG-ERR-003 root cause: full form loaded Firebase SDK
//          which triggered IndexedDB disconnects, flooding error_logs).
// [Inbound Trigger] User navigates to /signup (e.g. via old link or direct URL).
// [Downstream Impact] Shows a static closed message. Redirects nothing — user chooses
//                     to navigate to /login via the link. No Firestore reads/writes.
// @FIX(v07) Registration closed — replaced form with static invite-only card.

import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

// GUID: PAGE_SIGNUP-001-v07
// [Intent] Static server component — no client JS, no Firebase SDK, no IndexedDB.
//          Renders "registration closed" message with a link to /login.
// [Inbound Trigger] Route navigation to /signup.
// [Downstream Impact] No side-effects. Pure UI.
export default function SignupPage() {
  return (
    <main className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center items-center mb-4">
            <Logo size="md" />
          </div>
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-muted p-3">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-headline">Registration Closed</CardTitle>
          <CardDescription>
            Prix Six is a private league — new players join by invitation from the league admin.
            If you&apos;ve been invited, your account will be set up for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?
          </p>
          <Button asChild className="w-full">
            <Link href="/login">Go to Login</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Need access? Contact your league administrator.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
