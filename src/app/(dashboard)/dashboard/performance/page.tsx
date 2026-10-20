"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { Avatar, EmptyState } from "@/components/shared/meta";
import { useWorkspace } from "@/components/providers/workspace-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Role = "owner" | "admin" | "lead" | "employee";

interface RaisedIssue {
  id: string;
  key: string;
  title: string;
  status: string;
  created_at: string;
}

interface WorkItem {
  id: string;
  issue_id: string;
  issue_key: string;
  issue_title: string;
  status: string;
  submit_count: number;
  resubmit_count: number;
  assigned_at: string;
  submitted_at: string | null;
  rejection_reason: string | null;
}

interface MetricsRow {
  user: { id: string; name: string; email: string; avatar_color: string };
  role: Role;
  assigned: number;
  pending: number;
  submitted: number;
  approved: number;
  rejected: number;
  in_review: number;
  completion_rate: number;
  avg_approval_hours: number | null;
  assigned_work: number;
  created_issues: number;
  submit_count: number;
  resubmit_count: number;
  raised: RaisedIssue[];
  works: WorkItem[];
}

interface MetricsData {
  scope: "all" | "employees" | "self";
  viewer_role: Role;
  rows: MetricsRow[];
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  lead: "Lead",
  employee: "Employee",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function PerformancePage() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MetricsRow | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const wsId = workspace.id;
    fetch(`/api/performance?workspace=${encodeURIComponent(wsId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load metrics");
        return res.json();
      })
      .then((d: MetricsData) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"))
      .finally(() => setLoading(false));
  }, [workspace]);

  if (loading && workspace) {
    return (
      <div className="p-6">
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="p-8">
        <EmptyState title="No workspace selected" description="Select a workspace to see performance metrics." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <EmptyState title="Could not load performance" description={error ?? "Unknown error"} />
      </div>
    );
  }

  const scopeText =
    data.scope === "all"
      ? "Everyone in the workspace, including leads."
      : data.scope === "employees"
        ? "Your employees' performance."
        : "Your performance.";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Gauge className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="text-sm text-muted-foreground">{scopeText}</p>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="No data yet" description="Assign and review work to see performance metrics here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-3 py-2.5 font-medium">Raised</th>
                <th className="px-3 py-2.5 font-medium">Assigned</th>
                <th className="px-3 py-2.5 font-medium">Pending</th>
                <th className="px-3 py-2.5 font-medium">In review</th>
                <th className="px-3 py-2.5 font-medium">Approved</th>
                <th className="px-3 py-2.5 font-medium">Rejected</th>
                <th className="px-3 py-2.5 font-medium">Submits</th>
                <th className="px-3 py-2.5 font-medium">Resubmits</th>
                <th className="px-3 py-2.5 font-medium">Completion</th>
                <th className="px-3 py-2.5 font-medium">Avg approval</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.user.id}
                  onClick={() => setDetail(r)}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                  title="View full activity"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.user.name} color={r.user.avatar_color} size="md" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.user.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{ROLE_LABEL[r.role]}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{r.created_issues}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.assigned}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.pending}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.in_review}</td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-600 dark:text-emerald-400">{r.approved}</td>
                  <td className="px-3 py-2.5 tabular-nums text-red-600 dark:text-red-400">{r.rejected}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.submit_count}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.resubmit_count}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            r.completion_rate >= 70
                              ? "bg-emerald-500"
                              : r.completion_rate >= 40
                                ? "bg-amber-500"
                                : "bg-red-500"
                          )}
                          style={{ width: `${r.completion_rate}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-xs text-muted-foreground">{r.completion_rate}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-xs text-muted-foreground">
                    {r.avg_approval_hours === null ? "—" : `${r.avg_approval_hours}h`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b px-5 py-3.5">
              <DialogTitle className="flex items-center gap-2.5">
                <Avatar name={detail.user.name} color={detail.user.avatar_color} size="md" />
                {detail.user.name}
              </DialogTitle>
              <DialogDescription>
                {ROLE_LABEL[detail.role]} · {detail.created_issues} issue{detail.created_issues === 1 ? "" : "s"} raised ·{" "}
                {detail.submit_count} submission{detail.submit_count === 1 ? "" : "s"} ({detail.resubmit_count} resubmitted)
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Issues raised ({detail.raised.length})
                </div>
                {detail.raised.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No issues raised yet.</div>
                ) : (
                  <div className="space-y-1">
                    {detail.raised.map((i) => (
                      <div key={i.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{i.key}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{i.status.replace("_", " ")}</span>
                        <span className="text-[10px] text-muted-foreground">{fmtDate(i.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Work assigned ({detail.works.length})
                </div>
                {detail.works.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No work assigned yet.</div>
                ) : (
                  <div className="space-y-1">
                    {detail.works.map((w) => (
                      <div key={w.id} className="rounded-md border px-2.5 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{w.issue_key}</span>
                          <span className="min-w-0 flex-1 truncate">{w.issue_title}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              w.status === "approved"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : w.status === "rejected"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                  : w.status === "submitted"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            )}
                          >
                            {STATUS_LABEL[w.status] ?? w.status}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span>Assigned {fmtDate(w.assigned_at)}</span>
                          {w.submitted_at && <span>Last submitted {fmtDate(w.submitted_at)}</span>}
                          <span>Submits {w.submit_count}</span>
                          {w.resubmit_count > 0 && <span>Resubmits {w.resubmit_count}</span>}
                        </div>
                        {w.rejection_reason && (
                          <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300">
                            Rejected: {w.rejection_reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
