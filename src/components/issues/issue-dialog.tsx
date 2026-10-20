"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, Plus, Trash2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, PriorityIndicator, StatusBadge } from "@/components/shared/meta";
import { AssignWorkDialog } from "@/components/issues/assign-work-dialog";
import { AssignmentPanel } from "@/components/issues/assignment-panel";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ISSUE_STATUSES, PRIORITIES } from "@/lib/types";
import type { IssueStatus, Priority } from "@/lib/types";

interface UserLite {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

interface IssueDetail {
  id: string;
  key: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  labels: string[];
  assignee: UserLite | null;
  reporter: UserLite | null;
  parent: { id: string; title: string; key: string } | null;
  created_at: string;
  updated_at: string;
  project: { id: string; name: string; key: string; workspace_id: string };
  children: (IssueDetailLite & { status: IssueStatus })[];
  assignments: IssueAssignment[];
  comments: {
    id: string;
    content: string;
    created_at: string;
    user: UserLite | null;
    user_id: string;
  }[];
}

interface IssueDetailLite {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
}

interface SubmissionAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  data_url: string;
}

interface IssueAssignment {
  id: string;
  issue_id: string;
  user_id: string;
  assigned_by: string;
  note: string;
  due_date: string | null;
  status: "pending" | "submitted" | "approved" | "rejected";
  submission_text: string;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  assignee: { id: string; name: string; avatar_color: string } | null;
  assigner: { id: string; name: string } | null;
  attachments: SubmissionAttachment[];
}

