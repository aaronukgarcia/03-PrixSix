// GUID: PAGE_ADMIN_SERVER-000-v01
// [Intent] Server Component wrapper for admin page that securely reads httpOnly cookie
//          for admin verification status. Prevents XSS-based verification bypass.
// [Inbound Trigger] User navigates to /admin route.
// [Downstream Impact] Reads adminVerified httpOnly cookie server-side and passes verification
//                     status to client component. Resolves security vulnerability where
//                     client-readable cookies could be manipulated via XSS.

import { cookies } from 'next/headers';
import AdminPageClient from './AdminPageClient';

// GUID: PAGE_ADMIN_SERVER-001-v01
// [Intent] Server Component that securely reads httpOnly adminVerified cookie and
//          passes verification status to client component as prop.
// [Inbound Trigger] Route navigation to /admin.
// [Downstream Impact] Server-side cookie check prevents XSS manipulation. Client component
//                     receives verified status that cannot be forged client-side.
export default async function AdminPage() {
    // GUID: PAGE_ADMIN_SERVER-002-v01
    // [Intent] Read httpOnly adminVerified cookie server-side. This cookie is set by
    //          /api/admin/verify-access after successful magic link verification.
    // [Inbound Trigger] Server component render.
    // [Downstream Impact] Secure cookie read that cannot be manipulated by client-side JS or XSS.
    //                     Only the server can read httpOnly cookies, preventing bypass attacks.
    const cookieStore = await cookies();
    const adminVerifiedCookie = cookieStore.get('adminVerified');
    const initialVerified = adminVerifiedCookie?.value === 'true';

    // GUID: PAGE_ADMIN_SERVER-003-v01
    // [Intent] Pass server-verified admin status to client component.
    // [Inbound Trigger] After reading cookie.
    // [Downstream Impact] Client component receives trusted verification status.
    //                     Even if XSS exists, attacker cannot forge this prop as it comes from server.
    return <AdminPageClient initialVerified={initialVerified} />;
}
