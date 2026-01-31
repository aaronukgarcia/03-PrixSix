// GUID: COMPONENT_APP_SIDEBAR-000-v04
// [Intent] Main application sidebar component providing navigation links, admin panel access,
// user profile display, and logout functionality. Renders within the ShadCN Sidebar layout.
// [Inbound Trigger] Rendered by the authenticated app layout on every page within the (app) route group.
// [Downstream Impact] Provides primary navigation for the entire app. Changes to menuItems affect
// all users' navigation. Logout handler updates presence and triggers auth state teardown.
// @FIX(v04) Replaced flat "Results" menu item with a collapsible sub-menu containing
// "Race Results" (/results) and "My Results" (/my-results).

"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarContent,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
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
  Calendar,
  ChevronRight,
  User,
} from "lucide-react";
import { useAuth, useFirestore, setDocumentNonBlocking } from "@/firebase";
import { Logo } from "@/components/Logo";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "../ui/button";
import { doc, serverTimestamp } from "firebase/firestore";
import { logAuditEvent } from "@/lib/audit";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

// GUID: COMPONENT_APP_SIDEBAR-001-v04
// [Intent] Menu items rendered ABOVE the Results collapsible group.
const menuItemsTop = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/predictions", label: "Predictions", icon: Rocket },
  { href: "/standings", label: "Standings", icon: Trophy },
];

// GUID: COMPONENT_APP_SIDEBAR-001B-v04
// [Intent] Menu items rendered BELOW the Results collapsible group.
const menuItemsBottom = [
  { href: "/submissions", label: "Submissions", icon: FileCheck },
  { href: "/audit", label: "Audit", icon: History },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/leagues", label: "Leagues", icon: Users2 },
  { href: "/rules", label: "Rules", icon: ScrollText },
  { href: "/about", label: "About", icon: Info },
];

// GUID: COMPONENT_APP_SIDEBAR-002-v04
export function AppSidebar() {
  const { user, firebaseUser, logout } = useAuth();
  const firestore = useFirestore();
  const pathname = usePathname();

  const isResultsSection = pathname.startsWith("/results") || pathname.startsWith("/my-results");

  // GUID: COMPONENT_APP_SIDEBAR-003-v04
  const handleLogout = async () => {
    if (firebaseUser && firestore) {
      const presenceRef = doc(firestore, "presence", firebaseUser.uid);
      await setDocumentNonBlocking(presenceRef, { online: false, last_seen: serverTimestamp() }, { merge: true });
      logAuditEvent(firestore, firebaseUser.uid, 'logout', { source: 'sidebar' });
    }
    await logout();
  }

  const renderMenuItem = (item: { href: string; label: string; icon: any }) => (
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
  );

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
          {menuItemsTop.map(renderMenuItem)}

          {/* GUID: COMPONENT_APP_SIDEBAR-004-v04
              [Intent] Collapsible "Results" group with Race Results and My Results sub-items.
              Auto-expands when the current route is within the results section. */}
          <Collapsible defaultOpen={isResultsSection} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  isActive={isResultsSection}
                  tooltip="Results"
                >
                  <BarChart2 />
                  <span>Results</span>
                  <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={pathname.startsWith("/results")}
                    >
                      <Link href="/results">
                        <Trophy className="h-4 w-4" />
                        <span>Race Results</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      asChild
                      isActive={pathname.startsWith("/my-results")}
                    >
                      <Link href="/my-results">
                        <User className="h-4 w-4" />
                        <span>My Results</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>

          {menuItemsBottom.map(renderMenuItem)}

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
