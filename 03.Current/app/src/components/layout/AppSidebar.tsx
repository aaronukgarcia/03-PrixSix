// GUID: COMPONENT_APP_SIDEBAR-000-v03
// [Intent] Main application sidebar component providing navigation links, admin panel access,
// user profile display, and logout functionality. Renders within the ShadCN Sidebar layout.
// [Inbound Trigger] Rendered by the authenticated app layout on every page within the (app) route group.
// [Downstream Impact] Provides primary navigation for the entire app. Changes to menuItems affect
// all users' navigation. Logout handler updates presence and triggers auth state teardown.

"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarContent,
} from "@/components/ui/sidebar";
import {
  BarChart2,
  Trophy,
  Users,
  Users2,
  ScrollText,
  Rocket,
  Shield,
  LogOut,
  LayoutDashboard,
  Info,
  FileCheck,
  History,
  Calendar
} from "lucide-react";
import { useAuth, useFirestore, setDocumentNonBlocking } from "@/firebase";
import { Logo } from "@/components/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "../ui/button";
import { doc, serverTimestamp } from "firebase/firestore";
import { logAuditEvent } from "@/lib/audit";

// GUID: COMPONENT_APP_SIDEBAR-001-v03
// [Intent] Static menu item configuration defining all navigation routes available to regular users.
// Each entry maps a URL path to a label and Lucide icon component.
// [Inbound Trigger] Read at render time by the sidebar menu loop.
// [Downstream Impact] Adding/removing entries changes navigation for all users. The admin panel
// link is handled separately (COMPONENT_APP_SIDEBAR-003) and is not in this array.
const menuItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/predictions", label: "Predictions", icon: Rocket },
  { href: "/standings", label: "Standings", icon: Trophy },
  { href: "/results", label: "Results", icon: BarChart2 },
  { href: "/submissions", label: "Submissions", icon: FileCheck },
  { href: "/audit", label: "Audit", icon: History },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/leagues", label: "Leagues", icon: Users2 },
  { href: "/rules", label: "Rules", icon: ScrollText },
  { href: "/about", label: "About", icon: Info },
];

// GUID: COMPONENT_APP_SIDEBAR-002-v03
// [Intent] Exported sidebar component that renders the full navigation sidebar including header
// with logo, scrollable menu items, conditional admin link, user avatar footer, and logout button.
// [Inbound Trigger] Rendered by the app layout shell on every authenticated page.
// [Downstream Impact] Uses useAuth() for user data and logout, useFirestore() for presence updates.
// Active route highlighting depends on usePathname(). Breaking this component removes all navigation.
export function AppSidebar() {
  const { user, firebaseUser, logout } = useAuth();
  const firestore = useFirestore();
  const pathname = usePathname();

  // GUID: COMPONENT_APP_SIDEBAR-003-v03
  // [Intent] Handles user logout by first setting the Firestore presence document to offline,
  // logging an audit event, then calling the provider's logout function for full sign-out.
  // [Inbound Trigger] User clicks the logout icon button in the sidebar footer.
  // [Downstream Impact] Sets presence to offline (non-blocking), logs audit event, then delegates
  // to FIREBASE_PROVIDER-014 which signs out, clears state, and redirects to /login.
  const handleLogout = async () => {
    if (firebaseUser && firestore) {
      const presenceRef = doc(firestore, "presence", firebaseUser.uid);
      // Explicitly set user to offline before signing out
      await setDocumentNonBlocking(presenceRef, { online: false, last_seen: serverTimestamp() }, { merge: true });
      logAuditEvent(firestore, firebaseUser.uid, 'logout', { source: 'sidebar' });
    }
    await logout();
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <div className="flex flex-col">
            <span className="font-headline text-lg tracking-tight">Prix Six</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <Link href={item.href} className="w-full">
                <SidebarMenuButton
                  isActive={pathname.startsWith(item.href)}
                  tooltip={item.label}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
          {user?.isAdmin && (
             <SidebarMenuItem>
                 <Link href="/admin" className="w-full">
                    <SidebarMenuButton
                        isActive={pathname.startsWith("/admin")}
                        tooltip="Admin"
                        >
                        <Shield />
                        <span>Admin Panel</span>
                    </SidebarMenuButton>
                 </Link>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-3">
          <Link href="/profile" className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.photoUrl || `https://picsum.photos/seed/${user?.id}/100/100`} data-ai-hint="person avatar"/>
              <AvatarFallback>{user?.teamName?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-semibold truncate">{user?.teamName}</span>
              <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
            </div>
          </Link>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8">
             <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
