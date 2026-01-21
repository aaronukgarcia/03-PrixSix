"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Mail } from "lucide-react";
import Link from "next/link";

type VerificationStatus = "loading" | "success" | "error" | "expired" | "already-verified";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<VerificationStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const token = searchParams.get("token");
  const uid = searchParams.get("uid");

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

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
