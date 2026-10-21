"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
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

interface TeamRow {
  id: string;
  name: string;
  description: string;
  lead: MemberRow["user"] | null;
  members: { id: string; created_at: string; user: MemberRow["user"] }[];
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
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamLead, setTeamLead] = useState("");
  const [teamMemberSelection, setTeamMemberSelection] = useState<Record<string, string>>({});

  const myRole = workspace?.role;
  const isAdmin = myRole === "admin" || myRole === "owner";

  const load = useCallback(() => {
    if (!workspace) return;
    Promise.all([
      api<MemberRow[]>(`/api/workspaces/${workspace.id}/members`),
      api<TeamRow[]>(`/api/teams?workspace=${workspace.id}`),
    ])
      .then(([memberData, teamData]) => {
        setMembers(memberData);
        setTeams(teamData);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
      .finally(() => setLoading(false));
  }, [workspace]);

  const createTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      await api(`/api/teams?workspace=${workspace.id}`, {
        method: "POST",
        body: { name: teamName, description: teamDescription, lead_id: teamLead },
      });
      toast.success("Team created");
      setTeamOpen(false);
      setTeamName("");
      setTeamDescription("");
      setTeamLead("");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create team");
    } finally {
      setSaving(false);
    }
  };

  const addTeamMember = async (team: TeamRow) => {
    const userId = teamMemberSelection[team.id];
    if (!userId) return;
    try {
      await api(`/api/teams/${team.id}/members`, { method: "POST", body: { user_id: userId } });
      toast.success("Member added to team");
      setTeamMemberSelection((current) => ({ ...current, [team.id]: "" }));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add team member");
    }
  };

  const removeTeamMember = async (team: TeamRow, userId: string) => {
    try {
      await api(`/api/teams/${team.id}/members?user_id=${userId}`, { method: "DELETE" });
      toast.success("Member removed from team");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove team member");
    }
  };

  const deleteTeam = async (team: TeamRow) => {
    if (!window.confirm(`Delete the ${team.name} team?`)) return;
    try {
      await api(`/api/teams/${team.id}`, { method: "DELETE" });
      toast.success("Team deleted");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete team");
    }
  };

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
    <div className="space-y-4 p-4 sm:p-6">
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

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Department teams</h2>
            <p className="text-sm text-muted-foreground">Create focused teams and let each lead manage its members.</p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setTeamOpen(true)}>
              <Plus className="h-4 w-4" /> Create team
            </Button>
          )}
        </div>
        {teams.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
            No teams yet. Create one for a department or responsibility, such as Fund Team.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {teams.map((team) => {
              const canManage = isAdmin || team.lead?.id === user.id;
              const available = members.filter((member) => !team.members.some((item) => item.user.id === member.user.id));
              return (
                <div key={team.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{team.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{team.description || "No description"}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Lead: <span className="font-medium text-foreground">{team.lead?.name ?? "Unknown"}</span> · {team.members.length} member{team.members.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteTeam(team)} title="Delete team">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 space-y-2">
                    {team.members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={member.user.name} color={member.user.avatar_color} size="sm" />
                          <span className="truncate">{member.user.name}</span>
                        </span>
                        {canManage && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => removeTeamMember(team, member.user.id)}>
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                    {canManage && available.length > 0 && (
                      <div className="flex gap-2 pt-2">
                        <select
                          value={teamMemberSelection[team.id] ?? ""}
                          onChange={(e) => setTeamMemberSelection((current) => ({ ...current, [team.id]: e.target.value }))}
                          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="">Select workspace member…</option>
                          {available.map((member) => <option key={member.user.id} value={member.user.id}>{member.user.name} · {member.user.email}</option>)}
                        </select>
                        <Button size="sm" className="h-8" disabled={!teamMemberSelection[team.id]} onClick={() => addTeamMember(team)}>
                          <UserPlus className="h-3.5 w-3.5" /> Add
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create team</DialogTitle>
            <DialogDescription>Create a department team and assign a lead who can manage its members.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createTeam} className="space-y-3">
            <Input placeholder="Fund Team" value={teamName} onChange={(e) => setTeamName(e.target.value)} required autoFocus />
            <Input placeholder="Description (optional)" value={teamDescription} onChange={(e) => setTeamDescription(e.target.value)} />
            <label className="block space-y-1 text-xs font-medium text-muted-foreground">
              Team lead
              <select value={teamLead} onChange={(e) => setTeamLead(e.target.value)} required className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground">
                <option value="">Select a lead…</option>
                {members.filter((member) => ["lead", "admin", "owner"].includes(member.role)).map((member) => (
                  <option key={member.user.id} value={member.user.id}>{member.user.name} · {member.role}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setTeamOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={saving || !teamLead}>{saving ? "Creating…" : "Create team"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
