// GUID: PAGE_FORGOT_PIN-000-v03
// [Intent] Forgot PIN page — allows users to request a temporary PIN reset email.
//          Collects email address, calls resetPin API, and redirects to login on success.
// [Inbound Trigger] User clicks "Forgot my PIN" link on the login page.
// [Downstream Impact] Triggers /api/reset-pin which sends a temporary PIN email.
//                     On success, redirects to /login. On failure, shows error with correlation ID.

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { Frown } from 'lucide-react';

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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/firebase";
import { ERRORS } from '@/lib/error-registry';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: PAGE_FORGOT_PIN-001-v03
// [Intent] Zod validation schema for forgot PIN form — requires a valid email address.
// [Inbound Trigger] Form submission triggers zodResolver validation.
// [Downstream Impact] Invalid email prevents onSubmit from executing; FormMessage displays error.
const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

// GUID: PAGE_FORGOT_PIN-002-v03
// [Intent] Main forgot PIN page component — renders email input form, calls resetPin API,
//          and handles success/error states with toast notifications.
// [Inbound Trigger] Route navigation to /forgot-pin.
// [Downstream Impact] Calls useAuth().resetPin which hits /api/reset-pin.
//                     Success: toast + redirect to /login. Failure: error with PX code and Ref ID.
export default function ForgotPinPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { resetPin } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
        },
    });

    // GUID: PAGE_FORGOT_PIN-003-v04
    // [Intent] Form submission handler — calls resetPin API, shows toast on success/failure,
    //          and generates client-side correlation ID for unexpected errors.
    // [Inbound Trigger] User clicks "Send Reset Email" and form validation passes.
    // [Downstream Impact] Success: toast "PIN Sent!" + redirect to /login.
    //                     Failure: inline error with PX code and selectable correlation ID.
    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);
        setError(null);
        try {
            const result = await resetPin(values.email);
            if (result.success) {
                toast({
                    title: "PIN Sent!",
                    description: `A temporary PIN has been sent to ${values.email}.`,
                });
                router.push("/login");
            } else {
                setError(result.message);
                // Extract error code for toast title if present
                const errorCodeMatch = result.message.match(/\[PX-\d+\]/);
                toast({
                    variant: "destructive",
                    title: errorCodeMatch ? `Reset Failed ${errorCodeMatch[0]}` : "Reset Failed",
                    description: result.message.split('[PX-')[0].trim(),
                });
            }
        } catch (e: any) {
            const correlationId = generateClientCorrelationId();
            const errorMessage = `${e.message || 'An unexpected error occurred'} [${ERRORS.UNKNOWN_ERROR.code}] (Ref: ${correlationId})`;
            setError(errorMessage);
            toast({
                variant: "destructive",
                title: `Reset Failed [${ERRORS.UNKNOWN_ERROR.code}]`,
                description: e.message || 'An unexpected error occurred',
            });
        } finally {
            setLoading(false);
        }
    }

  return (
    <main className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md mx-4">
            <CardHeader className="text-center">
                <CardTitle className="text-3xl font-headline">Forgot Your PIN?</CardTitle>
                <CardDescription>Enter your email and we'll send you a temporary PIN.</CardDescription>
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
                            {loading ? "Sending..." : "Send Reset Email"}
                        </Button>
                    </form>
                </Form>
                <div className="mt-4 text-center text-sm">
                    Remembered your PIN?{" "}
                    <Link href="/login" className="underline text-accent">
                        Sign in
                    </Link>
                </div>
            </CardContent>
        </Card>
    </main>
  );
}
