"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Video } from "lucide-react";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Avatar, EmptyState, PriorityIndicator } from "@/components/shared/meta";
import { IssueDialog } from "@/components/issues/issue-dialog";
import { NewIssueDialog } from "@/components/issues/new-issue-dialog";
import { EventDialog, type EventMember } from "@/components/calendar/event-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { CalendarEvent, IssueStatus, Priority } from "@/lib/types";

interface CalendarIssue {
  id: string;
  key: string;
  title: string;
  due_date: string;
  status: IssueStatus;
  priority: Priority;
}

interface ProjectOption {
  id: string;
  name: string;
  key: string;
}

const STATUS_DOT: Record<IssueStatus, string> = {
  backlog: "bg-slate-400",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  review: "bg-violet-500",
  done: "bg-emerald-500",
};

function toLocalDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

function CalendarInner() {
  const { workspace, user, loading: wsLoading } = useWorkspace();
  const search = useSearchParams();
  const [cursor, setCursor] = useState(() => new Date());
  const [issues, setIssues] = useState<CalendarIssue[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<EventMember[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(() => search.get("issue"));
  const [newDate, setNewDate] = useState<string | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [viewEvent, setViewEvent] = useState<CalendarEvent | null>(null);

  const load = useCallback(() => {
    if (!workspace) return;
    Promise.all([
      api<CalendarIssue[]>(`/api/issues?workspace=${workspace.id}`),
      api<{ projects: ProjectOption[] }>(`/api/projects?workspace=${workspace.id}`),
      api<CalendarEvent[]>(`/api/calendar?workspace=${workspace.id}`),
      api<{ user: EventMember }[]>(`/api/workspaces/${workspace.id}/members`),
    ])
      .then(([data, proj, evts, mem]) => {
        setIssues(data.filter((i) => i.due_date));
        setProjects(proj.projects);
        setEvents(evts);
        setMembers(mem.map((m) => m.user));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load calendar"))
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    if (!wsLoading) load();
  }, [wsLoading, load]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const result: Date[] = [];
    let d = start;
    while (d <= end) {
      result.push(d);
      d = addDays(d, 1);
    }
    return result;
  }, [cursor]);

  const today = new Date();
  const issuesFor = (day: Date) => issues.filter((i) => isSameDay(toLocalDate(i.due_date), day));
  const eventsFor = (day: Date) =>
    events.filter((ev) => {
      const start = new Date(ev.start_at);
      const end = new Date(ev.end_at);
      return isSameDay(start, day) || isSameDay(end, day) || (start < day && end > addDays(day, 1));
    });

  const canEditEvent = (ev: CalendarEvent) => ev.organizer_id === user.id || workspace?.role === "lead" || workspace?.role === "admin" || workspace?.role === "owner";
  const fmtEventTime = (ev: CalendarEvent) =>
    ev.all_day ? "All day" : `${format(new Date(ev.start_at), "HH:mm")}`;

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState title="No workspace selected" description="Select a workspace to see its calendar." action={null} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Issues by due date &amp; team schedule · {events.length} event{events.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditingEvent(null);
              setEventDate(format(today, "yyyy-MM-dd"));
              setEventOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New event
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-36 text-center text-sm font-medium">{format(cursor, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <div className="mt-4 grid min-w-[700px] grid-cols-7 border-b pb-1 text-center text-xs font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="mt-2 grid min-w-[700px] flex-1 animate-pulse grid-cols-7 gap-1">
          {[...Array(35)].map((_, i) => (
            <div key={i} className="min-h-24 rounded bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="mt-2 grid min-w-[700px] min-h-0 flex-1 grid-cols-7 gap-1">
          {days.map((day) => {
            const dayIssues = issuesFor(day);
            const dayEvents = eventsFor(day);
            const isToday = isSameDay(day, today);
            const inMonth = isSameMonth(day, cursor);
            const dateStr = format(day, "yyyy-MM-dd");
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "group flex min-h-24 flex-col rounded-md border p-1.5",
                  inMonth ? "bg-card" : "bg-muted/30",
                  isToday && "border-primary ring-1 ring-primary/40"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn("text-xs font-medium", inMonth ? "text-foreground" : "text-muted-foreground")}>
                    {format(day, "d")}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditingEvent(null);
                        setEventDate(dateStr);
                        setEventOpen(true);
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                      title={`New event on ${dateStr}`}
                    >
                      <CalendarDays className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setNewDate(dateStr)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                      title={`New issue due ${dateStr}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1 space-y-1 overflow-y-auto">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => setViewEvent(ev)}
                      className="flex w-full items-center gap-1 rounded bg-violet-500/15 px-1 py-0.5 text-left text-[10px] leading-tight hover:bg-violet-500/25"
                      title={`${ev.title} · ${fmtEventTime(ev)}`}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                      <span className="truncate font-medium">{ev.title}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">{fmtEventTime(ev)}</span>
                    </button>
                  ))}
                  {dayIssues.slice(0, 4).map((i) => (
                    <button
                      key={i.id}
                      onClick={() => setDetailId(i.id)}
                      className="flex w-full items-center gap-1 rounded bg-accent/70 px-1 py-0.5 text-left text-[10px] leading-tight hover:bg-accent"
                      title={`${i.key}: ${i.title}`}
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[i.status])} />
                      <span className="truncate">
                        <span className="font-mono text-muted-foreground">{i.key}</span> {i.title}
                      </span>
                      <span className="ml-auto shrink-0">
                        <PriorityIndicator priority={i.priority} />
                      </span>
                    </button>
                  ))}
                  {dayEvents.length + dayIssues.length > 4 && (
                    <div className="px-1 text-[10px] text-muted-foreground">
                      +{dayEvents.length + dayIssues.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {newDate !== null && (
        <NewIssueDialog
          open
          onOpenChange={(o) => !o && setNewDate(null)}
          projects={projects}
          workspaceId={workspace?.id ?? ""}
          defaultDueDate={newDate}
          defaultStatus="todo"
          onCreated={load}
        />
      )}
      <IssueDialog issueId={detailId} open={Boolean(detailId)} onOpenChange={(o) => !o && setDetailId(null)} onChanged={load} />

      {eventOpen && (
        <EventDialog
          key={editingEvent?.id ?? `new-${eventDate}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEventOpen(false);
              setEditingEvent(null);
            }
          }}
          workspaceId={workspace?.id ?? ""}
          members={members}
          currentUserId={user.id}
          event={editingEvent}
          defaultDate={eventDate}
          onSaved={load}
        />
      )}

      {viewEvent && (
        <Dialog open onOpenChange={(o) => !o && setViewEvent(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{viewEvent.title}</DialogTitle>
              <DialogDescription>
                {format(new Date(viewEvent.start_at), "EEEE, MMM d, yyyy · HH:mm")} –{" "}
                {format(new Date(viewEvent.end_at), "HH:mm")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {viewEvent.description && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Reason / agenda</div>
                  <p className="whitespace-pre-wrap">{viewEvent.description}</p>
                </div>
              )}
              {viewEvent.meeting_link && (
                <a
                  href={viewEvent.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Video className="h-3.5 w-3.5" /> Join meeting
                </a>
              )}
              {viewEvent.location && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Location</div>
                  <div>{viewEvent.location}</div>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Attendees ({viewEvent.attendees.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {viewEvent.attendees.map((id) => {
                    const m = members.find((x) => x.id === id);
                    if (!m) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                      >
                        <Avatar name={m.name} color={m.avatar_color} size="sm" />
                        {m.name}
                      </span>
                    );
                  })}
                  {viewEvent.attendees.length === 0 && (
                    <span className="text-xs text-muted-foreground">No attendees invited.</span>
                  )}
                </div>
              </div>
            </div>
            {canEditEvent(viewEvent) && (
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingEvent(viewEvent);
                    setViewEvent(null);
                    setEventOpen(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarInner />
    </Suspense>
  );
}
