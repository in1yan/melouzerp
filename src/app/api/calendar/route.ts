import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { logActivity, notify } from "@/lib/domain";

const eventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  start_at: z.string().min(10),
  end_at: z.string().min(10),
  all_day: z.boolean().optional(),
  location: z.string().max(500).optional(),
  meeting_link: z.string().max(500).optional(),
  attendees: z.array(z.string().min(1)).max(50).optional(),
  visibility: z.enum(["public", "private", "team"]).optional(),
  color: z.string().max(30).optional(),
  notify_all: z.boolean().optional(),
  notify_user_ids: z.array(z.string().min(1)).max(50).optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspace = url.searchParams.get("workspace");
    if (!workspace) throw new ApiError(400, "workspace is required");
    const { user, role } = await requireMember(workspace);
    const db = await readDB();
    const canSeePrivate = isAdminRole(role);
    const events = db.calendar_events
      .filter((e) => e.workspace_id === workspace)
      .filter((e) => e.visibility !== "private" || e.organizer_id === user.id || canSeePrivate)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
    return NextResponse.json(events);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, eventSchema);
    const url = new URL(req.url);
    const workspace = url.searchParams.get("workspace");
    if (!workspace) throw new ApiError(400, "workspace is required");
    const { user } = await requireMember(workspace);
    if (new Date(body.end_at) < new Date(body.start_at)) throw new ApiError(400, "end_at must be after start_at");
    if (body.attendees && body.attendees.length) {
      const db = await readDB();
      for (const id of body.attendees) {
        if (!db.workspace_members.some((m)=>m.workspace_id===workspace && m.user_id===id)) throw new ApiError(400, "Some attendees are not workspace members");
      }
    }
    const ev = await mutate((db) => {
      const id = newId("ev");
      db.calendar_events.push({
        id,
        workspace_id: workspace,
        title: body.title,
        description: body.description ?? "",
        start_at: body.start_at,
        end_at: body.end_at,
        all_day: body.all_day ?? false,
        location: body.location ?? "",
        meeting_link: body.meeting_link ?? "",
        organizer_id: user.id,
        attendees: body.attendees ?? [],
        visibility: body.visibility ?? "team",
        color: body.color ?? "bg-blue-500",
        created_at: nowISO(),
        updated_at: nowISO(),
      });

      const recipients = new Set<string>();
      if (body.notify_all) {
        for (const m of db.workspace_members) {
          if (m.workspace_id === workspace) recipients.add(m.user_id);
        }
      } else if (body.notify_user_ids && body.notify_user_ids.length) {
        for (const uid of body.notify_user_ids) {
          if (db.workspace_members.some((m) => m.workspace_id === workspace && m.user_id === uid)) recipients.add(uid);
        }
      }
      recipients.delete(user.id);
      const when = new Date(body.start_at).toLocaleString();
      for (const rid of recipients) {
        notify(db, {
          user_id: rid,
          title: "New event scheduled",
          message: `${user.name} scheduled "${body.title}" on ${when}`.slice(0, 180),
          link: `/dashboard/calendar`,
        });
      }

      logActivity(db, {
        workspace_id: workspace,
        user_id: user.id,
        action: "calendar.created",
        entity_type: "calendar_event",
        entity_id: id,
        summary: `${user.name} scheduled "${body.title}"${recipients.size ? ` and notified ${recipients.size} member(s)` : ""}`,
      });

      return db.calendar_events.find((e)=>e.id===id)!;
    });
    return NextResponse.json(ev, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
