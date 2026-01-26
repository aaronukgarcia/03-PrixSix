
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

export function AppSidebar() {
  const { user, firebaseUser, logout } = useAuth();
  const firestore = useFirestore();
  const pathname = usePathname();

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
