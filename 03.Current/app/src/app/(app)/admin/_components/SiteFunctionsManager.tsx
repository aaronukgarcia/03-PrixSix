
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useFirestore, useAuth } from "@/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";
import { logAuditEvent } from "@/lib/audit";

interface SiteSettings {
    userLoginEnabled: boolean;
    newUserSignupEnabled: boolean;
}

export function SiteFunctionsManager() {
    const firestore = useFirestore();
    const { user } = useAuth();
    const { toast } = useToast();
    const [settings, setSettings] = useState<SiteSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!firestore) return;
        const fetchSettings = async () => {
            const docRef = doc(firestore, "admin_configuration", "global");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setSettings(docSnap.data() as SiteSettings);
            } else {
                setSettings({ userLoginEnabled: true, newUserSignupEnabled: true });
            }
            setIsLoading(false);
        };
        fetchSettings();
    }, [firestore]);


    const handleSave = async () => {
        if (!firestore || !settings || !user) return;
        setIsSaving(true);
        try {
            const docRef = doc(firestore, "admin_configuration", "global");
            await setDoc(docRef, settings, { merge: true });

            // Log SYSTEM_INIT audit event when admin settings are saved
            logAuditEvent(firestore, user.id, 'SYSTEM_INIT', {
                action: 'site_settings_updated',
                settings: {
                    userLoginEnabled: settings.userLoginEnabled,
                    newUserSignupEnabled: settings.newUserSignupEnabled,
                },
            });

            toast({
                title: "Settings Saved",
                description: "Site functions have been updated."
            });
        } catch (e: any) {
            toast({
                variant: "destructive",
                title: "Save Failed",
                description: e.message
            });
        }
        setIsSaving(false);
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-10 w-32" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Site Functions</CardTitle>
                <CardDescription>Enable or disable core application features globally.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="login-enabled" className="text-base">
                            User Login
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Allow existing users to sign in to the application.
                        </p>
                    </div>
                    <Switch
                        id="login-enabled"
                        checked={settings?.userLoginEnabled}
                        onCheckedChange={(checked) => setSettings(prev => prev ? {...prev, userLoginEnabled: checked} : null)}
                        aria-label="Toggle User Login"
                        disabled={isSaving}
                    />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="signup-enabled" className="text-base">
                            New User Sign-ups
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Allow new users to register and create a team.
                        </p>
                    </div>
                    <Switch
                        id="signup-enabled"
                        checked={settings?.newUserSignupEnabled}
                        onCheckedChange={(checked) => setSettings(prev => prev ? {...prev, newUserSignupEnabled: checked} : null)}
                        aria-label="Toggle New User Sign-ups"
                        disabled={isSaving}
                    />
                </div>
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Settings"}
                </Button>
            </CardContent>
        </Card>
    );
}
