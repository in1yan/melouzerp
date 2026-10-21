"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, EmptyState } from "@/components/shared/meta";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PendingUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  requested_role: "lead" | "employee";
  created_at: string;
}

interface RecentUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  requested_role: "lead" | "employee";
  approval_status: "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
}

interface ApprovalsData {
  workspace_id: string;
  workspace_name: string;
  pending: PendingUser[];
  recent: RecentUser[];
}

export default function ApprovalsPage() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ApprovalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, "lead" | "employee">>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const isAdmin = workspace?.role === "admin" || workspace?.role === "owner";

  const load = useCallback(() => {
    api<ApprovalsData>("/api/approvals")
      .then((d) => {
        setData(d);
        setRoles(Object.fromEntries(d.pending.map((u) => [u.id, u.requested_role])));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load requests"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    setBusy(id);
    try {
      await api("/api/approvals", {
        method: "PATCH",
        body: { user_id: id, action: "approve", role: roles[id] },
      });
      toast.success("Access approved");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not approve");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    if (!reason.trim()) {
      toast.error("Please provide a reason");
      return;
    }
    setBusy(id);
    try {
      await api("/api/approvals", {
        method: "PATCH",
        body: { user_id: id, action: "reject", rejection_reason: reason.trim() },
      });
      toast.success("Request declined");
      setRejectingId(null);
      setReason("");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not decline");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <EmptyState
          title="Admins only"
          description="Only workspace admins can review access requests."
          action={null}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Approve or decline people requesting to join {data?.workspace_name ?? "the company workspace"}.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3 font-medium">
          <Clock className="h-4 w-4 text-amber-500" />
          Pending requests
          {data && data.pending.length > 0 && (
            <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
              {data.pending.length}
            </span>
          )}
        </div>
        {!data || data.pending.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No pending requests.</div>
        ) : (
          <div className="divide-y">
            {data.pending.map((u) => (
              <div key={u.id} className="space-y-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} color={u.avatar_color} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    requested {format(new Date(u.created_at), "MMM d, HH:mm")}
                  </span>
                </div>
                {rejectingId === u.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for declining (shown to the applicant)…"
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={busy === u.id} onClick={() => reject(u.id)}>
                        Decline
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRejectingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={roles[u.id] ?? u.requested_role}
                      onChange={(e) => setRoles((prev) => ({ ...prev, [u.id]: e.target.value as "lead" | "employee" }))}
                      className="h-7 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="employee">Employee</option>
                      <option value="lead">Lead</option>
                    </select>
                    <Button size="sm" className="h-7 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={busy === u.id} onClick={() => approve(u.id)}>
                      <Check className="h-3 w-3" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => { setRejectingId(u.id); setReason(""); }}>
                      <X className="h-3 w-3" /> Decline
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {data && data.recent.length > 0 && (
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3 font-medium">Recent decisions</div>
          <div className="divide-y">
            {data.recent.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Avatar name={u.name} color={u.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{u.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    u.approval_status === "approved"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  )}
                >
                  {u.approval_status}
                </span>
                <span className="text-[11px] capitalize text-muted-foreground">{u.requested_role}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
