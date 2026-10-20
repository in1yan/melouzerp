"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar, EmptyState, PriorityIndicator, StatusBadge } from "@/components/shared/meta";
import { IssueDialog } from "@/components/issues/issue-dialog";
import { NewIssueDialog } from "@/components/issues/new-issue-dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ISSUE_STATUSES } from "@/lib/types";
import type { IssueStatus, Priority } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

interface BoardIssue {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: Priority;
  due_date: string | null;
  order: number;
  assignee: { id: string; name: string; avatar_color: string } | null;
  project: { id: string; name: string; key: string };
  subtask_count: number;
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const STATUS_DOT: Record<IssueStatus, string> = {
  backlog: "bg-slate-400",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  review: "bg-violet-500",
  done: "bg-emerald-500",
};

function Card({
  issue,
  onOpen,
  draggable = true,
  overlay = false,
}: {
  issue: BoardIssue;
  onOpen: (id: string) => void;
  draggable?: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${issue.id}`,
    disabled: !draggable,
  });

  const style: React.CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const today = new Date().toISOString().slice(0, 10);
  const overdue = issue.due_date && issue.status !== "done" && issue.due_date < today;

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={style}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={() => !isDragging && onOpen(issue.id)}
      className={cn(
        "cursor-grab select-none rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:border-foreground/25 active:cursor-grabbing",
        isDragging && !overlay && "opacity-40",
        overlay && "w-64 rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{issue.key}</span>
        <PriorityIndicator priority={issue.priority} />
      </div>
      <div className="mt-1 text-sm leading-snug">{issue.title}</div>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={issue.status} className="!text-[10px]" />
        {issue.subtask_count > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {issue.subtask_count} sub
          </span>
        )}
        {issue.due_date && (
          <span
            className={cn(
              "ml-auto text-[10px] tabular-nums",
              overdue ? "font-medium text-destructive" : "text-muted-foreground"
            )}
          >
            {format(new Date(issue.due_date + "T00:00:00"), "MMM d")}
          </span>
        )}
        {issue.assignee && (
          <Avatar name={issue.assignee.name} color={issue.assignee.avatar_color} size="sm" className="!h-5 !w-5 !text-[9px]" />
        )}
      </div>
    </div>
  );
}

function Column({
  status,
  issues,
  onOpen,
  onQuickAdd,
}: {
  status: IssueStatus;
  issues: BoardIssue[];
  onOpen: (id: string) => void;
  onQuickAdd: (status: IssueStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
        <span className="text-sm font-medium">{STATUS_LABEL[status]}</span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
        <button
          onClick={() => onQuickAdd(status)}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`New issue in ${STATUS_LABEL[status]}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 rounded-lg border border-dashed p-2 transition-colors min-h-[calc(100vh-13rem)]",
          isOver ? "border-primary bg-primary/5" : "bg-muted/30"
        )}
      >
        {issues.map((i) => (
          <Card key={i.id} issue={i} onOpen={onOpen} />
        ))}
        {issues.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">Drop issues here</div>
        )}
      </div>
    </div>
  );
}

function KanbanInner() {
  const { workspace, loading: wsLoading } = useWorkspace();
  const search = useSearchParams();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [issues, setIssues] = useState<BoardIssue[]>([]);
  const [projectFilter, setProjectFilter] = useState(search.get("project") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<IssueStatus | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    if (!workspace) return;
    const params = new URLSearchParams({ workspace: workspace.id });
    if (projectFilter) params.set("project", projectFilter);
    Promise.all([
      api<BoardIssue[]>(`/api/issues?${params.toString()}`),
      api<{ projects: ProjectOption[] }>(`/api/projects?workspace=${workspace.id}`),
    ])
      .then(([issueData, projectData]) => {
        setIssues(issueData);
        setProjects(projectData.projects);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load board"))
      .finally(() => setLoading(false));
  }, [workspace, projectFilter]);

  useEffect(() => {
    if (!wsLoading) load();
  }, [wsLoading, load]);

  const byStatus = useMemo(() => {
    const map = {} as Record<IssueStatus, BoardIssue[]>;
    for (const s of ISSUE_STATUSES) map[s] = [];
    for (const i of issues) map[i.status]?.push(i);
    for (const s of ISSUE_STATUSES) map[s].sort((a, b) => a.order - b.order);
    return map;
  }, [issues]);

  const activeIssue = activeId ? issues.find((i) => i.id === activeId) ?? null : null;

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id).replace(/^card:/, "");
    setActiveId(id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("col:")) return;
    const targetStatus = overId.slice(4) as IssueStatus;
    const issueId = String(active.id).replace(/^card:/, "");
    const issue = issues.find((i) => i.id === issueId);
    if (!issue || issue.status === targetStatus) return;

    const previous = issues;
    const targetItems = issues.filter((i) => i.status === targetStatus && i.id !== issueId);
    const nextOrder = targetItems.reduce((max, i) => Math.max(max, i.order), 0) + 1;
    setIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, status: targetStatus, order: nextOrder } : i))
    );
    try {
      await api(`/api/issues/${issueId}`, {
        method: "PATCH",
        body: { status: targetStatus, order: nextOrder },
      });
    } catch (err) {
      setIssues(previous);
      toast.error(err instanceof Error ? err.message : "Could not move issue");
    }
  };

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState title="No workspace selected" description="Select or create a workspace to see the board." action={null} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
          <p className="text-sm text-muted-foreground">Drag cards between columns to change status</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setNewStatus("backlog")} disabled={projects.length === 0}>
            <Plus className="h-4 w-4" /> New issue
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-4 grid flex-1 grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="mt-4 grid min-h-0 flex-1 grid-cols-5 gap-3 overflow-x-auto">
            {ISSUE_STATUSES.map((s) => (
              <Column
                key={s}
                status={s}
                issues={byStatus[s]}
                onOpen={setDetailId}
                onQuickAdd={(status) => setNewStatus(status)}
              />
            ))}
          </div>
          <DragOverlay>{activeIssue ? <Card issue={activeIssue} onOpen={() => {}} draggable={false} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {newStatus !== null && (
        <NewIssueDialog
          open
          onOpenChange={(o) => !o && setNewStatus(null)}
          projects={projects}
          workspaceId={workspace?.id ?? ""}
          defaultProjectId={projectFilter || null}
          defaultStatus={newStatus}
          onCreated={load}
        />
      )}
      <IssueDialog issueId={detailId} open={Boolean(detailId)} onOpenChange={(o) => !o && setDetailId(null)} onChanged={load} />
    </div>
  );
}

export default function KanbanPage() {
  return (
    <Suspense>
      <KanbanInner />
    </Suspense>
  );
}
