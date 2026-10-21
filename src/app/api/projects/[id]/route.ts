import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { logActivity, ensureProjectKey } from "@/lib/domain";
import { deleteAttachmentFiles } from "@/lib/attachments";
import type { DB } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

function findProjectOrFail(db: DB, id: string) {
  const project = db.projects.find((p) => p.id === id);
  if (!project) throw new ApiError(404, "Project not found");
  return project;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db = await readDB();
    const project = findProjectOrFail(db, id);
    await requireMember(project.workspace_id);
    const issues = db.issues.filter((i) => i.project_id === id);
    const members = db.workspace_members
      .filter((m) => m.workspace_id === project.workspace_id)
      .map((m) => db.users.find((u) => u.id === m.user_id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, avatar_color: u.avatar_color }));
    const byStatus: Record<string, number> = {};
    for (const i of issues) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    const lead = db.users.find((u) => u.id === project.lead_id) ?? null;
    return NextResponse.json({
      ...project,
      lead: lead ? { id: lead.id, name: lead.name, avatar_color: lead.avatar_color } : null,
      members,
      issue_count: issues.length,
      done_count: issues.filter((i) => i.status === "done").length,
      by_status: byStatus,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Key must be 2-10 characters: letters and numbers, starting with a letter")
    .optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  lead_id: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db = await readDB();
    const project = findProjectOrFail(db, id);
    const { user } = await requireMember(project.workspace_id);
    const body = await parseBody(req, patchSchema);

    const updated = await mutate((db2) => {
      const p = db2.projects.find((x) => x.id === id)!;
      if (body.key && body.key !== p.key) {
        if (db2.projects.some((x) => x.workspace_id === p.workspace_id && x.key === body.key && x.id !== id)) {
          throw new ApiError(409, `Project key "${body.key}" is already used in this workspace`);
        }
        p.key = ensureProjectKey(db2, p.workspace_id, body.key, id);
      }
      if (body.name) p.name = body.name;
      if (body.description !== undefined) p.description = body.description;
      if (body.status) p.status = body.status;
      if (body.lead_id !== undefined) p.lead_id = body.lead_id;
      p.updated_at = nowISO();
      logActivity(db2, {
        workspace_id: p.workspace_id,
        user_id: user.id,
        action: "project.updated",
        entity_type: "project",
        entity_id: id,
        summary: `${user.name} updated project "${p.name}"`,
      });
      return p;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db = await readDB();
    const project = findProjectOrFail(db, id);
    const { user, role } = await requireMember(project.workspace_id);
    if (!isSuperiorRole(role) && project.lead_id !== user.id) {
      throw new ApiError(403, "Only workspace admins, leads, or the project lead can delete a project");
    }
    const removedFileIds = await mutate((db2) => {
      const issueIds = db2.issues.filter((i) => i.project_id === id).map((i) => i.id);
      const assignmentIds = db2.issue_assignments
        .filter((a) => issueIds.includes(a.issue_id))
        .map((a) => a.id);
      const removed = db2.submission_attachments.filter((att) =>
        assignmentIds.includes(att.assignment_id)
      );
      db2.issues = db2.issues.filter((i) => i.project_id !== id);
      db2.comments = db2.comments.filter((c) => !issueIds.includes(c.issue_id));
      db2.issue_assignments = db2.issue_assignments.filter((a) => !assignmentIds.includes(a.id));
      db2.submission_attachments = db2.submission_attachments.filter(
        (att) => !assignmentIds.includes(att.assignment_id)
      );
      db2.projects = db2.projects.filter((p) => p.id !== id);
      logActivity(db2, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: "project.deleted",
        entity_type: "project",
        entity_id: id,
        summary: `${user.name} deleted project "${project.name}"`,
      });
      return removed.map((att) => att.id);
    });
    await deleteAttachmentFiles(removedFileIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
