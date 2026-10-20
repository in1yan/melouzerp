"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar, EmptyState, PriorityIndicator, StatusBadge } from "@/components/shared/meta";
import { IssueDialog } from "@/components/issues/issue-dialog";
import { NewIssueDialog } from "@/components/issues/new-issue-dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { ISSUE_STATUSES, PRIORITIES } from "@/lib/types";
import type { IssueStatus, Priority } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

interface IssueRow {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: Priority;
  due_date: string | null;
  project: { id: string; name: string; key: string };
  assignee: { id: string; name: string; avatar_color: string } | null;
  parent_id: string | null;
  subtask_count: number;
}

const selectCls = "h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring";

function IssuesPageInner() {
  const { workspace, loading: wsLoading } = useWorkspace();
  const router = useRouter();
  const search = useSearchParams();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState(search.get("project") ?? "");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [showSubtasks, setShowSubtasks] = useState(true);

  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(search.get("issue"));

  const openDetail = useCallback((id: string | null) => {
    setDetailId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("issue", id);
    else params.delete("issue");
    router.replace(`/dashboard/issues?${params.toString()}`, { scroll: false });
  }, [router]);

  const loadProjects = useCallback(() => {
    if (!workspace) return;
    api<{ projects: ProjectOption[] }>(`/api/projects?workspace=${workspace.id}`)
      .then((res) => {
        setProjects(res.projects);
        return api<{ user: { id: string; name: string } }[]>(
          `/api/workspaces/${workspace.id}/members`
        );
      })
      .then((mem) => setMembers(mem.map((m) => m.user)))
      .catch(() => {
        // handled by issue load error state
      });
  }, [workspace]);

  const loadIssues = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace: workspace.id });
      if (projectFilter) params.set("project", projectFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (assigneeFilter) params.set("assignee", assigneeFilter);
      if (query.trim()) params.set("q", query.trim());
      const data = await api<IssueRow[]>(`/api/issues?${params.toString()}`);
      setIssues(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [workspace, projectFilter, statusFilter, priorityFilter, assigneeFilter, query]);

  useEffect(() => {
    if (!wsLoading) loadProjects();
  }, [wsLoading, loadProjects]);

  useEffect(() => {
    const t = setTimeout(loadIssues, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [loadIssues, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && e.key === "c" && !e.metaKey && !e.ctrlKey && !newOpen) {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [newOpen]);

  const visible = useMemo(
    () => (showSubtasks ? issues : issues.filter((i) => !i.parent_id)),
    [issues, showSubtasks]
  );

  const hasFilters = Boolean(projectFilter || statusFilter || priorityFilter || assigneeFilter || query);
  const today = new Date().toISOString().slice(0, 10);

  const clearFilters = () => {
    setProjectFilter("");
    setStatusFilter("");
    setPriorityFilter("");
    setAssigneeFilter("");
    setQuery("");
  };

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace to see issues."
          action={null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
          <p className="text-sm text-muted-foreground">
            {visible.length} {visible.length === 1 ? "issue" : "issues"}
            {hasFilters && " (filtered)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setNewOpen(true)} disabled={projects.length === 0}>
            <Plus className="h-4 w-4" /> New issue
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, description, key…"
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectCls}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">Any status</option>
          {ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={selectCls}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={selectCls}>
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showSubtasks}
            onChange={(e) => setShowSubtasks(e.target.checked)}
            className="h-3.5 w-3.5 rounded border"
          />
          Show subtasks
        </label>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <Button variant="outline" size="sm" className="ml-3 h-7" onClick={loadIssues}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-md border bg-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No issues match your filters" : "No issues yet"}
          description={
            hasFilters
              ? "Try clearing filters or search for something else."
              : "Create your first issue to start tracking work in this workspace."
          }
          action={
            !hasFilters && projects.length > 0 ? (
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> New issue
              </Button>
            ) : projects.length === 0 ? (
              <span className="text-xs text-muted-foreground">Create a project first.</span>
            ) : null
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-[7rem_1fr_8rem_7rem_8rem] items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Key</span>
            <span>Title</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Assignee / due</span>
          </div>
          {visible.map((i) => {
            const overdue = i.due_date && i.status !== "done" && i.due_date < today;
            return (
              <button
                key={i.id}
                onClick={() => openDetail(i.id)}
                className="grid w-full grid-cols-[7rem_1fr_8rem_7rem_8rem] items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/60"
              >
                <span className="truncate font-mono text-xs text-muted-foreground">{i.key}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {i.parent_id && <span className="text-muted-foreground" title="Subtask">└</span>}
                  <span className="truncate">{i.title}</span>
                  {i.subtask_count > 0 && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {i.subtask_count} sub
                    </span>
                  )}
                </span>
                <StatusBadge status={i.status} />
                <PriorityIndicator priority={i.priority} withLabel />
                <span className="flex items-center justify-between gap-2">
                  {i.assignee ? (
                    <Avatar name={i.assignee.name} color={i.assignee.avatar_color} size="sm" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {i.due_date && (
                    <span className={cn("text-xs tabular-nums", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {i.due_date === today ? "Today" : format(new Date(i.due_date + "T00:00:00"), "MMM d")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {newOpen && (
        <NewIssueDialog
          open
          onOpenChange={setNewOpen}
          projects={projects}
          workspaceId={workspace?.id ?? ""}
          defaultProjectId={projectFilter || null}
          onCreated={loadIssues}
        />
      )}
      <IssueDialog issueId={detailId} open={Boolean(detailId)} onOpenChange={(o) => !o && openDetail(null)} onChanged={loadIssues} />
    </div>
  );
}

export default function IssuesPage() {
  return (
    <Suspense>
      <IssuesPageInner />
    </Suspense>
  );
}