const selectCls =
  "h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function IssueDialog({
  issueId,
  open,
  onOpenChange,
  onChanged,
}: {
  issueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [issueData, setIssue] = useState<IssueDetail | null>(null);
  const issue = issueData && issueId && issueData.id === issueId ? issueData : null;
  const [members, setMembers] = useState<UserLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const { user, workspace } = useWorkspace();

  const load = useCallback(() => {
    if (!issueId) return;
    api<IssueDetail>(`/api/issues/${issueId}`)
      .then((data) => {
        setIssue(data);
        setTitle(data.title);
        setDescription(data.description);
        setError(null);
        if (data.project.workspace_id) {
          api<{ user: UserLite }[]>(`/api/workspaces/${data.project.workspace_id}/members`)
            .then((mem) => setMembers(mem.map((m) => m.user)))
            .catch(() => {});
        }
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Could not load issue"));
  }, [issueId]);

  useEffect(() => {
    if (open && issueId) load();
  }, [open, issueId, load]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setIssue(null);
      setComment("");
      setSubtaskTitle("");
    }
    onOpenChange(next);
  };

  const patch = async (updates: Record<string, unknown>, silent = false) => {
    if (!issueId) return;
    setBusy(true);
    try {
      await api(`/api/issues/${issueId}`, { method: "PATCH", body: updates });
      await load();
      onChanged?.();
      if (!silent) toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteIssue = async () => {
    if (!issueId || !issue) return;
    if (!window.confirm(`Delete ${issue.key} and its subtasks? This cannot be undone.`)) return;
    try {
      await api(`/api/issues/${issueId}`, { method: "DELETE" });
      toast.success(`${issue.key} deleted`);
      onOpenChange(false);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueId || !comment.trim()) return;
    try {
      await api(`/api/issues/${issueId}/comments`, { method: "POST", body: { content: comment.trim() } });
      setComment("");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post comment");
    }
  };

  const addSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issue || !subtaskTitle.trim()) return;
    try {
      await api("/api/issues", {
        method: "POST",
        body: {
          project_id: issue.project.id,
          title: subtaskTitle.trim(),
          parent_id: issue.id,
          status: "todo",
        },
      });
      setSubtaskTitle("");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add subtask");
    }
  };

  const toggleSubtask = async (child: { id: string; status: IssueStatus }) => {
    try {
      await api(`/api/issues/${child.id}`, {
        method: "PATCH",
        body: { status: child.status === "done" ? "todo" : "done" },
      });
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update subtask");
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!issueId) return;
    try {
      await api(`/api/issues/${issueId}/comments?comment_id=${commentId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete comment");
    }
  };

  const isOverdue = issue?.due_date && issue.status !== "done" && issue.due_date < new Date().toISOString().slice(0, 10);

  const canDelete =
    !!issue &&
    (issue.reporter?.id === user.id || workspace?.role === "admin" || workspace?.role === "owner");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {!issue && !error && (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading issue…</div>
        )}
        {error && (
          <div className="p-10 text-center text-sm">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {issue && (
          <>
            <DialogHeader className="shrink-0 border-b px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{issue.key}</span>
                <StatusBadge status={issue.status} />
                <PriorityIndicator priority={issue.priority} withLabel />
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setAssignOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5" /> Assign
                  </Button>
                  {canDelete && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete issue" onClick={deleteIssue}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
              <DialogTitle className="sr-only">{issue.title}</DialogTitle>
              <DialogDescription className="sr-only">
                Issue in project {issue.project.name}
              </DialogDescription>
            </DialogHeader>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto md:grid-cols-[1fr_240px]">
              <div className="space-y-4 border-border p-5 md:border-r">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title !== issue.title && patch({ title: title.trim() })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-auto border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                />

                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Description</div>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => description !== issue.description && patch({ description }, true)}
                    placeholder="Add a description… (Markdown-friendly plain text)"
                    rows={5}
                    className="resize-y text-sm"
                  />
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Subtasks {issue.children.length > 0 && `(${issue.children.filter((c) => c.status === "done").length}/${issue.children.length})`}
                  </div>
                  <form onSubmit={addSubtask} className="mb-2 flex gap-2">
                    <Input
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      placeholder="Add a subtask…"
                      className="h-8 text-sm"
                    />
                    <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0" disabled={!subtaskTitle.trim()}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                  <div className="space-y-1">
                    {issue.children.map((child) => (
                      <div key={child.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                        <button
                          onClick={() => toggleSubtask(child)}
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            child.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40"
                          )}
                          title={child.status === "done" ? "Mark not done" : "Mark done"}
                        >
                          {child.status === "done" && <Check className="h-3 w-3" />}
                        </button>
                        <span className={cn("truncate", child.status === "done" && "text-muted-foreground line-through")}>
                          {child.title}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{child.key}</span>
                      </div>
                    ))}
                    {issue.children.length === 0 && (
                      <div className="text-xs text-muted-foreground">No subtasks yet.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>Assigned work ({issue.assignments.length})</span>
                    <button
                      type="button"
                      onClick={() => setAssignOpen(true)}
                      className="text-primary hover:underline"
                    >
                      + Assign
                    </button>
                  </div>
                  <AssignmentPanel
                    assignments={issue.assignments}
                    currentUserId={user.id}
                    canReview={workspace ? workspace.role === "lead" || workspace.role === "admin" || workspace.role === "owner" : false}
                    canDelete={workspace ? workspace.role === "admin" || workspace.role === "owner" : false}
                    onChanged={load}
                  />
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Comments ({issue.comments.length})
                  </div>
                  <div className="space-y-2">
                    {issue.comments.map((c) => (
                      <div key={c.id} className="rounded-lg bg-muted/60 p-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={c.user?.name ?? "?"} color={c.user?.avatar_color} size="sm" />
                          <span className="text-xs font-medium">{c.user?.name ?? "Unknown"}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(c.created_at), "MMM d, HH:mm")}
                          </span>
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            title="Delete comment"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{c.content}</p>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={addComment} className="mt-2 flex gap-2">
                    <Input
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Write a comment…"
                      className="h-8 text-sm"
                    />
                    <Button type="submit" size="sm" className="h-8 shrink-0" disabled={!comment.trim()}>
                      Send
                    </Button>
                  </form>
                </div>
              </div>

              <div className="space-y-3 bg-muted/20 p-5 text-sm">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Status</div>
                  <select
                    value={issue.status}
                    onChange={(e) => patch({ status: e.target.value })}
                    disabled={busy}
                    className={selectCls}
                  >
                    {ISSUE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Priority</div>
                  <select
                    value={issue.priority}
                    onChange={(e) => patch({ priority: e.target.value })}
                    disabled={busy}
                    className={selectCls}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Assignee</div>
                  <select
                    value={issue.assignee?.id ?? ""}
                    onChange={(e) => patch({ assignee_id: e.target.value || null })}
                    disabled={busy}
                    className={selectCls}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Due date</div>
                  <input
                    type="date"
                    value={issue.due_date ?? ""}
                    onChange={(e) => patch({ due_date: e.target.value || null }, true)}
                    className={cn(selectCls, isOverdue && "border-destructive text-destructive")}
                  />
                  {isOverdue && <div className="mt-1 text-xs text-destructive">Overdue</div>}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Start date</div>
                  <input
                    type="date"
                    value={issue.start_date ?? ""}
                    onChange={(e) => patch({ start_date: e.target.value || null }, true)}
                    className={selectCls}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Labels</div>
                  <Input
                    defaultValue={issue.labels.join(", ")}
                    key={issue.updated_at}
                    placeholder="bug, urgent"
                    className="h-8 text-sm"
                    onBlur={(e) => {
                      const labels = e.target.value
                        .split(",")
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .slice(0, 10);
                      if (labels.join(",") !== issue.labels.join(",")) patch({ labels }, true);
                    }}
                  />
                </div>
                <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  <div>
                    Project: <span className="text-foreground">{issue.project.name}</span>
                  </div>
                  {issue.parent && (
                    <div>
                      Parent: <span className="font-mono">{issue.parent.key}</span> {issue.parent.title}
                    </div>
                  )}
                  <div>
                    Reporter: <span className="text-foreground">{issue.reporter?.name ?? "Unknown"}</span>
                  </div>
                  <div>Created {format(new Date(issue.created_at), "MMM d, yyyy")}</div>
                  <div>Updated {format(new Date(issue.updated_at), "MMM d, HH:mm")}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
      {issue && (
        <AssignWorkDialog
          key={assignOpen ? "assign-open" : "assign-closed"}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          issueId={issue.id}
          issueKey={issue.key}
          members={members}
          onAssigned={load}
        />
      )}
    </Dialog>
  );
}
