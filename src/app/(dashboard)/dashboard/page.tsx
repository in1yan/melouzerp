"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ListTodo, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar, EmptyState, PriorityIndicator, StatusBadge } from "@/components/shared/meta";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { IssueStatus, Priority } from "@/lib/types";

interface DashboardData {
  stats: {
    total_issues: number;
    completed: number;
    in_progress: number;
    overdue: number;
    due_soon: number;
    projects: number;
    members: number;
    completion_rate: number;
  };
  by_status: Record<IssueStatus, number>;
  recent_issues: {
    id: string;
    key: string;
    title: string;
    status: IssueStatus;
    priority: Priority;
    due_date: string | null;
    project: { id: string; name: string };
    assignee: { id: string; name: string; avatar_color: string } | null;
  }[];
  recent_activity: {
    id: string;
    summary: string;
    created_at: string;
    user: { id: string; name: string; avatar_color: string } | null;
  }[];
  projects: { id: string; name: string; key: string; issue_count: number; done_count: number; progress: number }[];
  workload: { id: string; name: string; avatar_color: string; open_issues: number }[];
}

const STATUS_ORDER: IssueStatus[] = ["backlog", "todo", "in_progress", "review", "done"];
const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "danger" ? "text-destructive" : tone === "success" ? "text-emerald-500" : "text-muted-foreground"
          )}
        />
      </div>
      <div className="mt-2 text-[26px] font-semibold tracking-[-0.04em] tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { workspace, user } = useWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!workspace) return;
    api<DashboardData>(`/api/dashboard?workspace=${workspace.id}`)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  if (!workspace) {
    return (
      <div className="p-8">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace from the sidebar to get started."
          action={
            <Link href="/dashboard/workspaces" className="text-sm underline underline-offset-4">
              Go to workspaces
            </Link>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <EmptyState title="Could not load dashboard" description={error} action={null} />
      </div>
    );
  }

  const s = data?.stats;
  const totalStatus = data ? STATUS_ORDER.reduce((sum, st) => sum + (data.by_status[st] ?? 0), 0) : 0;

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-6 py-8 lg:px-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[40px] font-bold leading-[1.1] tracking-[-0.04em]">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.name} · signed in as {user.name}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/dashboard/issues" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            All issues
          </Link>
          <Link href="/dashboard/kanban" className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
            Board
          </Link>
        </div>
      </div>

      {loading || !s ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={ListTodo} label="Open issues" value={s.total_issues - s.completed} hint={`${s.total_issues} total`} />
            <StatCard icon={Clock} label="In progress" value={s.in_progress} hint={`${s.due_soon} due in 7 days`} />
            <StatCard icon={AlertTriangle} label="Overdue" value={s.overdue} tone={s.overdue ? "danger" : "default"} />
            <StatCard
              icon={CheckCircle2}
              label="Completion"
              value={`${s.completion_rate}%`}
              hint={`${s.completed} done`}
              tone="success"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border/80 bg-card lg:col-span-2">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="font-medium">Status breakdown</div>
                <div className="text-xs text-muted-foreground">{totalStatus} issues</div>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  {STATUS_ORDER.map((st) => {
                    const count = data!.by_status[st] ?? 0;
                    if (!count || !totalStatus) return null;
                    const pct = (count / totalStatus) * 100;
                    const color = {
                      backlog: "bg-slate-400",
                      todo: "bg-blue-500",
                      in_progress: "bg-amber-500",
                      review: "bg-violet-500",
                      done: "bg-emerald-500",
                    }[st];
                    return <div key={st} className={color} style={{ width: `${pct}%` }} title={`${STATUS_LABELS[st]}: ${count}`} />;
                  })}
                </div>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {STATUS_ORDER.map((st) => (
                    <div key={st} className="rounded-md bg-muted/50 p-2">
                      <div className="text-lg font-semibold tabular-nums">{data!.by_status[st] ?? 0}</div>
                      <div className="text-[11px] text-muted-foreground">{STATUS_LABELS[st]}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t px-4 py-3">
                <div className="mb-2 flex items-center justify-between font-medium">
                  Recent issues
                  <Link href="/dashboard/issues" className="text-xs text-muted-foreground hover:text-foreground">
                    View all
                  </Link>
                </div>
                {data!.recent_issues.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No issues yet. Create your first issue from the Issues page.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {data!.recent_issues.map((i) => (
                      <Link
                        key={i.id}
                        href={`/dashboard/issues?issue=${i.id}`}
                        className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <span className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">{i.key}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        <PriorityIndicator priority={i.priority} />
                        <StatusBadge status={i.status} className="hidden sm:inline-flex" />
                        {i.assignee && <Avatar name={i.assignee.name} color={i.assignee.avatar_color} size="sm" />}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-border/80 bg-card">
                <div className="border-b px-4 py-3 font-medium">Projects</div>
                <div className="space-y-3 p-4">
                  {data!.projects.length === 0 && (
                    <div className="text-sm text-muted-foreground">No projects yet.</div>
                  )}
                  {data!.projects.map((p) => (
                    <Link key={p.id} href={`/dashboard/issues?project=${p.id}`} className="block group">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate group-hover:underline">{p.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {p.done_count}/{p.issue_count}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${p.progress}%` }} />
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="grid grid-cols-2 border-t text-center text-sm">
                  <div className="border-r p-3">
                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                      <FolderKanban className="h-3.5 w-3.5" /> Projects
                    </div>
                    <div className="mt-0.5 font-semibold">{s.projects}</div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> Members
                    </div>
                    <div className="mt-0.5 font-semibold">{s.members}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-card">
                <div className="border-b px-4 py-3 font-medium">Activity</div>
                <div className="max-h-64 space-y-3 overflow-y-auto p-4">
                  {data!.recent_activity.length === 0 && (
                    <div className="text-sm text-muted-foreground">No activity yet.</div>
                  )}
                  {data!.recent_activity.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-sm">
                      {a.user && <Avatar name={a.user.name} color={a.user.avatar_color} size="sm" />}
                      <div className="min-w-0">
                        <div className="leading-snug">{a.summary}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {data!.workload.length > 0 && (
                <div className="rounded-lg border bg-card">
                  <div className="border-b px-4 py-3 font-medium">Workload <span className="font-normal text-muted-foreground">(open issues)</span></div>
                  <div className="space-y-2 p-4">
                    {data!.workload.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        <Avatar name={m.name} color={m.avatar_color} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span className="tabular-nums text-muted-foreground">{m.open_issues}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
