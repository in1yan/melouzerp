import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { logActivity, notify, issueKey, userLite } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

function loadContext(issueId: string) {
  const db = readDB();
  const issue = db.issues.find((i) => i.id === issueId);
  if (!issue) throw new ApiError(404, "Issue not found");
  const project = db.projects.find((p) => p.id === issue.project_id);
  if (!project) throw new ApiError(404, "Issue's project no longer exists");
  return { db, issue, project };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { db, project } = loadContext(id);
    await requireMember(project.workspace_id);
    const comments = db.comments
      .filter((c) => c.issue_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ ...c, user: userLite(db, c.user_id) }));
    return NextResponse.json(comments);
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty").max(5000),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { issue, project } = loadContext(id);
    const { user } = await requireMember(project.workspace_id);
    const body = await parseBody(req, createSchema);

    const comment = mutate((db) => {
      const cid = newId("cmt");
      db.comments.push({
        id: cid,
        issue_id: id,
        user_id: user.id,
        content: body.content,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      logActivity(db, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: "comment.created",
        entity_type: "comment",
        entity_id: cid,
        summary: `${user.name} commented on ${issueKey(db, issue)}`,
      });
      const notifyTargets = new Set<string>();
      if (issue.assignee_id) notifyTargets.add(issue.assignee_id);
      notifyTargets.add(issue.reporter_id);
      notifyTargets.delete(user.id);
      for (const target of notifyTargets) {
        notify(db, {
          user_id: target,
          title: "New comment on " + issueKey(db, issue),
          message: `${user.name} commented: ${body.content.slice(0, 120)}`,
          link: `/dashboard/issues?issue=${id}`,
        });
      }
      return db.comments.find((c) => c.id === cid)!;
    });

    return NextResponse.json({ ...comment, user: userLite(readDB(), comment.user_id) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { project } = loadContext(id);
    const { user, role } = await requireMember(project.workspace_id);
    const commentId = new URL(req.url).searchParams.get("comment_id");
    if (!commentId) throw new ApiError(400, "comment_id is required");
    const db = readDB();
    const comment = db.comments.find((c) => c.id === commentId && c.issue_id === id);
    if (!comment) throw new ApiError(404, "Comment not found");
    if (comment.user_id !== user.id && !isSuperiorRole(role)) {
      throw new ApiError(403, "You can only delete your own comments");
    }
    mutate((db2) => {
      db2.comments = db2.comments.filter((c) => c.id !== commentId);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
