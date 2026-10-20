"use client";

import { useState } from "react";
import { Check, Video } from "lucide-react";
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
import type { CalendarEvent } from "@/lib/types";

export interface EventMember {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventDialog({
  open,
  onOpenChange,
  workspaceId,
  members,
  currentUserId,
  event,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  members: EventMember[];
  currentUserId: string;
  event?: CalendarEvent | null;
  defaultDate?: string | null;
  onSaved?: () => void;
}) {
  const startDefault = event
    ? toLocalInput(event.start_at)
    : defaultDate
      ? `${defaultDate}T09:00`
      : "";
  const endDefault = event
    ? toLocalInput(event.end_at)
    : defaultDate
      ? `${defaultDate}T10:00`
      : "";

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(startDefault);
  const [endAt, setEndAt] = useState(endDefault);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [meetingLink, setMeetingLink] = useState(event?.meeting_link ?? "");
  const [attendees, setAttendees] = useState<string[]>(event?.attendees ?? []);
  const [visibility, setVisibility] = useState<CalendarEvent["visibility"]>(event?.visibility ?? "team");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [notifyAll, setNotifyAll] = useState(false);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const [notifyQuery, setNotifyQuery] = useState("");

  const toggle = (id: string) =>
    setAttendees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleNotify = (id: string) =>
    setNotifyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.email.toLowerCase().includes(query.toLowerCase())
  );

  const filteredNotify = members.filter(
    (m) =>
      m.id !== currentUserId &&
      (m.name.toLowerCase().includes(notifyQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(notifyQuery.toLowerCase()))
  );

  const notifyCount = notifyAll ? members.filter((m) => m.id !== currentUserId).length : notifyIds.length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startAt || !endAt) return;
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim(),
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        all_day: allDay,
        location: location.trim(),
        meeting_link: meetingLink.trim(),
        attendees,
        visibility,
        notify_all: notifyAll,
        notify_user_ids: notifyAll ? [] : notifyIds,
      };
      if (event) {
        await api(`/api/calendar/${event.id}`, { method: "PATCH", body });
        toast.success("Event updated");
      } else {
        await api(`/api/calendar?workspace=${workspaceId}`, { method: "POST", body });
        toast.success("Event created");
      }
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    if (!window.confirm(`Delete event "${event.title}"?`)) return;
    try {
      await api(`/api/calendar/${event.id}`, { method: "DELETE" });
      toast.success("Event deleted");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not delete event");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            Schedule a meeting with a link, reason, and attendees.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint planning, client call…"
              className="h-8 text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Starts</label>
              <Input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="h-8 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Ends</label>
              <Input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="h-8 text-sm"
                required
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All-day event
          </label>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason / agenda</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this meeting is happening and what will be discussed…"
              rows={3}
              className="text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Meeting link</label>
            <div className="flex items-center gap-2">
              <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Location</label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Room, address…"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as CalendarEvent["visibility"])}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="team">Team</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Attendees ({attendees.length})
            </label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members…"
              className="h-8 text-sm"
            />
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
              {filtered.map((m) => {
                const isSelected = attendees.includes(m.id);
                const isSelf = m.id === currentUserId;
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
                    <span className="min-w-0 flex-1 truncate">
                      {m.name}
                      {isSelf && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">No members found.</div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Notify ({notifyCount})
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={notifyAll}
                  onChange={(e) => {
                    setNotifyAll(e.target.checked);
                    if (e.target.checked) setNotifyIds([]);
                  }}
                />
                All members
              </label>
            </div>
            {notifyAll ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Everyone in the workspace will be notified about this event.
              </div>
            ) : (
              <>
                <Input
                  value={notifyQuery}
                  onChange={(e) => setNotifyQuery(e.target.value)}
                  placeholder="Search members to notify…"
                  className="h-8 text-sm"
                />
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-md border p-1">
                  {filteredNotify.map((m) => {
                    const isSelected = notifyIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleNotify(m.id)}
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
                  {filteredNotify.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">No members found.</div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="justify-between sm:justify-between">
            {event ? (
              <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !title.trim() || !startAt || !endAt}>
                {saving ? "Saving…" : event ? "Save changes" : "Create event"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
