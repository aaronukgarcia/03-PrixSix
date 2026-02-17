
// GUID: ADMIN_SITE_FUNCTIONS-000-v04
// @SECURITY_FIX: Replaced direct Firestore writes with authenticated API endpoint (ADMINCOMP-005).
// [Intent] Admin component for toggling global site functions: user login and new user sign-up. Uses secure API endpoint with business rule enforcement.
// [Inbound Trigger] Rendered within the admin panel when the "Site Functions" tab is selected.
// [Downstream Impact] Changes to userLoginEnabled and newUserSignupEnabled affect the login and registration flows site-wide. Audit events are logged on save.

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useFirestore, useAuth } from "@/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Skeleton } from "@/components/ui/skeleton";

// GUID: ADMIN_SITE_FUNCTIONS-001-v03
// [Intent] Type definition for the global site settings stored in admin_configuration/global.
// [Inbound Trigger] Used to type-check the Firestore document data on read and write.
// [Downstream Impact] Adding new settings fields here requires corresponding UI controls and Firestore schema updates.
interface SiteSettings {
    userLoginEnabled: boolean;
    newUserSignupEnabled: boolean;
}

// GUID: ADMIN_SITE_FUNCTIONS-002-v03
// [Intent] Main SiteFunctionsManager component providing toggle switches for global site features with save persistence.
// [Inbound Trigger] Rendered by the admin page when the Site Functions tab is active.
// [Downstream Impact] Writes to admin_configuration/global in Firestore; login and signup flows check these flags to allow or block access.
export function SiteFunctionsManager() {
    const firestore = useFirestore();
    const { user } = useAuth();
    const { toast } = useToast();
    const [settings, setSettings] = useState<SiteSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // GUID: ADMIN_SITE_FUNCTIONS-003-v03
    // [Intent] Fetches the current global site settings from Firestore on component mount.
    // [Inbound Trigger] Runs when the firestore instance becomes available (useEffect dependency).
    // [Downstream Impact] Populates the settings state, which drives the switch toggle positions. Defaults to both enabled if no document exists.
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


    // GUID: ADMIN_SITE_FUNCTIONS-004-v04
    // @SECURITY_FIX: Replaced direct Firestore write with authenticated API call (ADMINCOMP-005).
    // [Intent] Persists the current toggle states via secure API endpoint with business rule enforcement.
    // [Inbound Trigger] Clicking the "Save Settings" button.
    // [Downstream Impact] Updates admin_configuration/global document via API; login/signup flows will read these values. Audit trail is created server-side.
    const handleSave = async () => {
        if (!settings || !user) return;
        setIsSaving(true);
        try {
            // Get Firebase Auth token for API authentication
            const idToken = await user.firebaseUser?.getIdToken();
            if (!idToken) {
                throw new Error('Authentication token not available');
            }

            // Call secure API endpoint
            const response = await fetch('/api/admin/update-site-functions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    adminUid: user.id,
                    userLoginEnabled: settings.userLoginEnabled,
                    newUserSignupEnabled: settings.newUserSignupEnabled,
                }),
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update site functions');
            }

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

    // GUID: ADMIN_SITE_FUNCTIONS-005-v03
    // [Intent] Renders a loading skeleton while settings are being fetched from Firestore.
    // [Inbound Trigger] isLoading is true during the initial fetch.
    // [Downstream Impact] Prevents interaction with uninitialised toggle states; replaced by the full UI once data loads.
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

    // GUID: ADMIN_SITE_FUNCTIONS-006-v03
    // [Intent] Renders the site functions card with toggle switches for login and sign-up, plus a save button.
    // [Inbound Trigger] Component render cycle after settings have loaded.
    // [Downstream Impact] User interactions update local state; handleSave persists changes to Firestore.
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
