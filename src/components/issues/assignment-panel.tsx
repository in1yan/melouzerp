"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Check, Download, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface SubmissionAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  data_url: string;
}

export interface AssignmentItem {
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

const STATUS_STYLE: Record<AssignmentItem["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  submitted: { label: "Submitted", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};

function ReadFileInput({
  accept,
  multiple,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: { filename: string; content_type: string; data_url: string }[]) => void;
}) {
  const [reading, setReading] = useState(false);

  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setReading(true);
    const out: { filename: string; content_type: string; data_url: string }[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      out.push({ filename: file.name, content_type: file.type || "application/octet-stream", data_url: dataUrl });
    }
    setReading(false);
    if (out.length) onFiles(out);
    e.target.value = "";
  };

  return (
    <label className="inline-flex cursor-pointer items-center rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-accent">
      {reading ? "Reading…" : "Attach files"}
      <input type="file" className="hidden" accept={accept} multiple={multiple} onChange={handle} />
    </label>
  );
}

export function AssignmentPanel({
  assignments,
  currentUserId,
  canReview,
  canDelete,
  onChanged,
}: {
  assignments: AssignmentItem[];
  currentUserId: string;
  canReview: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ filename: string; content_type: string; data_url: string }[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const removeAssignment = async (id: string) => {
    if (!window.confirm("Remove this assigned work item? This cannot be undone.")) return;
    try {
      await api(`/api/assignments/${id}`, { method: "DELETE" });
      toast.success("Assignment removed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not remove assignment");
    }
  };

  const submitWork = async (id: string) => {
    try {
      await api(`/api/submissions/${id}`, {
        method: "POST",
        body: { submission_text: text.trim() || undefined, files },
      });
      toast.success("Work submitted");
      setSubmittingId(null);
      setText("");
      setFiles([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not submit work");
    }
  };

  const review = async (id: string, action: "approve" | "reject") => {
    if (action === "reject" && !reason.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    try {
      await api(`/api/submissions/${id}`, {
        method: "PATCH",
        body: { action, rejection_reason: action === "reject" ? reason.trim() : undefined },
      });
      toast.success(action === "approve" ? "Submission approved" : "Submission rejected");
      setRejectingId(null);
      setReason("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not review submission");
    }
  };

  if (assignments.length === 0) {
    return <div className="text-xs text-muted-foreground">No work assigned yet.</div>;
  }

  return (
    <div className="space-y-2">
      {assignments.map((a) => {
        const style = STATUS_STYLE[a.status];
        const isMine = a.user_id === currentUserId;
        return (
          <div key={a.id} className="rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <Avatar name={a.assignee?.name ?? "?"} color={a.assignee?.avatar_color} size="sm" />
              <span className="text-xs font-medium">{a.assignee?.name ?? "Unknown"}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", style.cls)}>{style.label}</span>
              {a.due_date && <span className="text-[10px] text-muted-foreground">due {a.due_date}</span>}
              <span className="ml-auto text-[10px] text-muted-foreground">
                by {a.assigner?.name ?? "Unknown"}
              </span>
              {(canDelete || a.assigned_by === currentUserId) && (
                <button
                  type="button"
                  onClick={() => removeAssignment(a.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Remove assigned work"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}            </div>

            {a.note && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{a.note}</p>}

            {a.submission_text && (
              <div className="mt-2 rounded-md bg-muted/50 p-2">
                <div className="text-[10px] font-medium text-muted-foreground">Submission</div>
                <p className="mt-0.5 whitespace-pre-wrap text-xs">{a.submission_text}</p>
                {a.submitted_at && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Submitted {format(new Date(a.submitted_at), "MMM d, yyyy HH:mm")}
                  </div>
                )}
              </div>
            )}

            {a.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {a.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.data_url}
                    download={att.filename}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent"
                    title={`${att.filename} (${Math.round(att.size / 1024)} KB)`}
                  >
                    <Download className="h-3 w-3" />
                    <span className="max-w-[140px] truncate">{att.filename}</span>
                  </a>
                ))}
              </div>
            )}

            {a.rejection_reason && (
              <div className="mt-1.5 rounded-md bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300">
                Rejected: {a.rejection_reason}
              </div>
            )}

            {isMine && a.status !== "approved" && submittingId !== a.id && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => {
                    setSubmittingId(a.id);
                    setText(a.submission_text);
                    setFiles([]);
                  }}
                >
                  <Send className="h-3 w-3" /> {a.status === "rejected" ? "Resubmit work" : "Submit work"}
                </Button>
              </div>
            )}

            {isMine && submittingId === a.id && (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Describe the work you completed…"
                  rows={3}
                  className="text-sm"
                />
                <div className="flex items-center gap-2">
                  <ReadFileInput
                    accept=".pdf,image/*,.txt,.md,.zip,.doc,.docx"
                    multiple
                    onFiles={(f) => setFiles((prev) => [...prev, ...f])}
                  />
                  {files.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{files.length} file(s) ready</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => submitWork(a.id)}>
                    <Check className="h-3 w-3" /> Submit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSubmittingId(null);
                      setText("");
                      setFiles([]);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {canReview && a.status === "submitted" && rejectingId !== a.id && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  className="h-7 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  onClick={() => review(a.id, "approve")}
                >
                  <Check className="h-3 w-3" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setRejectingId(a.id)}
                >
                  <X className="h-3 w-3" /> Request changes
                </Button>
              </div>
            )}

            {canReview && rejectingId === a.id && (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain what needs to change…"
                  rows={2}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => review(a.id, "reject")}>
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRejectingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {a.status === "approved" && a.approved_at && (
              <div className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                Approved {format(new Date(a.approved_at), "MMM d, yyyy HH:mm")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
