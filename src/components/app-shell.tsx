import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Inbox,
  KeyRound,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Music,
  Send,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { PushPayload } from "@shared/types";
import { FlareMark } from "@/components/brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { initials } from "@/lib/format";
import { signOut } from "@/lib/session";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

const MAIN_NAV = [
  { to: "/", label: "Feed", icon: Inbox, end: true },
  { to: "/send", label: "Send", icon: Send },
  { to: "/devices", label: "Devices", icon: Smartphone },
];

const MANAGE_NAV = [
  { to: "/apps", label: "Apps & API keys", icon: KeyRound },
  { to: "/groups", label: "Groups", icon: Users },
  { to: "/sounds", label: "Sounds", icon: Music },
  { to: "/docs", label: "API docs", icon: BookOpen },
];

/** Under the ["feed"] key so every feed invalidation refreshes it too. */
function useUnreadCount() {
  const q = useQuery({ queryKey: ["feed", "count"], queryFn: api.unreadCount, refetchInterval: 60_000 });
  return q.data?.unread ?? 0;
}

/** Listens for messages from the service worker: new pushes, navigation requests and refreshes. */
function useServiceWorkerEvents() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; payload?: PushPayload; path?: string };
      if (msg?.type === "flare:push" && msg.payload) {
        void qc.invalidateQueries({ queryKey: ["feed"] });
        const p = msg.payload;
        if (document.visibilityState === "visible") {
          if (p.priority >= 0 && p.sound !== "none") playSound(p.sound, p.soundUrl);
          if (p.priority === 2) toast.error(p.title, { description: p.body });
        }
      } else if (msg?.type === "flare:navigate" && msg.path) {
        navigate(msg.path);
        void qc.invalidateQueries({ queryKey: ["feed"] });
      } else if (msg?.type === "flare:refresh") {
        void qc.invalidateQueries({ queryKey: ["feed"] });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [qc, navigate]);
}

function NavItems({ items, unread }: { items: typeof MAIN_NAV; unread?: number }) {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
              <NavLink to={item.to} end={item.end} onClick={() => setOpenMobile(false)}>
                <item.icon />
                <span>{item.label}</span>
              </NavLink>
            </SidebarMenuButton>
            {item.to === "/" && unread ? <SidebarMenuBadge>{unread > 99 ? "99+" : unread}</SidebarMenuBadge> : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function UserMenu() {
  const { user } = useMe();
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
          <Avatar className="size-8">
            {user.picture && <AvatarImage src={user.picture} alt="" />}
            <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name ?? user.email}</span>
            {user.name && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
          </div>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSidebar() {
  const { user } = useMe();
  const unread = useUnreadCount();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/">
                <FlareMark className="size-8 shrink-0" />
                <span className="text-base font-semibold tracking-tight">Flare</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavItems items={MAIN_NAV} unread={unread} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={MANAGE_NAV} />
          </SidebarGroupContent>
        </SidebarGroup>
        {user.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavItems items={[{ to: "/admin", label: "Users", icon: ShieldCheck }]} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Bottom tab bar for phones. "More" opens the sidebar as a sheet. */
function MobileTabBar() {
  const { setOpenMobile } = useSidebar();
  const unread = useUnreadCount();
  const tab = "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/95 pb-safe backdrop-blur md:hidden">
      {MAIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => cn(tab, isActive && "text-primary")}
        >
          <span className="relative">
            <item.icon className="size-5" />
            {item.to === "/" && unread > 0 && (
              <Badge className="absolute -top-2 -right-3 h-4 min-w-4 px-1 text-[10px]">{unread > 99 ? "99+" : unread}</Badge>
            )}
          </span>
          {item.label}
        </NavLink>
      ))}
      <button type="button" className={tab} onClick={() => setOpenMobile(true)}>
        <Menu className="size-5" />
        More
      </button>
    </nav>
  );
}

export function AppShell() {
  useServiceWorkerEvents();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="mx-auto w-full max-w-4xl px-4 pt-safe pb-24 sm:px-6 md:pb-10">
          <Outlet />
        </div>
      </SidebarInset>
      <MobileTabBar />
    </SidebarProvider>
  );
}
