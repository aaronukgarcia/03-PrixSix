
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wand2 } from 'lucide-react';
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

const formSchema = z.object({
  teamName: z.string().min(3, { message: "Team name must be at least 3 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
});

export default function SignupPage() {
    const { toast } = useToast();
    const router = useRouter();
    const { signup } = useAuth();
    const [loading, setLoading] = useState(false);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            teamName: "",
            email: "",
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
        try {
            const result = await signup(values.email, values.teamName);
            if (result.success) {
                toast({
                    title: "Registration Complete!",
                    description: `Your PIN is ${result.pin}. Please use it to log in. An email has also been sent to you.`,
                    duration: 10000, // Keep toast open longer
                });
                router.push("/login");
            } else {
                 toast({
                    variant: "destructive",
                    title: "Registration Failed",
                    description: result.message,
                });
            }
        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Registration Failed",
                description: e.message,
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
