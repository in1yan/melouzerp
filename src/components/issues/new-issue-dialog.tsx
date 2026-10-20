"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";
import { ISSUE_STATUSES, PRIORITIES } from "@/lib/types";
import type { IssueStatus, Priority } from "@/lib/types";

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

interface MemberOption {
  id: string;
  name: string;
}

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function NewIssueDialog({
  open,
  onOpenChange,
  projects,
  workspaceId,
  defaultProjectId,
  defaultStatus,
  defaultDueDate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectOption[];
  workspaceId: string;
  defaultProjectId?: string | null;
  defaultStatus?: IssueStatus;
  defaultDueDate?: string | null;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [status, setStatus] = useState<IssueStatus>(defaultStatus ?? "backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate ?? "");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && workspaceId) {
      api<{ user: MemberOption }[]>(`/api/workspaces/${workspaceId}/members`)
        .then((list) => setMembers(list.map((m) => m.user)))
        .catch(() => setMembers([]));
    }
  }, [open, workspaceId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setSaving(true);
    try {
      await api("/api/issues", {
        method: "POST",
        body: {
          project_id: projectId,
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
          assignee_id: assigneeId || null,
          due_date: dueDate || null,
        },
      });
      toast.success("Issue created");
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create issue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>Add a task to a project in this workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            placeholder="Issue title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className={selectCls}>
                {projects.length === 0 && <option value="">No projects</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)} className={selectCls}>
                {ISSUE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={selectCls}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Assignee
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectCls}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 space-y-1 text-xs font-medium text-muted-foreground">
              Due date
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={selectCls} />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim() || !projectId}>
              {saving ? "Creating…" : "Create issue"}
            </Button>
          </div>
          {projects.length === 0 && (
            <p className="text-xs text-muted-foreground">Create a project first — issues always live in a project.</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
