import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { logActivity, ensureProjectKey } from "@/lib/domain";

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace query parameter is required");
    const { role } = await requireMember(workspaceId);
    const db = readDB();
    const projects = db.projects
      .filter((p) => p.workspace_id === workspaceId)
      .map((p) => {
        const issues = db.issues.filter((i) => i.project_id === p.id);
        const done = issues.filter((i) => i.status === "done").length;
        const lead = db.users.find((u) => u.id === p.lead_id) ?? null;
        return {
          ...p,
          lead: lead ? { id: lead.id, name: lead.name, avatar_color: lead.avatar_color } : null,
          issue_count: issues.length,
          done_count: done,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ projects, role });
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(2, "Project name must be at least 2 characters").max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Key must be 2-10 characters: letters and numbers, starting with a letter")
    .optional(),
  description: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, createSchema);
    const { user } = await requireMember(body.workspace_id);

    const project = mutate((db) => {
      const derived = body.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "PRJ";
      const key = ensureProjectKey(db, body.workspace_id, body.key ?? derived);
      if (key.length < 2) throw new ApiError(400, "Could not derive a project key; provide one explicitly");
      const id = newId("prj");
      db.projects.push({
        id,
        workspace_id: body.workspace_id,
        name: body.name,
        key,
        description: body.description ?? "",
        status: "active",
        lead_id: user.id,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      logActivity(db, {
        workspace_id: body.workspace_id,
        user_id: user.id,
        action: "project.created",
        entity_type: "project",
        entity_id: id,
        summary: `${user.name} created project "${body.name}" (${key})`,
      });
      return db.projects.find((p) => p.id === id)!;
    });

    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
