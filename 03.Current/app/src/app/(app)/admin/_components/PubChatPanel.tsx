// GUID: PUBCHAT_PANEL-000-v01
// [Intent] Admin panel wrapper for the PubChat tab. Renders the ThePaddockPubChat
//          animation at the top with a placeholder Card below for body content
//          that will be built by another session.
// [Inbound Trigger] Rendered when the admin selects the "PubChat" tab on the admin page.
// [Downstream Impact] Read-only placeholder — no Firestore writes. Animation component
//                     is self-contained. Placeholder section to be replaced later.
'use client';

import ThePaddockPubChat from '@/components/ThePaddockPubChat';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Beer } from 'lucide-react';

// GUID: PUBCHAT_PANEL-001-v01
// [Intent] PubChatPanel component — centres the pub chat animation and shows a
//          placeholder card below it for future body content.
// [Inbound Trigger] Mounted by TabsContent value="pubchat" in admin/page.tsx.
// [Downstream Impact] None — purely presentational with a placeholder for later work.
export function PubChatPanel() {
    return (
        <div className="space-y-6">
            {/* GUID: PUBCHAT_PANEL-002-v01
                [Intent] Centre the ThePaddockPubChat animation at the top of the panel.
                [Inbound Trigger] Component mount.
                [Downstream Impact] Renders the self-contained F1 pre-season animation. */}
            <div className="flex justify-center">
                <ThePaddockPubChat />
            </div>

            {/* GUID: PUBCHAT_PANEL-003-v01
                [Intent] Placeholder card for body content being prepared by another session.
                [Inbound Trigger] Component mount.
                [Downstream Impact] None — static placeholder text. To be replaced with
                                    actual PubChat management UI by another Claude session. */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Beer className="h-5 w-5" />
                        The Paddock Pub Chat
                    </CardTitle>
                    <CardDescription>
                        Manage pub chat sessions and social events for the league.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Content coming soon — being prepared by another session.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
