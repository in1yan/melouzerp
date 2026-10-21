import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleApiError, parseBody, requireAdmin, requireMember } from "@/lib/api";
import { logActivity, notify } from "@/lib/domain";
import { mutate, newId, nowISO, readDB } from "@/lib/store";

const teamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  lead_id: z.string().min(1),
});

function teamResponse(db: Awaited<ReturnType<typeof readDB>>, teamId: string) {
  const team = db.teams.find((item) => item.id === teamId);
  if (!team) throw new ApiError(404, "Team not found");
  const lead = db.users.find((user) => user.id === team.lead_id);
  const members = db.team_members
    .filter((member) => member.team_id === team.id)
    .map((member) => {
      const user = db.users.find((item) => item.id === member.user_id);
      return user
        ? { id: member.id, created_at: member.created_at, user: { id: user.id, name: user.name, email: user.email, avatar_color: user.avatar_color } }
        : null;
    })
    .filter((member): member is NonNullable<typeof member> => member !== null);
  return {
    ...team,
    lead: lead ? { id: lead.id, name: lead.name, email: lead.email, avatar_color: lead.avatar_color } : null,
    members,
  };
}

function validateLead(db: Awaited<ReturnType<typeof readDB>>, workspaceId: string, leadId: string) {
  const member = db.workspace_members.find((item) => item.workspace_id === workspaceId && item.user_id === leadId);
  if (!member || !["lead", "admin", "owner"].includes(member.role)) {
    throw new ApiError(400, "Team lead must be a lead or admin in this workspace");
  }
}

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace is required");
    await requireMember(workspaceId);
    const db = await readDB();
    return NextResponse.json(db.teams.filter((team) => team.workspace_id === workspaceId).map((team) => teamResponse(db, team.id)));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace is required");
    const { user: admin } = await requireAdmin(workspaceId);
    const body = await parseBody(req, teamSchema);
    const team = await mutate((db) => {
      validateLead(db, workspaceId, body.lead_id);
      if (db.teams.some((item) => item.workspace_id === workspaceId && item.name.toLowerCase() === body.name.toLowerCase())) {
        throw new ApiError(409, "A team with that name already exists");
      }
      const created = {
        id: newId("team"),
        workspace_id: workspaceId,
        name: body.name,
        description: body.description ?? "",
        lead_id: body.lead_id,
        created_by: admin.id,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
      db.teams.push(created);
      logActivity(db, {
        workspace_id: workspaceId,
        user_id: admin.id,
        action: "team.created",
        entity_type: "team",
        entity_id: created.id,
        summary: `${admin.name} created the ${created.name} team`,
      });
      notify(db, {
        user_id: body.lead_id,
        title: "You lead a new team",
        message: `${admin.name} assigned you as lead of the ${created.name} team.`,
        link: "/dashboard/teams",
      });
      return created;
    });
    const db = await readDB();
    return NextResponse.json(teamResponse(db, team.id), { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
