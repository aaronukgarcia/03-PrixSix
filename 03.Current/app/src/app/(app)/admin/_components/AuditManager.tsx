
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
// Assume these functions will be created to interact with a 'global-settings' doc
import { useFirestore } from "@/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

interface AuditSettings {
  auditLoggingEnabled: boolean;
}

async function getAuditSettings(db: any): Promise<AuditSettings> {
    const docRef = doc(db, "admin_configuration", "global");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().auditLoggingEnabled !== undefined) {
        return { auditLoggingEnabled: docSnap.data().auditLoggingEnabled };
    }
    return { auditLoggingEnabled: false }; // Default value
}

async function updateAuditSettings(db: any, settings: Partial<AuditSettings>) {
    const docRef = doc(db, "admin_configuration", "global");
    await setDoc(docRef, settings, { merge: true });
}

export function AuditManager() {
    const firestore = useFirestore();
    const { toast } = useToast();

    const [settings, setSettings] = useState<AuditSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (firestore) {
            getAuditSettings(firestore)
                .then(setSettings)
                .catch(setError)
                .finally(() => setLoading(false));
        }
    }, [firestore]);

    const handleSave = async () => {
        if (!firestore || !settings) return;
        setIsSaving(true);
        try {
            await updateAuditSettings(firestore, { auditLoggingEnabled: settings.auditLoggingEnabled });
            toast({
                title: "Settings Saved",
                description: "Audit logging settings have been updated."
            });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Save Failed", description: e.message });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleToggle = (checked: boolean) => {
        setSettings(prev => prev ? { ...prev, auditLoggingEnabled: checked } : { auditLoggingEnabled: checked });
    }

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent><Skeleton className="h-10 w-full" /></CardContent>
                <CardFooter><Skeleton className="h-10 w-32" /></CardFooter>
            </Card>
        );
    }
    
    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Settings</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
            </Alert>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Audit System Control</CardTitle>
                <CardDescription>Enable or disable the user activity and error audit logging system globally.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="audit-enabled" className="text-base">
                            Enable Audit Logging
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            Globally track user navigation and permission errors.
                        </p>
                    </div>
                    <Switch
                        id="audit-enabled"
                        checked={settings?.auditLoggingEnabled}
                        onCheckedChange={handleToggle}
                        aria-label="Toggle Audit Logging"
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
