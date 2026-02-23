// GUID: ADMIN_AUDIT-000-v04
// @SECURITY_FIX: Removed audit logging toggle UI (GEMINI-AUDIT-002). Audit logging is always-on
//               and cannot be disabled via the admin panel. Replaced toggle with informational card.
// [Intent] Admin component displaying the audit logging status. Logging is permanently enabled;
//          the only way to change this behaviour is a code change and deployment.
// [Inbound Trigger] Rendered on the admin Audit Settings tab.
// [Downstream Impact] Read-only — no Firestore writes. Removing toggle eliminates the
//                     authorization-bypass-via-audit-disable attack vector.

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

// GUID: ADMIN_AUDIT-001-v04
// [Intent] Read-only admin component that displays the audit logging status as always-on.
//          Replaces the former toggle UI that allowed admins to disable audit logging (GEMINI-AUDIT-002 fix).
// [Inbound Trigger] Mounted by the admin page Audit Settings section.
// [Downstream Impact] No Firestore reads or writes. Status badge is hardcoded to reflect the
//                     code-enforced always-on behaviour in lib/audit.ts.
export function AuditManager() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-green-500" />
                    Audit System Control
                </CardTitle>
                <CardDescription>
                    User activity and error audit logging status.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <p className="text-base font-medium">Audit Logging</p>
                        <p className="text-sm text-muted-foreground">
                            Always enabled. Audit logging is a security control and cannot be
                            disabled at runtime. A code change and deployment is required to
                            modify this behaviour.
                        </p>
                    </div>
                    <Badge className="bg-green-600 hover:bg-green-600 shrink-0 ml-4">Always On</Badge>
                </div>
            </CardContent>
        </Card>
    );
}
