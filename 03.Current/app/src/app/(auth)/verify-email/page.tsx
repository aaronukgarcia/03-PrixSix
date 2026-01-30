// GUID: PAGE_VERIFY_EMAIL-000-v03
// [Intent] Email verification landing page. Processes the token+uid from a verification link,
//          calls /api/verify-email, and displays success/error/expired status.
// [Inbound Trigger] User clicks the email verification link sent to their primary email.
// [Downstream Impact] Successful verification updates the user's emailVerified flag in Firestore.
//                     Wraps content in Suspense for Next.js useSearchParams() compliance.

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react";
import Link from "next/link";

// GUID: PAGE_VERIFY_EMAIL-001-v03
// [Intent] Union type representing all possible verification states for UI rendering.
// [Inbound Trigger] Used as state type in VerifyEmailContent component.
// [Downstream Impact] Drives conditional rendering of icon, title, description, and action buttons.
type VerificationStatus = "loading" | "success" | "error" | "expired" | "already-verified";

// GUID: PAGE_VERIFY_EMAIL-002-v03
// [Intent] Inner content component that reads search params (token, uid), calls the
//          /api/verify-email endpoint, and renders status-dependent UI (icon, message, action).
// [Inbound Trigger] Mounted inside Suspense by VerifyEmailPage. Reads ?token=&uid= from URL.
// [Downstream Impact] POST to /api/verify-email. Updates UI state. Success shows "Continue to Login" link.
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<VerificationStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const token = searchParams.get("token");
  const uid = searchParams.get("uid");

  // GUID: PAGE_VERIFY_EMAIL-003-v03
  // [Intent] Effect that fires on mount to validate token/uid params and call the verify API.
  //          Sets status to success, expired, already-verified, or error based on API response.
  // [Inbound Trigger] Component mount with token and uid from URL search params.
  // [Downstream Impact] Sets verification status which drives the entire page UI.
  useEffect(() => {
    if (!token || !uid) {
      setStatus("error");
      setErrorMessage("Invalid verification link. Missing token or user ID.");
      return;
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch("/api/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, uid }),
        });

        const result = await response.json();

        if (result.success) {
          setStatus("success");
        } else if (result.error === "Token expired") {
          setStatus("expired");
        } else if (result.error === "Email already verified") {
          setStatus("already-verified");
        } else {
          setStatus("error");
          setErrorMessage(result.error || "Verification failed");
        }
      } catch (error: any) {
        setStatus("error");
        setErrorMessage(error.message || "Network error. Please try again.");
      }
    };

    verifyEmail();
  }, [token, uid]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {status === "loading" && (
              <Loader2 className="h-16 w-16 text-muted-foreground animate-spin" />
            )}
            {status === "success" && (
              <CheckCircle className="h-16 w-16 text-green-500" />
            )}
            {status === "already-verified" && (
              <CheckCircle className="h-16 w-16 text-green-500" />
            )}
            {(status === "error" || status === "expired") && (
              <XCircle className="h-16 w-16 text-destructive" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {status === "loading" && "Verifying Email..."}
            {status === "success" && "Email Verified!"}
            {status === "already-verified" && "Already Verified"}
            {status === "error" && "Verification Failed"}
            {status === "expired" && "Link Expired"}
          </CardTitle>
          <CardDescription>
            {status === "loading" && "Please wait while we verify your email address."}
            {status === "success" && "Your email has been successfully verified. You can now access all features of Prix Six."}
            {status === "already-verified" && "Your email was already verified. No action needed."}
            {status === "error" && errorMessage}
            {status === "expired" && "This verification link has expired. Please request a new one from your profile settings."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {status === "success" || status === "already-verified" ? (
            <Button asChild className="w-full">
              <Link href="/login">
                Continue to Login
              </Link>
            </Button>
          ) : status === "expired" ? (
            <>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">
                  <Mail className="mr-2 h-4 w-4" />
                  Login to Resend
                </Link>
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Log in to your account and request a new verification email from your profile.
              </p>
            </>
          ) : status === "error" ? (
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">
                Back to Login
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// GUID: PAGE_VERIFY_EMAIL-004-v03
// [Intent] Loading fallback component shown while useSearchParams() resolves inside Suspense.
// [Inbound Trigger] Suspense boundary in VerifyEmailPage renders this during loading.
// [Downstream Impact] Provides a spinner UI to prevent blank screen during param resolution.
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Loader2 className="h-16 w-16 text-muted-foreground animate-spin" />
          </div>
          <CardTitle className="text-2xl">Loading...</CardTitle>
          <CardDescription>Please wait</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

// GUID: PAGE_VERIFY_EMAIL-005-v03
// [Intent] Exported page component wrapping VerifyEmailContent in Suspense boundary
//          (required by Next.js 15 for useSearchParams).
// [Inbound Trigger] Route navigation to /verify-email?token=...&uid=...
// [Downstream Impact] Renders LoadingFallback then VerifyEmailContent once params resolve.
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
