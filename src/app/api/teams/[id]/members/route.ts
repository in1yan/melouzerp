import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleApiError, parseBody, requireMember } from "@/lib/api";
import { notify } from "@/lib/domain";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { isAdminRole } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };
const memberSchema = z.object({ user_id: z.string().min(1) });

async function getTeam(id: string) {
  const db = await readDB();
  const team = db.teams.find((item) => item.id === id);
  if (!team) throw new ApiError(404, "Team not found");
  return { db, team };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { team } = await getTeam(id);
    await requireMember(team.workspace_id);
    const db = await readDB();
    return NextResponse.json(db.team_members.filter((member) => member.team_id === id).map((member) => {
      const user = db.users.find((item) => item.id === member.user_id);
      return user ? { ...member, user: { id: user.id, name: user.name, email: user.email, avatar_color: user.avatar_color } } : null;
    }).filter(Boolean));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { team } = await getTeam(id);
    const { user } = await requireMember(team.workspace_id);
    const body = await parseBody(req, memberSchema);
    const result = await mutate((db) => {
      const actor = db.workspace_members.find((item) => item.workspace_id === team.workspace_id && item.user_id === user.id);
      if (!actor || (!isAdminRole(actor.role) && team.lead_id !== user.id)) throw new ApiError(403, "Only the team lead or a workspace admin can manage members");
      if (!db.workspace_members.some((item) => item.workspace_id === team.workspace_id && item.user_id === body.user_id)) throw new ApiError(400, "Member must belong to the workspace");
      if (db.team_members.some((item) => item.team_id === id && item.user_id === body.user_id)) throw new ApiError(409, "That member is already on this team");
      const added = { id: newId("tm"), team_id: id, user_id: body.user_id, added_by: user.id, created_at: nowISO() };
      db.team_members.push(added);
      notify(db, { user_id: body.user_id, title: `Added to ${team.name}`, message: `${user.name} added you to the ${team.name} team.`, link: "/dashboard/teams" });
      return added;
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const userId = new URL(req.url).searchParams.get("user_id");
    if (!userId) throw new ApiError(400, "user_id is required");
    const { team } = await getTeam(id);
    const { user } = await requireMember(team.workspace_id);
    await mutate((db) => {
      const actor = db.workspace_members.find((item) => item.workspace_id === team.workspace_id && item.user_id === user.id);
      if (!actor || (!isAdminRole(actor.role) && team.lead_id !== user.id)) throw new ApiError(403, "Only the team lead or a workspace admin can manage members");
      const before = db.team_members.length;
      db.team_members = db.team_members.filter((item) => !(item.team_id === id && item.user_id === userId));
      if (db.team_members.length === before) throw new ApiError(404, "Team member not found");
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
