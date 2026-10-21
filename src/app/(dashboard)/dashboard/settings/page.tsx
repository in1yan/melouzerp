"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";
import type { WorkspaceSummary } from "@/lib/types";

export default function SettingsPage() {
  const { user, workspace, workspaces, refresh, selectWorkspace } = useWorkspace();
  const router = useRouter();

  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api("/api/profile", { method: "PATCH", body: { name: name.trim() } });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      const res = await api<{ password_changed: boolean }>("/api/profile", {
        method: "PATCH",
        body: { current_password: currentPassword, new_password: newPassword },
      });
      toast.success(res.password_changed ? "Password changed. Other sessions were signed out." : "Password updated");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not change password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Profile, security and workspace configuration</p>
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3 font-medium">Your profile</div>
        <form onSubmit={saveProfile} className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={name.trim() || user.name} color={user.avatar_color} size="lg" />
            <div className="text-sm">
              <div className="font-medium">{user.email}</div>
              <div className="text-xs text-muted-foreground">Signed in locally · account created {new Date(user.created_at).toLocaleDateString()}</div>
            </div>
          </div>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Display name
            <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className="text-foreground" />
          </label>
          <Button type="submit" size="sm" disabled={savingProfile || name.trim() === user.name}>
            {savingProfile ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3 font-medium">Change password</div>
        <form onSubmit={savePassword} className="space-y-3 p-4">
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Current password
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            New password (min 8 characters)
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={savingPassword || !currentPassword || newPassword.length < 8}>
            {savingPassword ? "Updating…" : "Change password"}
          </Button>
        </form>
      </section>

      {workspace && (
        <WorkspaceSettings
          key={workspace.id}
          workspace={workspace}
          onSaved={async () => {
            await refresh();
            selectWorkspace(workspace.id);
          }}
          onDeleted={async () => {
            const next = workspaces.find((w) => w.id !== workspace.id);
            await refresh();
            if (next) selectWorkspace(next.id);
          }}
        />
      )}

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3 font-medium">About</div>
        <div className="space-y-1 p-4 text-sm text-muted-foreground">
          <p>Melouz OS runs fully on localhost. Data persists in <code className="rounded bg-muted px-1">~/.melouz-os/data/db.json</code> (outside the app folder, so writes never trigger dev recompiles).</p>
          <p>Global search: <kbd className="rounded border px-1">⌘K</kbd> / <kbd className="rounded border px-1">Ctrl+K</kbd>. Quick-create issue: press <kbd className="rounded border px-1">c</kbd> on the Issues page.</p>
        </div>
      </section>
    </div>
  );
}

function WorkspaceSettings({
  workspace,
  onSaved,
  onDeleted,
}: {
  workspace: WorkspaceSummary;
  onSaved: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [wsName, setWsName] = useState(workspace.name);
  const [wsSlug, setWsSlug] = useState(workspace.slug);
  const [wsDescription, setWsDescription] = useState(workspace.description);
  const [wsSaving, setWsSaving] = useState(false);

  const canEdit = workspace.role === "admin" || workspace.role === "owner";
  const isOwner = workspace.role === "owner";

  const saveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setWsSaving(true);
    try {
      await api(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        body: { name: wsName.trim(), slug: wsSlug.trim(), description: wsDescription },
      });
      toast.success("Workspace updated");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update workspace");
    } finally {
      setWsSaving(false);
    }
  };

  const deleteWorkspace = async () => {
    if (!window.confirm(`Delete "${workspace.name}" and ALL of its data? This cannot be undone.`)) return;
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
      toast.success("Workspace deleted");
      await onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete workspace");
    }
  };

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-medium">Workspace · {workspace.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">{workspace.role}</span>
      </div>
      {canEdit ? (
        <form onSubmit={saveWorkspace} className="space-y-3 p-4">
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Name
            <Input value={wsName} onChange={(e) => setWsName(e.target.value)} required minLength={2} />
          </label>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Slug
            <Input
              value={wsSlug}
              onChange={(e) => setWsSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              required
            />
          </label>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Description
            <Input
              value={wsDescription}
              onChange={(e) => setWsDescription(e.target.value)}
              placeholder="What is this workspace for?"
            />
          </label>
          <Button type="submit" size="sm" disabled={wsSaving}>
            {wsSaving ? "Saving…" : "Save workspace"}
          </Button>
          {isOwner && (
            <div className="mt-4 rounded-md border border-destructive/40 p-3">
              <div className="text-sm font-medium text-destructive">Danger zone</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Deleting the workspace removes every project, issue, document and member permanently.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2 text-destructive" onClick={deleteWorkspace}>
                Delete workspace
              </Button>
            </div>
          )}
        </form>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">
          Only workspace admins can change these settings. Your role: {workspace.role}.
        </div>
      )}
    </section>
  );
}
