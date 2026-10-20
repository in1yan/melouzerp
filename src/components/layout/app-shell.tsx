"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/shared/command-palette";
import { AIAssistant } from "@/components/shared/ai-assistant";
import { MessagesDrawer } from "@/components/shared/messages-drawer";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import type { User, WorkspaceSummary } from "@/lib/types";

function UnauthorizedRedirect() {
  const router = useRouter();
  useEffect(() => {
    const handler = () => router.push("/login");
    window.addEventListener("melouz:unauthorized", handler);
    return () => window.removeEventListener("melouz:unauthorized", handler);
  }, [router]);
  return null;
}

export function AppShell({
  user,
  workspaces,
  initialActiveId,
  children,
}: {
  user: User;
  workspaces: WorkspaceSummary[];
  initialActiveId: string | null;
  children: React.ReactNode;
}) {
  const [messagesOpen, setMessagesOpen] = useState(false);

  useEffect(() => {
    const handler = () => setMessagesOpen(true);
    window.addEventListener("melouz:open-messages", handler);
    return () => window.removeEventListener("melouz:open-messages", handler);
  }, []);

  return (
    <WorkspaceProvider user={user} initialWorkspaces={workspaces} initialActiveId={initialActiveId}>
      <UnauthorizedRedirect />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto bg-background">{children}</main>
        </div>
        <CommandPalette />
        <AIAssistant />
        <MessagesDrawer open={messagesOpen} onOpenChange={setMessagesOpen} />
      </div>
    </WorkspaceProvider>
  );
}
