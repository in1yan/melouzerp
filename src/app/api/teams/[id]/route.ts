import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleApiError, parseBody, requireAdmin } from "@/lib/api";
import { logActivity, notify } from "@/lib/domain";
import { mutate, nowISO, readDB } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };
const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  lead_id: z.string().min(1).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const team = db0.teams.find((item) => item.id === id);
    if (!team) throw new ApiError(404, "Team not found");
    const { user: admin } = await requireAdmin(team.workspace_id);
    const body = await parseBody(req, patchSchema);
    await mutate((db) => {
      const current = db.teams.find((item) => item.id === id)!;
      if (body.lead_id) {
        const lead = db.workspace_members.find((item) => item.workspace_id === current.workspace_id && item.user_id === body.lead_id);
        if (!lead || !["lead", "admin", "owner"].includes(lead.role)) throw new ApiError(400, "Team lead must be a lead or admin in this workspace");
        current.lead_id = body.lead_id;
        notify(db, { user_id: body.lead_id, title: "You lead a team", message: `${admin.name} assigned you as lead of ${current.name}.`, link: "/dashboard/teams" });
      }
      if (body.name !== undefined) current.name = body.name;
      if (body.description !== undefined) current.description = body.description;
      current.updated_at = nowISO();
      logActivity(db, { workspace_id: current.workspace_id, user_id: admin.id, action: "team.updated", entity_type: "team", entity_id: id, summary: `${admin.name} updated the ${current.name} team` });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const team = db0.teams.find((item) => item.id === id);
    if (!team) throw new ApiError(404, "Team not found");
    const { user } = await requireAdmin(team.workspace_id);
    await mutate((db) => {
      db.teams = db.teams.filter((item) => item.id !== id);
      db.team_members = db.team_members.filter((item) => item.team_id !== id);
      logActivity(db, { workspace_id: team.workspace_id, user_id: user.id, action: "team.deleted", entity_type: "team", entity_id: id, summary: `${user.name} deleted the ${team.name} team` });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
