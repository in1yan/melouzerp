"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Bell, LogOut, Menu, MessageSquare, Moon, Search, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/shared/meta";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api } from "@/lib/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

const emptySubscribe = () => () => {};

export function Header() {
  const { user } = useWorkspace();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const loadNotifications = () => {
    api<{ notifications: NotificationItem[]; unread: number }>("/api/notifications")
      .then((data) => {
        setNotifications(data.notifications);
        setUnread(data.unread);
      })
      .catch(() => {
        // ignore transient errors
      });
  };

  useEffect(() => {
    loadNotifications();
    const id = setInterval(loadNotifications, 45000);
    return () => clearInterval(id);
  }, []);

  const openSearch = () => window.dispatchEvent(new CustomEvent("melouz:open-search"));

  const markAllRead = async () => {
    try {
      await api("/api/notifications", { method: "PATCH", body: { all: true } });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update notifications");
    }
  };

  const openNotification = async (n: NotificationItem) => {
    if (!n.read) {
      try {
        await api("/api/notifications", { method: "PATCH", body: { ids: [n.id] } });
        setUnread((u) => Math.max(0, u - 1));
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      } catch {
        // navigation still proceeds
      }
    }
    if (n.link) router.push(n.link);
  };

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // cookie cleared server-side best effort
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/80 bg-background px-3 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 md:hidden"
        title="Open navigation"
        onClick={() => window.dispatchEvent(new CustomEvent("melouz:open-mobile-nav"))}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <button
        onClick={openSearch}
        className="flex h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-border/80 bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="truncate">Search issues, projects, docs…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:inline">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Messages"
          onClick={() => window.dispatchEvent(new CustomEvent("melouz:open-messages"))}
        >
          <MessageSquare className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                  Mark all read
                </Button>
              )}
            </div>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {notifications.slice(0, 15).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                      <span className={n.read ? "text-sm font-normal" : "text-sm font-medium"}>{n.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{n.message}</span>
                  </button>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="ml-1 flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Account menu"
          >
            <Avatar name={user.name} color={user.avatar_color} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2.5">
                <Avatar name={user.name} color={user.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{user.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
