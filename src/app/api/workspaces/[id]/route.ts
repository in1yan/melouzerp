import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO } from "@/lib/store";
import { requireAdmin, requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { logActivity, slugify, ensureWorkspaceSlug } from "@/lib/domain";
import { readDB } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, role, workspace } = await requireMember(id);
    const db = readDB();
    return NextResponse.json({
      ...workspace,
      role,
      project_count: db.projects.filter((p) => p.workspace_id === id).length,
      member_count: db.workspace_members.filter((m) => m.workspace_id === id).length,
      issue_count: db.issues.filter((i) => {
        const p = db.projects.find((x) => x.id === i.project_id);
        return p?.workspace_id === id;
      }).length,
      viewer: { id: user.id },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug may contain lowercase letters, numbers and dashes")
    .max(60)
    .optional(),
  description: z.string().trim().max(500).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, workspace } = await requireAdmin(id);
    const body = await parseBody(req, patchSchema);
    if (body.slug && body.slug !== workspace.slug) {
      const db = readDB();
      if (db.workspaces.some((w) => w.slug === body.slug && w.id !== id)) {
        throw new ApiError(409, "That slug is already taken");
      }
    }
    const updated = mutate((db) => {
      const ws = db.workspaces.find((w) => w.id === id);
      if (!ws) throw new ApiError(404, "Workspace not found");
      if (body.name) ws.name = body.name;
      if (body.slug) ws.slug = ensureWorkspaceSlug(db, slugify(body.slug), id);
      if (body.description !== undefined) ws.description = body.description;
      ws.updated_at = nowISO();
      logActivity(db, {
        workspace_id: id,
        user_id: user.id,
        action: "workspace.updated",
        entity_type: "workspace",
        entity_id: id,
        summary: `${user.name} updated workspace settings`,
      });
      return ws;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, workspace } = await requireAdmin(id);
    mutate((db) => {
      const isOwner = db.workspace_members.some(
        (m) => m.workspace_id === id && m.user_id === user.id && m.role === "owner"
      );
      if (!isOwner) throw new ApiError(403, "Only the workspace owner can delete it");
      const projectIds = db.projects.filter((p) => p.workspace_id === id).map((p) => p.id);
      const issueIds = db.issues.filter((i) => projectIds.includes(i.project_id)).map((i) => i.id);
      db.issues = db.issues.filter((i) => !projectIds.includes(i.project_id));
      db.comments = db.comments.filter((c) => !issueIds.includes(c.issue_id));
      db.projects = db.projects.filter((p) => p.workspace_id !== id);
      db.documents = db.documents.filter((d) => d.workspace_id !== id);
      db.workspace_members = db.workspace_members.filter((m) => m.workspace_id !== id);
      db.activities = db.activities.filter((a) => a.workspace_id !== id);
      db.workspaces = db.workspaces.filter((w) => w.id !== id);
    });
    return NextResponse.json({ ok: true, deleted: workspace.name });
  } catch (err) {
    return handleApiError(err);
  }
}
