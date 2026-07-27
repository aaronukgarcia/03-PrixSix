// GUID: COMPONENT_APP_SIDEBAR-000-v08
// @FIX(v08, NEWBIE-07) Completed the Getting Started pinning: v07 declared the onboardingItem
// constant but never rendered it, leaving the link out of the nav entirely. Now rendered pinned
// at the top while onboarding is incomplete, in the bottom group otherwise.
// [Intent] Main application sidebar component providing navigation links, admin panel access,
// user profile display, and logout functionality. Renders within the ShadCN Sidebar layout.
// [Inbound Trigger] Rendered by the authenticated app layout on every page within the (app) route group.
// [Downstream Impact] Provides primary navigation for the entire app. Changes to menuItems affect
// all users' navigation. Logout handler updates presence and triggers auth state teardown.
// @FIX(v04) Replaced flat "Results" menu item with a collapsible sub-menu containing
// "Race Results" (/results) and "My Results" (/my-results).
// @UX(NEWBIE-01/-03/-07, v07) Newbie-experience renames: "PubChat"→"Live Timing" (route stays /live),
// "Audit"→"My Activity" (route stays /audit). "Getting Started" is pinned to the TOP of the nav
// while the onboarding checklist is incomplete (read from the same localStorage key the
// /onboarding page writes) and drops back to the bottom group once complete.

"use client";

import { useEffect, useState } from "react";
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
  useSidebar,
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
  BookOpen,
  HelpCircle,
  Radio,
  TowerControl,
  UserPlus,
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

// GUID: COMPONENT_APP_SIDEBAR-001-v08
// [Intent] Menu items rendered ABOVE the Results collapsible group.
// @FIX(v07) Added Pit Wall (/pit-wall) after PubChat — live race data module.
// @UX(NEWBIE-01, v08) "PubChat" renamed to "Live Timing" — the route (/live) and the page
// component already called it Live Timing; the nav was the odd one out for newcomers.
const menuItemsTop = [
  { href: "/dashboard",   label: "Dashboard",    icon: LayoutDashboard },
  { href: "/schedule",    label: "Schedule",      icon: Calendar },
  { href: "/predictions", label: "Predictions",   icon: Rocket },
  { href: "/standings",   label: "Standings",     icon: Trophy },
  { href: "/live",        label: "Live Timing",    icon: Radio },
  { href: "/pit-wall",    label: "Pit Wall",       icon: TowerControl },
];

// GUID: COMPONENT_APP_SIDEBAR-001B-v07
// [Intent] Menu items rendered BELOW the Results collapsible group.
// @FIX(v05) Added "Getting Started" link to surface onboarding permanently in navigation.
// Renamed "About" to "Help" with HelpCircle icon for clearer discoverability.
// @FIX(v06) Added "Invite a Friend" (/invite) — members send single-use signup invites
//           (SEC-SIGNUP-001 friend-invite system).
// @UX(NEWBIE-03, v07) "Audit" renamed to "My Activity" — "Audit" read like a compliance tool
// to new users; the page shows the user's own account activity. Route stays /audit.
// @UX(NEWBIE-07, v07) "Getting Started" moved out of this constant — see onboardingItem below;
// it is pinned to the top of the nav while onboarding is incomplete.
const menuItemsBottom = [
  { href: "/invite", label: "Invite a Friend", icon: UserPlus },
  { href: "/submissions", label: "Submissions", icon: FileCheck },
  { href: "/audit", label: "My Activity", icon: History },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/leagues", label: "Leagues", icon: Users2 },
  { href: "/rules", label: "Rules", icon: ScrollText },
  { href: "/about", label: "Help", icon: HelpCircle },
];

// GUID: COMPONENT_APP_SIDEBAR-005-v02
// @UX(NEWBIE-07) The "Getting Started" nav item, rendered at the TOP of the menu while the
// onboarding checklist is incomplete, and in the bottom group once complete.
// CONSTRAINT: ONBOARDING_PROGRESS_KEY and the flag names MUST stay in sync with
// PAGE_ONBOARDING-001/-002 in app/(app)/onboarding/page.tsx — that page owns the schema.
// Missing/corrupt localStorage counts as "incomplete" (safe default: surface the checklist).
// @FIX(v02, NEWBIE-07) v01 defined this item + reader but never rendered them — the component
// still showed nothing for "Getting Started". Now wired into AppSidebar: localStorage is read
// after mount (SSR-safe), and the item is pinned above menuItemsTop while incomplete.
const onboardingItem = { href: "/onboarding", label: "Getting Started", icon: BookOpen };
const ONBOARDING_PROGRESS_KEY = "prix-six-onboarding-progress";
const ONBOARDING_FLAGS = ["emailVerified", "gameLearned", "predictionMade", "paddockExplored", "gridJoined"] as const;

function readOnboardingComplete(): boolean {
  try {
    const stored = localStorage.getItem(ONBOARDING_PROGRESS_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored);
    return ONBOARDING_FLAGS.every((flag) => parsed?.[flag] === true);
  } catch {
    // Corrupt localStorage — treat as incomplete rather than hiding the checklist (fail-visible).
    return false;
  }
}

// GUID: COMPONENT_APP_SIDEBAR-002-v05
// @UX(NEWBIE-07, v05) Renders the "Getting Started" item pinned at the top while onboarding is
// incomplete (localStorage check, post-hydration), otherwise in the bottom group.
export function AppSidebar() {
  const { user, firebaseUser, logout } = useAuth();
  const firestore = useFirestore();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  // @UX(NEWBIE-07): null = not yet checked (SSR / pre-hydration) — render in the bottom group
  // (stable legacy position, no hydration mismatch). After mount, incomplete onboarding pins
  // the item to the top of the nav. Re-checked on route change so completing the last step
  // moves it down without a full reload.
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  useEffect(() => {
    setOnboardingComplete(readOnboardingComplete());
  }, [pathname]);
  const pinGettingStarted = onboardingComplete === false;

  const isResultsSection = pathname.startsWith("/results") || pathname.startsWith("/my-results");

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

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
          {/* @UX(NEWBIE-07): "Getting Started" pinned to the top while onboarding incomplete */}
          {pinGettingStarted && renderMenuItem(onboardingItem)}
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
          {/* @UX(NEWBIE-07): once onboarding is complete (or not yet checked), "Getting Started"
              lives in its legacy bottom-group position */}
          {!pinGettingStarted && renderMenuItem(onboardingItem)}

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
