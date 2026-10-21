"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { EmptyState } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const roleBadge: Record<string, string> = {
  owner: "bg-primary/10 text-primary",
  admin: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  member: "bg-muted text-muted-foreground",
};

export default function WorkspacesPage() {
  const { workspaces, workspace, selectWorkspace, refresh, loading } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ws = await api<{ id: string; name: string }>("/api/workspaces", {
        method: "POST",
        body: { name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}) },
      });
      await refresh();
      selectWorkspace(ws.id);
      toast.success(`Workspace "${ws.name}" created`);
      setCreateOpen(false);
      setName("");
      setSlug("");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create workspace");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, wsName: string) => {
    if (!window.confirm(`Delete workspace "${wsName}"? ALL projects, issues, documents and members will be permanently removed.`)) return;
    try {
      await api(`/api/workspaces/${id}`, { method: "DELETE" });
      toast.success(`Workspace "${wsName}" deleted`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete workspace");
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-sm text-muted-foreground">Each workspace isolates its own projects, issues and documents.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New workspace
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces"
          description="Create your first workspace to organize projects and teammates."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New workspace
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={cn(
                "flex flex-col rounded-lg border bg-card p-4 transition-colors",
                w.id === workspace?.id && "border-primary ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => selectWorkspace(w.id)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold hover:underline">{w.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", roleBadge[w.role])}>
                      {w.role}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">/{w.slug}</div>
                </button>
                {w.role === "owner" && (
                  <button
                    onClick={() => remove(w.id, w.name)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Delete workspace"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span>{w.project_count} projects</span>
                <span>{w.member_count} members</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                {w.id === workspace?.id ? (
                  <span className="text-xs font-medium text-primary">Currently active</span>
                ) : (
                  <button onClick={() => selectWorkspace(w.id)} className="text-xs text-muted-foreground hover:text-foreground">
                    Switch to this workspace →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>You become the owner and admin of the workspace.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <Input
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
            <Input
              placeholder="Slug (optional, e.g. acme-team)"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving || name.trim().length < 2}>
                {saving ? "Creating…" : "Create workspace"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
