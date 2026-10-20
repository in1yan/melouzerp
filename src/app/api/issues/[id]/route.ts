import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { logActivity, notify, issueKey, userLite } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

function loadIssue(id: string) {
  const db = readDB();
  const issue = db.issues.find((i) => i.id === id);
  if (!issue) throw new ApiError(404, "Issue not found");
  const project = db.projects.find((p) => p.id === issue.project_id);
  if (!project) throw new ApiError(404, "Issue's project no longer exists");
  return { db, issue, project };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { db, issue, project } = loadIssue(id);
    await requireMember(project.workspace_id);
    const children = db.issues
      .filter((i) => i.parent_id === id)
      .map((i) => ({
        ...i,
        key: issueKey(db, i),
        assignee: userLite(db, i.assignee_id),
        reporter: userLite(db, i.reporter_id),
      }));
    const comments = db.comments
      .filter((c) => c.issue_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ ...c, user: userLite(db, c.user_id) }));
    const parent = issue.parent_id ? db.issues.find((i) => i.id === issue.parent_id) : null;
    const assignments = db.issue_assignments
      .filter((a) => a.issue_id === id)
      .map((a) => {
        const u = db.users.find((x) => x.id === a.user_id);
        const ab = db.users.find((x) => x.id === a.assigned_by);
        return {
          ...a,
          assignee: u ? { id: u.id, name: u.name, avatar_color: u.avatar_color } : null,
          assigner: ab ? { id: ab.id, name: ab.name } : null,
          attachments: db.submission_attachments.filter((att) => att.assignment_id === a.id),
        };
      });
    return NextResponse.json({
      ...issue,
      key: issueKey(db, issue),
      project: { id: project.id, name: project.name, key: project.key, workspace_id: project.workspace_id },
      assignee: userLite(db, issue.assignee_id),
      reporter: userLite(db, issue.reporter_id),
      parent: parent ? { id: parent.id, title: parent.title, key: issueKey(db, parent) } : null,
      children,
      comments,
      assignments,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  assignee_id: z.string().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  order: z.number().finite().optional(),
  parent_id: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { issue, project } = loadIssue(id);
    const { user } = await requireMember(project.workspace_id);
    const body = await parseBody(req, patchSchema);

    if (body.assignee_id) {
      const db = readDB();
      const isMember = db.workspace_members.some(
        (m) => m.workspace_id === project.workspace_id && m.user_id === body.assignee_id
      );
      if (!isMember) throw new ApiError(400, "Assignee is not a member of this workspace");
    }

    const changes: string[] = [];
    const updated = mutate((db) => {
      const i = db.issues.find((x) => x.id === id)!;
      if (body.title !== undefined && body.title !== i.title) { changes.push("title"); i.title = body.title; }
      if (body.description !== undefined && body.description !== i.description) { changes.push("description"); i.description = body.description; }
      if (body.status !== undefined && body.status !== i.status) { changes.push("status"); i.status = body.status; }
      if (body.priority !== undefined && body.priority !== i.priority) { changes.push("priority"); i.priority = body.priority; }
      if (body.assignee_id !== undefined && body.assignee_id !== i.assignee_id) { changes.push("assignee"); i.assignee_id = body.assignee_id; }
      if (body.due_date !== undefined && body.due_date !== i.due_date) { changes.push("due date"); i.due_date = body.due_date; }
      if (body.start_date !== undefined && body.start_date !== i.start_date) { changes.push("start date"); i.start_date = body.start_date; }
      if (body.labels !== undefined) { changes.push("labels"); i.labels = body.labels; }
      if (body.order !== undefined && body.order !== i.order) { i.order = body.order; }
      if (body.parent_id !== undefined && body.parent_id !== i.parent_id) { changes.push("parent"); i.parent_id = body.parent_id; }
      i.updated_at = nowISO();

      if (changes.length) {
        logActivity(db, {
          workspace_id: project.workspace_id,
          user_id: user.id,
          action: "issue.updated",
          entity_type: "issue",
          entity_id: id,
          summary: `${user.name} updated ${issueKey(db, i)} (${changes.join(", ")})`,
        });
      }
      if (body.assignee_id !== undefined && body.assignee_id && body.assignee_id !== issue.assignee_id && body.assignee_id !== user.id) {
        notify(db, {
          user_id: body.assignee_id,
          title: "You were assigned an issue",
          message: `${user.name} assigned you ${issueKey(db, i)}: ${i.title}`,
          link: `/dashboard/issues?issue=${id}`,
        });
      }
      if (body.status === "done" && issue.status !== "done" && i.assignee_id && i.assignee_id !== user.id) {
        notify(db, {
          user_id: i.assignee_id,
          title: "Issue completed",
          message: `${user.name} marked ${issueKey(db, i)} as done`,
          link: `/dashboard/issues?issue=${id}`,
        });
      }
      return i;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { issue, project } = loadIssue(id);
    const { user, role } = await requireMember(project.workspace_id);
    if (!isAdminRole(role) && user.id !== issue.reporter_id) {
      throw new ApiError(403, "Only the person who created this issue or an admin can delete it");
    }
    mutate((db) => {
      const childIds = db.issues.filter((i) => i.parent_id === id).map((i) => i.id);
      const allIds = [id, ...childIds];
      db.issues = db.issues.filter((i) => !allIds.includes(i.id));
      db.comments = db.comments.filter((c) => !allIds.includes(c.issue_id));
      logActivity(db, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: "issue.deleted",
        entity_type: "issue",
        entity_id: id,
        summary: `${user.name} deleted ${issueKey(db, issue)} "${issue.title}"`,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
