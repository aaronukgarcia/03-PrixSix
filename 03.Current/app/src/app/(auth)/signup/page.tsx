
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wand2, Frown } from 'lucide-react';
import React, { useState, useEffect } from "react";

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

const funnyNames = [
    "Shortcrust Piastri",
    "Checo yourself",
    "Smooth Operator",
    "Thorpe Park Ferme",
    "Vettel Attend",
    "Toto Recall",
    "Max Power",
];

// Weak PINs that should be rejected
const weakPins = [
    "123456", "654321", "111111", "222222", "333333", "444444",
    "555555", "666666", "777777", "888888", "999999", "000000",
    "123123", "121212", "112233", "001122", "102030", "112211",
];

const formSchema = z.object({
  teamName: z.string().min(3, { message: "Team name must be at least 3 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
  pin: z.string()
    .length(6, { message: "PIN must be exactly 6 digits." })
    .regex(/^\d{6}$/, { message: "PIN must contain only digits." })
    .refine((pin) => !weakPins.includes(pin), {
      message: "This PIN is too easy to guess. Please choose a stronger one.",
    }),
  confirmPin: z.string().length(6, { message: "Please confirm your PIN." }),
}).refine((data) => data.pin === data.confirmPin, {
  message: "PINs don't match.",
  path: ["confirmPin"],
});

export default function SignupPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { signup } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            teamName: "",
            email: "",
            pin: "",
            confirmPin: "",
        },
    });

    useEffect(() => {
      // This runs only on the client, after hydration, preventing the mismatch.
      if (!form.getValues("teamName")) {
          suggestName();
      }
    }, []); // Empty dependency array ensures this runs only once on mount

    function suggestName() {
        const name = funnyNames[Math.floor(Math.random() * funnyNames.length)];
        form.setValue("teamName", name);
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);
        setError(null);
        try {
            const result = await signup(values.email, values.teamName, values.pin);
            if (result.success) {
                toast({
                    title: "Registration Complete!",
                    description: "Your account has been created. Please use your PIN to log in.",
                    duration: 5000,
                });
                router.push("/login");
            } else {
                setError(result.message);
                // Extract error code for toast title if present
                const errorCodeMatch = result.message.match(/\[PX-\d+\]/);
                toast({
                    variant: "destructive",
                    title: errorCodeMatch ? `Registration Failed ${errorCodeMatch[0]}` : "Registration Failed",
                    description: result.message.split('[PX-')[0].trim(),
                });
            }
        } catch (e: any) {
            const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
            console.error(`Signup page error [${correlationId}]:`, e);
            const errorMessage = `${e.message || 'An unexpected error occurred'} [PX-9001] (Ref: ${correlationId})`;
            setError(errorMessage);
            toast({
                variant: "destructive",
                title: "Registration Failed [PX-9001]",
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
                 <div className="flex justify-center items-center mb-4">
                    <svg role="img" viewBox="0 0 24 24" className="h-12 w-12 text-primary" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><title>Prix Six</title><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.486 22 2 17.514 2 12S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zm-1-16h2v6h-2V6zm0 8h2v2h-2v-2z"/></svg>
                </div>
                <CardTitle className="text-3xl font-headline">Create Your Team</CardTitle>
                <CardDescription>Join the Prix Six league and start predicting.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="teamName"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Team Name</FormLabel>
                                <div className="flex gap-2">
                                <FormControl>
                                    <Input placeholder="Your unique team name" {...field} />
                                </FormControl>
                                <Button type="button" variant="outline" onClick={suggestName} aria-label="Suggest a team name">
                                    <Wand2 className="h-4 w-4" />
                                </Button>
                                </div>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                    <Input placeholder="team.principal@example.com" {...field} />
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
                                <FormLabel>Choose Your PIN</FormLabel>
                                <FormControl>
                                    <Input
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        placeholder="6-digit PIN"
                                        {...field}
                                    />
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
                                    <Input
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        placeholder="Confirm your PIN"
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

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Registering..." : "Sign Up"}
                        </Button>
                    </form>
                </Form>
                <div className="mt-4 text-center text-sm">
                    Already have an account?{" "}
                    <Link href="/login" className="underline text-accent">
                        Sign in
                    </Link>
                </div>
            </CardContent>
        </Card>
    </main>
  );
}
