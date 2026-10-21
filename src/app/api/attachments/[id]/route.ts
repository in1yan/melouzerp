import { NextResponse } from "next/server";
import { readDB } from "@/lib/store";
import { requireMember, handleApiError, ApiError } from "@/lib/api";
import { attachmentDisposition, readAttachmentFile } from "@/lib/attachments";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Authenticated attachment download. Access requires membership in the
 * workspace that owns the assignment the file belongs to.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db = await readDB();
    const attachment = db.submission_attachments.find((a) => a.id === id);
    if (!attachment) throw new ApiError(404, "Attachment not found");
    const assignment = db.issue_assignments.find((a) => a.id === attachment.assignment_id);
    if (!assignment) throw new ApiError(404, "Attachment's assignment no longer exists");
    const issue = db.issues.find((i) => i.id === assignment.issue_id);
    if (!issue) throw new ApiError(404, "Attachment's issue no longer exists");
    const project = db.projects.find((p) => p.id === issue.project_id);
    if (!project) throw new ApiError(404, "Attachment's project no longer exists");
    await requireMember(project.workspace_id);

    const disposition = attachmentDisposition(attachment);

    // Files live in MongoDB as BSON binary; `data_url` is the legacy
    // inline format and is only used for rows migrated from the JSON store.
    const stored = await readAttachmentFile(attachment.id);
    if (stored) {
      return new NextResponse(new Uint8Array(stored.buffer), {
        headers: {
          "Content-Type": stored.contentType || attachment.content_type,
          "Content-Length": String(stored.buffer.length),
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=0, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (!attachment.data_url) throw new ApiError(404, "File no longer exists in storage");
    const match = /^data:([^;]+);base64,(.*)$/.exec(attachment.data_url);
    if (!match) throw new ApiError(404, "Stored file is corrupted");
    const buffer = Buffer.from(match[2], "base64");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": match[1] || attachment.content_type,
        "Content-Length": String(buffer.length),
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
