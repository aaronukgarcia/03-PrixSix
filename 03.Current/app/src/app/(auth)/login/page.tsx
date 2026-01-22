
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { Frown } from 'lucide-react';
import React, { useState } from "react";
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
import { useAuth } from "@/firebase";
import { Logo } from "@/components/Logo";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";


const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  pin: z.string().min(6, { message: "PIN must be 6 digits." }).max(6),
});

export default function LoginPage() {
    const { login } = useAuth();
    const { toast } = useToast();
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const router = useRouter();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
            pin: "",
        },
    });

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
                                    <Input type="password" placeholder="••••••" {...field} />
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
                <div className="mt-4 text-center text-sm">
                    Don&apos;t have an account?{" "}
                    <Link href="/signup" className="underline text-accent">
                        Sign up
                    </Link>
                </div>
                <div className="mt-6 text-center">
                    <span className="text-xs font-mono text-muted-foreground">v{APP_VERSION}</span>
                </div>
            </CardContent>
        </Card>
    </main>
  );
}
