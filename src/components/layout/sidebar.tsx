"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronsLeft,
  FileText,
  FolderKanban,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api } from "@/lib/client";
import { toast } from "sonner";

const navItems: { icon: typeof LayoutDashboard; label: string; href: string; adminOnly?: boolean }[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: FolderKanban, label: "Projects", href: "/dashboard/projects" },
  { icon: CheckSquare, label: "Issues", href: "/dashboard/issues" },
  { icon: Layers, label: "Board", href: "/dashboard/kanban" },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar" },
  { icon: FileText, label: "Documents", href: "/dashboard/documents" },
  { icon: Users, label: "Teams", href: "/dashboard/teams" },
  { icon: ShieldCheck, label: "Approvals", href: "/dashboard/approvals", adminOnly: true },
  { icon: HardDrive, label: "Storage", href: "/dashboard/storage", adminOnly: true },
  { icon: Gauge, label: "Performance", href: "/dashboard/performance" },
  { icon: Layers, label: "Workspaces", href: "/dashboard/workspaces" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { workspace, workspaces, selectWorkspace, refresh } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("melouz:open-mobile-nav", open);
    return () => window.removeEventListener("melouz:open-mobile-nav", open);
  }, []);

  const createWorkspace = async () => {
    const name = window.prompt("Workspace name");
    if (!name || name.trim().length < 2) return;
    try {
      const ws = await api<{ id: string }>("/api/workspaces", {
        method: "POST",
        body: { name: name.trim() },
      });
      await refresh();
      selectWorkspace(ws.id);
      toast.success(`Workspace "${name.trim()}" created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create workspace");
    }
  };

  return (
    <>
    {mobileOpen && (
      <button
        aria-label="Close navigation"
        className="fixed inset-0 z-40 bg-black/20 md:hidden"
        onClick={() => setMobileOpen(false)}
      />
    )}
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-72 max-md:shadow-xl max-md:transition-transform",
        mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        "md:flex",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className="flex h-14 items-center justify-between gap-1 border-b border-sidebar-border px-3 py-2">
        {!collapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-sidebar-accent">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                M
              </span>
              <span className="truncate">{workspace?.name ?? "No workspace"}</span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onClick={() => selectWorkspace(w.id)}>
                  <span className="truncate">{w.name}</span>
                  {w.id === workspace?.id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={createWorkspace}>
                <Plus className="h-4 w-4" />
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 shrink-0 hover:bg-sidebar-accent", collapsed && "mx-auto")}
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </Button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {navItems.filter((item) => !item.adminOnly || workspace?.role === "admin" || workspace?.role === "owner").map((item) => {
          const active =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                collapsed && "justify-center px-1.5"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
        <button
          onClick={() => {
            setMobileOpen(false);
            window.dispatchEvent(new CustomEvent("melouz:open-messages"));
          }}
          title={collapsed ? "Messages" : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            collapsed && "justify-center px-1.5"
          )}
        >
          <MessageSquare className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">Messages</span>}
        </button>
      </nav>

      {!collapsed && (
        <div className="border-t border-sidebar-border px-3 py-2 text-[11px] text-muted-foreground">
          Press <kbd className="rounded border px-1">⌘K</kbd> to search
        </div>
      )}
    </aside>
    </>
  );
}
