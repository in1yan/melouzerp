import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireUser, requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole, isAdminRole } from "@/lib/auth";
import { logActivity, issueKey } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "text/plain", "text/markdown", "application/zip"];

const fileSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  data_url: z.string().min(10),
});

const submitSchema = z.object({
  submission_text: z.string().max(10000).optional(),
  files: z.array(fileSchema).max(20).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = await parseBody(req, submitSchema);
    const db0 = readDB();
    const asn = db0.issue_assignments.find((a) => a.id === id && a.user_id === user.id);
    if (!asn) throw new ApiError(404, "Assignment not found");
    if (asn.status === "approved") throw new ApiError(400, "This assignment is already approved");

    mutate((db) => {
      const a = db.issue_assignments.find((x) => x.id === id)!;
      a.submission_text = body.submission_text ?? a.submission_text;
      a.status = "submitted";
      a.submitted_at = nowISO();
      a.updated_at = nowISO();
      if (body.files && body.files.length) {
        for (const f of body.files) {
          if (f.data_url.length > MAX_FILE_BYTES * 2) continue;
          const ct = ALLOWED.includes(f.content_type) ? f.content_type : "application/octet-stream";
          db.submission_attachments.push({
            id: newId("att"),
            assignment_id: id,
            filename: f.filename,
            content_type: ct,
            size: Math.floor((f.data_url.length * 3) / 4),
            data_url: f.data_url,
            uploaded_by: user.id,
            uploaded_at: nowISO(),
          });
        }
      }
    });

    return NextResponse.json({ ok: true, submitted_at: nowISO() });
  } catch (err) {
    return handleApiError(err);
  }
}

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejection_reason: z.string().max(1000).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, reviewSchema);
    const db0 = readDB();
    const asn = db0.issue_assignments.find((a) => a.id === id);
    if (!asn) throw new ApiError(404, "Assignment not found");
    const issue = db0.issues.find((i) => i.id === asn.issue_id);
    if (!issue) throw new ApiError(404, "Issue not found");
    const project = db0.projects.find((p) => p.id === issue.project_id);
    if (!project) throw new ApiError(404, "Project not found");
    const { user, role } = await requireMember(project.workspace_id);
    if (!isSuperiorRole(role) && project.lead_id !== user.id) {
      throw new ApiError(403, "Only workspace admins, leads, or the project lead can review submissions");
    }
    if (asn.status !== "submitted") throw new ApiError(400, "Assignment must be submitted before review");

    mutate((db) => {
      const a = db.issue_assignments.find((x) => x.id === id)!;
      if (body.action === "approve") {
        a.status = "approved";
        a.approved_at = nowISO();
        a.approved_by = user.id;
        a.rejection_reason = null;
      } else {
        if (!body.rejection_reason?.trim()) throw new ApiError(400, "Rejection reason is required");
        a.status = "rejected";
        a.rejection_reason = body.rejection_reason.trim();
        a.approved_at = null;
        a.approved_by = null;
      }
      a.updated_at = nowISO();
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = readDB();
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
    mutate((db) => {
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
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
