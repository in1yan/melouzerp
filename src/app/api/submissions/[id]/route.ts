import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO, readDB } from "@/lib/store";
import { requireUser, requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { issueKey, notify, logActivity } from "@/lib/domain";
import {
  MAX_FILES_PER_SUBMISSION,
  prepareAttachment,
  storeAttachment,
  deleteAttachmentFiles,
} from "@/lib/attachments";

type Ctx = { params: Promise<{ id: string }> };

const fileSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  data_url: z.string().min(10).max(16 * 1024 * 1024),
});

const submitSchema = z.object({
  submission_text: z.string().max(10000).optional(),
  files: z.array(fileSchema).max(MAX_FILES_PER_SUBMISSION).optional(),
});
const MAX_SUBMISSION_DATA_URL_BYTES = 14 * 1024 * 1024;

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = await parseBody(req, submitSchema);
    if ((body.files ?? []).reduce((sum, file) => sum + file.data_url.length, 0) > MAX_SUBMISSION_DATA_URL_BYTES) {
      throw new ApiError(400, "Combined attachment size exceeds the 10 MB per-submission limit");
    }
    const db0 = await readDB();
    const asn = db0.issue_assignments.find((a) => a.id === id && a.user_id === user.id);
    if (!asn) throw new ApiError(404, "Assignment not found");
    if (asn.status === "approved") throw new ApiError(400, "This assignment is already approved");

    // Validate and stage uploads before touching the database.
    const prepared = (body.files ?? []).map((f) => prepareAttachment(f, id, user.id));

    await mutate((db) => {
      const a = db.issue_assignments.find((x) => x.id === id)!;
      const isResubmit = a.submit_count > 0 || a.status === "rejected" || a.submitted_at !== null;
      a.submission_text = body.submission_text ?? a.submission_text;
      a.status = "submitted";
      a.submit_count = (a.submit_count ?? 0) + 1;
      if (isResubmit) a.resubmit_count = (a.resubmit_count ?? 0) + 1;
      a.submitted_at = nowISO();
      a.updated_at = nowISO();

      const issue = db.issues.find((i) => i.id === a.issue_id);
      const project = issue ? db.projects.find((p) => p.id === issue.project_id) : undefined;
      const label = issue ? issueKey(db, issue) : "an issue";
      const title = issue?.title ?? "";
      const recipients = new Set<string>();
      recipients.add(a.assigned_by);
      if (project) {
        for (const m of db.workspace_members) {
          if (m.workspace_id !== project.workspace_id) continue;
          if (m.role === "lead" || m.role === "admin" || m.role === "owner") recipients.add(m.user_id);
        }
      }
      recipients.delete(user.id);
      for (const rid of recipients) {
        notify(db, {
          user_id: rid,
          title: `Work submitted by ${user.name}`,
          message: `${user.name} submitted work on ${label}: ${title}`.slice(0, 180),
          link: `/dashboard/issues?issue=${a.issue_id}`,
        });
      }

      if (project) {
        logActivity(db, {
          workspace_id: project.workspace_id,
          user_id: user.id,
          action: "submission.created",
          entity_type: "issue",
          entity_id: a.issue_id,
          summary: `${user.name} submitted work on ${label}`,
        });
      }
    });

    const stored: Awaited<ReturnType<typeof storeAttachment>>[] = [];
    try {
      for (const p of prepared) stored.push(await storeAttachment(p));
      await mutate((db) => {
        db.submission_attachments.push(...stored);
      });
    } catch {
      await deleteAttachmentFiles(stored.map((a) => a.id));
      throw new ApiError(502, "Submission saved, but attachments could not be stored. Please retry.");
    }

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
    const db0 = await readDB();
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

    await mutate((db) => {
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

      const label = issueKey(db, issue);
      notify(db, {
        user_id: a.user_id,
        title: body.action === "approve" ? "Work approved" : "Changes requested",
        message:
          body.action === "approve"
            ? `${user.name} approved your submission on ${label}.`
            : `${user.name} requested changes on ${label}: ${a.rejection_reason}`.slice(0, 180),
        link: `/dashboard/issues?issue=${a.issue_id}`,
      });
      logActivity(db, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: body.action === "approve" ? "submission.approved" : "submission.rejected",
        entity_type: "issue",
        entity_id: a.issue_id,
        summary: `${user.name} ${body.action === "approve" ? "approved" : "requested changes on"} ${label}`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
