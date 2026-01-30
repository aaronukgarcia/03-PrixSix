// GUID: ADMIN_AUDIT-000-v03
// [Intent] Admin component for toggling the global audit logging system on or off via admin_configuration/global Firestore document.
// [Inbound Trigger] Rendered on the admin Audit Settings tab or section.
// [Downstream Impact] Writing auditLoggingEnabled to Firestore controls whether the system records audit logs at all; affects audit_logs collection population.

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

// GUID: ADMIN_AUDIT-001-v03
// [Intent] Type definition for the audit settings shape stored in admin_configuration/global.
// [Inbound Trigger] Used to type-check the settings state and Firestore read/write operations.
// [Downstream Impact] Adding new audit settings fields requires updating this interface and the corresponding UI.
interface AuditSettings {
  auditLoggingEnabled: boolean;
}

// GUID: ADMIN_AUDIT-002-v03
// [Intent] Reads the current audit settings from the admin_configuration/global Firestore document, defaulting to disabled.
// [Inbound Trigger] Called on component mount to initialise the toggle state.
// [Downstream Impact] If the document does not exist or the field is missing, auditing defaults to disabled (false).
async function getAuditSettings(db: any): Promise<AuditSettings> {
    const docRef = doc(db, "admin_configuration", "global");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().auditLoggingEnabled !== undefined) {
        return { auditLoggingEnabled: docSnap.data().auditLoggingEnabled };
    }
    return { auditLoggingEnabled: false }; // Default value
}

// GUID: ADMIN_AUDIT-003-v03
// [Intent] Writes updated audit settings to the admin_configuration/global Firestore document using merge to preserve other fields.
// [Inbound Trigger] Called when the admin clicks "Save Settings" after toggling the audit switch.
// [Downstream Impact] Changes the global auditLoggingEnabled flag; all audit logging throughout the system reads this to decide whether to record events.
async function updateAuditSettings(db: any, settings: Partial<AuditSettings>) {
    const docRef = doc(db, "admin_configuration", "global");
    await setDoc(docRef, settings, { merge: true });
}

// GUID: ADMIN_AUDIT-004-v03
// [Intent] Main exported component providing a toggle switch and save button for enabling/disabling global audit logging.
// [Inbound Trigger] Mounted by the admin page when the Audit Settings section is active.
// [Downstream Impact] Persists the auditLoggingEnabled flag to admin_configuration/global; controls whether audit_logs are recorded system-wide.
export function AuditManager() {
    const firestore = useFirestore();
    const { toast } = useToast();

    const [settings, setSettings] = useState<AuditSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // GUID: ADMIN_AUDIT-005-v03
    // [Intent] Loads the current audit settings from Firestore on component mount.
    // [Inbound Trigger] Runs when the firestore instance becomes available.
    // [Downstream Impact] Populates the settings state that drives the toggle UI; sets error state if fetch fails.
    useEffect(() => {
        if (firestore) {
            getAuditSettings(firestore)
                .then(setSettings)
                .catch(setError)
                .finally(() => setLoading(false));
        }
    }, [firestore]);

    // GUID: ADMIN_AUDIT-006-v03
    // [Intent] Persists the current audit logging toggle state to Firestore and shows a success/failure toast.
    // [Inbound Trigger] Called when the admin clicks the "Save Settings" button.
    // [Downstream Impact] Writes to admin_configuration/global; affects whether audit logs are recorded across the entire system.
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

    // GUID: ADMIN_AUDIT-007-v03
    // [Intent] Updates the local settings state when the toggle switch is changed, without persisting until save.
    // [Inbound Trigger] Called by the Switch component's onCheckedChange event.
    // [Downstream Impact] Changes local state only; the save button must be clicked to persist to Firestore.
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
