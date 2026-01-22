
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

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

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
            const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
            const errorMessage = `${e.message || 'An unexpected error occurred'} [PX-9001] (Ref: ${correlationId})`;
            setError(errorMessage);
            toast({
                variant: "destructive",
                title: "Reset Failed [PX-9001]",
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
