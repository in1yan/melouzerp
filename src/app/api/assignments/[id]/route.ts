import { NextResponse } from "next/server";
import { mutate, readDB } from "@/lib/store";
import { requireMember, handleApiError, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { logActivity, issueKey } from "@/lib/domain";
import { deleteAttachmentBlobs } from "@/lib/attachments";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const asn = db0.issue_assignments.find((a) => a.id === id);
    if (!asn) throw new ApiError(404, "Assignment not found");
    const issue = db0.issues.find((i) => i.id === asn.issue_id);
    if (!issue) throw new ApiError(404, "Issue not found");
    const project = db0.projects.find((p) => p.id === issue.project_id);
    if (!project) throw new ApiError(404, "Project not found");
    const { user, role } = await requireMember(project.workspace_id);
    if (!isAdminRole(role) && user.id !== asn.assigned_by) {
      throw new ApiError(403, "Only the person who assigned this work or an admin can remove it");
    }
    const blobPathnames = await mutate((db) => {
      const removed = db.submission_attachments.filter((att) => att.assignment_id === id);
      db.issue_assignments = db.issue_assignments.filter((a) => a.id !== id);
      db.submission_attachments = db.submission_attachments.filter((att) => att.assignment_id !== id);
      logActivity(db, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: "issue.unassigned",
        entity_type: "issue",
        entity_id: issue.id,
        summary: `${user.name} removed an assigned work item from ${issueKey(db, issue)}`,
      });
      return removed.map((att) => att.blob_pathname);
    });
    await deleteAttachmentBlobs(blobPathnames);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
