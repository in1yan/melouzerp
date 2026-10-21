import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { logActivity, notify } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  start_at: z.string().min(10).optional(),
  end_at: z.string().min(10).optional(),
  all_day: z.boolean().optional(),
  location: z.string().max(500).optional(),
  meeting_link: z.string().max(500).optional(),
  attendees: z.array(z.string().min(1)).max(50).optional(),
  visibility: z.enum(["public", "private", "team"]).optional(),
  color: z.string().max(30).optional(),
  notify_all: z.boolean().optional(),
  notify_user_ids: z.array(z.string().min(1)).max(50).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const ev = db0.calendar_events.find((e) => e.id === id);
    if (!ev) throw new ApiError(404, "Event not found");
    const { user } = await requireMember(ev.workspace_id);
    if (ev.organizer_id !== user.id) {
      const mem = db0.workspace_members.find((m)=>m.workspace_id===ev.workspace_id && m.user_id===user.id);
      if (!isSuperiorRole(mem?.role)) throw new ApiError(403, "Only organizer, admins or leads can edit this event");
    }
    const body = await parseBody(req, patchSchema);
    if (body.start_at && body.end_at && new Date(body.end_at) < new Date(body.start_at)) throw new ApiError(400, "end_at must be after start_at");
    if (body.attendees && body.attendees.length) {
      for (const aid of body.attendees) {
        if (!db0.workspace_members.some((m)=>m.workspace_id===ev.workspace_id && m.user_id===aid)) throw new ApiError(400, "Some attendees are not workspace members");
      }
    }
    const updated = await mutate((db) => {
      const e = db.calendar_events.find((x)=>x.id===id)!;
      if (body.title !== undefined) e.title = body.title;
      if (body.description !== undefined) e.description = body.description;
      if (body.start_at !== undefined) e.start_at = body.start_at;
      if (body.end_at !== undefined) e.end_at = body.end_at;
      if (body.all_day !== undefined) e.all_day = body.all_day;
      if (body.location !== undefined) e.location = body.location;
      if (body.meeting_link !== undefined) e.meeting_link = body.meeting_link;
      if (body.attendees !== undefined) e.attendees = body.attendees;
      if (body.visibility !== undefined) e.visibility = body.visibility;
      if (body.color !== undefined) e.color = body.color;
      e.updated_at = nowISO();

      const recipients = new Set<string>();
      if (body.notify_all) {
        for (const m of db.workspace_members) {
          if (m.workspace_id === e.workspace_id) recipients.add(m.user_id);
        }
      } else if (body.notify_user_ids && body.notify_user_ids.length) {
        for (const uid of body.notify_user_ids) {
          if (db.workspace_members.some((m) => m.workspace_id === e.workspace_id && m.user_id === uid)) recipients.add(uid);
        }
      }
      recipients.delete(user.id);
      const when = new Date(e.start_at).toLocaleString();
      for (const rid of recipients) {
        notify(db, {
          user_id: rid,
          title: "Event updated",
          message: `${user.name} updated "${e.title}" (now ${when})`.slice(0, 180),
          link: `/dashboard/calendar`,
        });
      }
      if (recipients.size) {
        logActivity(db, {
          workspace_id: e.workspace_id,
          user_id: user.id,
          action: "calendar.updated",
          entity_type: "calendar_event",
          entity_id: id,
          summary: `${user.name} updated "${e.title}" and notified ${recipients.size} member(s)`,
        });
      }
      return e;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const ev = db0.calendar_events.find((e) => e.id === id);
    if (!ev) throw new ApiError(404, "Event not found");
    const { user } = await requireMember(ev.workspace_id);
    if (ev.organizer_id !== user.id) {
      const mem = db0.workspace_members.find((m)=>m.workspace_id===ev.workspace_id && m.user_id===user.id);
      if (!isSuperiorRole(mem?.role)) throw new ApiError(403, "Only organizer, admins or leads can delete this event");
    }
    await mutate((db) => { db.calendar_events = db.calendar_events.filter((e)=>e.id!==id); });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
