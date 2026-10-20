"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface MemberOption {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

export function AssignWorkDialog({
  open,
  onOpenChange,
  issueId,
  issueKey,
  members,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  issueKey: string;
  members: MemberOption[];
  onAssigned?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.email.toLowerCase().includes(query.toLowerCase())
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const res = await api<{ assigned_count: number }>(`/api/issues/${issueId}/assign`, {
        method: "POST",
        body: {
          user_ids: selected,
          note: note.trim() || undefined,
          due_date: dueDate || null,
        },
      });
      toast.success(
        res.assigned_count === 1 ? "Work assigned" : `Work assigned to ${res.assigned_count} people`
      );
      onOpenChange(false);
      onAssigned?.();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not assign work");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign work</DialogTitle>
          <DialogDescription>
            Assign {issueKey} to one or more employees. They will be notified and can submit proof of work.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              className="h-8 text-sm"
            />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
              {filtered.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">No members found.</div>
              )}
              {filtered.map((m) => {
                const isSelected = selected.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      isSelected ? "bg-primary/10" : "hover:bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <Avatar name={m.name} color={m.avatar_color} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{selected.length} selected</div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Instructions / note</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe what needs to be done, deliverables, acceptance criteria…"
              rows={3}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Deadline (optional)</label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 text-sm" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || selected.length === 0}>
              {saving ? "Assigning…" : `Assign to ${selected.length || ""}`.trim()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
