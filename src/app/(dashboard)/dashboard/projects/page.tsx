"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar, EmptyState } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";
import type { ProjectStatus } from "@/lib/types";

interface ProjectRow {
  id: string;
  name: string;
  key: string;
  description: string;
  status: ProjectStatus;
  lead: { id: string; name: string; avatar_color: string } | null;
  issue_count: number;
  done_count: number;
  created_at: string;
}

export default function ProjectsPage() {
  const { workspace, loading: wsLoading } = useWorkspace();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(() => {
    if (!workspace) return;
    api<{ projects: ProjectRow[] }>(`/api/projects?workspace=${workspace.id}`)
      .then((res) => {
        setProjects(res.projects);
      })
      .then(() => setError(null))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!wsLoading) load();
  }, [wsLoading, load]);

  const openCreate = () => {
    setName("");
    setKey("");
    setDescription("");
    setCreateOpen(true);
  };

  const openEdit = (p: ProjectRow) => {
    setName(p.name);
    setKey(p.key);
    setDescription(p.description);
    setEditing(p);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    try {
      await api("/api/projects", {
        method: "POST",
        body: {
          workspace_id: workspace.id,
          name: name.trim(),
          ...(key.trim() ? { key: key.trim() } : {}),
          description: description.trim(),
        },
      });
      toast.success(`Project "${name.trim()}" created`);
      setCreateOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create project");
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/api/projects/${editing.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          key: key.trim().toUpperCase(),
          description,
        },
      });
      toast.success("Project updated");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update project");
    }
  };

  const remove = async (p: ProjectRow) => {
    if (!window.confirm(`Delete project "${p.name}" and all of its issues? This cannot be undone.`)) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      toast.success(`Project "${p.name}" deleted`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete project");
    }
  };

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState
          title="No workspace selected"
          description="Select or create a workspace to manage projects."
          action={
            <Link href="/dashboard/workspaces" className="text-sm underline underline-offset-4">
              Go to workspaces
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} {projects.length === 1 ? "project" : "projects"} in {workspace?.name}
          </p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={!workspace}>
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Projects group issues, boards and documents. Create your first project to start tracking work."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const progress = p.issue_count ? Math.round((p.done_count / p.issue_count) * 100) : 0;
            return (
              <div key={p.id} className="group relative flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-foreground/25">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/dashboard/issues?project=${p.id}`} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                        <FolderKanban className="h-4 w-4" />
                      </span>
                      <span className="truncate font-medium group-hover:underline">{p.name}</span>
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                      title="Project actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => remove(p)} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Link href={`/dashboard/issues?project=${p.id}`} className="mt-2 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                  {p.description || "No description"}
                </Link>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{p.key}</span>
                  <span>
                    {p.done_count}/{p.issue_count} done
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  {p.lead ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Avatar name={p.lead.name} color={p.lead.avatar_color} size="sm" />
                      {p.lead.name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No lead</span>
                  )}
                  <Link href={`/dashboard/kanban?project=${p.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                    Open board →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Projects live inside a workspace and hold issues.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-3">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
            <Input
              placeholder="Key (e.g. PLT) — auto-generated if empty"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              maxLength={10}
            />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={name.trim().length < 2}>
                Create project
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Update name, key and description.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
            <Input placeholder="Key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} required maxLength={10} />
            <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">Save changes</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
