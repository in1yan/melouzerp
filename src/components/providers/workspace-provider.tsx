"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/client";
import type { WorkspaceSummary } from "@/lib/types";
import type { User } from "@/lib/types";

interface WorkspaceContextValue {
  user: User;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary | null;
  loading: boolean;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export const ACTIVE_WORKSPACE_COOKIE = "melouz.activeWorkspace";

export function WorkspaceProvider({
  user,
  initialWorkspaces,
  initialActiveId,
  children,
}: {
  user: User;
  initialWorkspaces: WorkspaceSummary[];
  initialActiveId: string | null;
  children: ReactNode;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(initialWorkspaces);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);

  const refresh = useCallback(async () => {
    try {
      const data = await api<WorkspaceSummary[]>("/api/workspaces");
      setWorkspaces(data);
      setActiveId((current) => {
        if (current && data.some((w) => w.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch {
      // keep current state; api() handles 401 redirect
    }
  }, []);

  const selectWorkspace = useCallback((id: string) => {
    setActiveId(id);
    document.cookie = `${ACTIVE_WORKSPACE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId]
  );

  const value = useMemo(
    () => ({ user, workspaces, workspace, loading: false, selectWorkspace, refresh }),
    [user, workspaces, workspace, selectWorkspace, refresh]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
