"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, EmptyState } from "@/components/shared/meta";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface MemberRow {
  id: string;
  role: string;
  created_at: string;
  user: { id: string; name: string; email: string; avatar_color: string };
}

export default function TeamsPage() {
  const { workspace, loading: wsLoading, user } = useWorkspace();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "lead" | "employee">("employee");
  const [saving, setSaving] = useState(false);

  const myRole = workspace?.role;
  const isAdmin = myRole === "admin" || myRole === "owner";

  const load = useCallback(() => {
    if (!workspace) return;
    api<MemberRow[]>(`/api/workspaces/${workspace.id}/members`)
      .then((data) => {
        setMembers(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!wsLoading) load();
  }, [wsLoading, load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      await api(`/api/workspaces/${workspace.id}/members`, {
        method: "POST",
        body: { email: email.trim().toLowerCase(), role },
      });
      toast.success("Member added");
      setInviteOpen(false);
      setEmail("");
      setRole("employee");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not add member");
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (memberId: string, newRole: "admin" | "lead" | "employee") => {
    if (!workspace) return;
    try {
      await api(`/api/workspaces/${workspace.id}/members`, {
        method: "PATCH",
        body: { member_id: memberId, role: newRole },
      });
      toast.success("Role updated");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update role");
    }
  };

  const remove = async (memberId: string, name: string) => {
    if (!workspace) return;
    if (!window.confirm(`Remove ${name} from ${workspace.name}?`)) return;
    try {
      await api(`/api/workspaces/${workspace.id}/members?member_id=${memberId}`, { method: "DELETE" });
      toast.success(`${name} removed`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove member");
    }
  };

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState title="No workspace selected" description="Select a workspace to manage its team." action={null} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"} in {workspace?.name} · you are{" "}
            <span className="font-medium capitalize">{myRole}</span>
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add member
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border bg-card" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="hidden grid-cols-[1fr_1fr_7rem_10rem] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span className="text-right">Actions</span>
          </div>
          {members.map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-1 gap-2 border-b px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_1fr_7rem_10rem] sm:items-center"
            >
              <span className="flex items-center gap-2">
                <Avatar name={m.user.name} color={m.user.avatar_color} size="sm" />
                <span className="truncate font-medium">
                  {m.user.name}
                  {m.user.id === user.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                </span>
              </span>
              <span className="truncate text-muted-foreground">{m.user.email}</span>
              <span>
                {isAdmin && m.role !== "owner" ? (
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m.id, e.target.value as "admin" | "lead" | "employee")}
                    className="h-7 w-28 rounded-md border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="employee">Employee</option>
                    <option value="lead">Lead</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                      m.role === "owner" && "bg-primary/10 text-primary",
                      m.role === "admin" && "bg-violet-500/15 text-violet-600 dark:text-violet-400",
                      m.role === "lead" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
                      m.role === "employee" && "bg-muted text-muted-foreground"
                    )}
                  >
                    {m.role}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-start gap-2 sm:justify-end">
                <span className="text-xs text-muted-foreground">
                  joined {format(new Date(m.created_at), "MMM yyyy")}
                </span>
                {isAdmin && m.role !== "owner" && m.user.id !== user.id && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => remove(m.id, m.user.name)}>
                    Remove
                  </Button>
                )}
                {m.user.id === user.id && m.role !== "owner" && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => remove(m.id, m.user.name)}>
                    Leave
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              The person needs an account first — they can sign up with their email, then you invite them here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-3">
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <label className="block space-y-1 text-xs font-medium text-muted-foreground">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "lead" | "employee")}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="employee">Employee — works on assigned tasks</option>
                <option value="lead">Lead — can approve and manage employees</option>
                <option value="admin">Admin — can manage members and settings</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Adding…" : "Add member"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
