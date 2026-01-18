
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

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

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
        },
    });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);
        try {
            const result = await resetPin(values.email);
            if (result.success) {
                toast({
                    title: "PIN Sent!",
                    description: `A temporary PIN has been sent to ${values.email}.`,
                });
                router.push("/login");
            } else {
                 toast({
                    variant: "destructive",
                    title: "Reset Failed",
                    description: result.message,
                });
            }
        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Reset Failed",
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
