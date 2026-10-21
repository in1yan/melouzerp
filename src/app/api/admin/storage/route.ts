import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, readDB, isBlobStore } from "@/lib/store";
import { handleApiError, parseBody, ApiError } from "@/lib/api";
import { requireAppAdmin } from "@/lib/admin";
import { deleteAttachmentBlobs } from "@/lib/attachments";
import { pruneAttempts } from "@/lib/rate-limit";
import { list } from "@vercel/blob";
import type { DB } from "@/lib/types";

const ATTACHMENTS_PREFIX = "attachments/";

function approxSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function collectionStats(db: DB) {
  const entries = Object.entries(db as unknown as Record<string, unknown>).map(([key, value]) => ({
    name: key,
    count: Array.isArray(value) ? value.length : 0,
    bytes: approxSize(value),
  }));
  entries.sort((a, b) => b.bytes - a.bytes);
  return entries;
}

export async function GET() {
  try {
    await requireAppAdmin();
    const db = await readDB();

    const assignmentIds = new Set(db.issue_assignments.map((a) => a.id));
    const orphanAttachments = db.submission_attachments.filter(
      (att) => !assignmentIds.has(att.assignment_id)
    );
    const expiredSessions = db.sessions.filter(
      (s) => new Date(s.expires_at).getTime() < Date.now()
    );
    const rejectedUsers = db.users.filter((u) => u.approval_status === "rejected");
    const pendingUsers = db.users.filter((u) => u.approval_status === "pending");

    let blobTotalBytes = 0;
    let blobCount = 0;
    if (isBlobStore()) {
      try {
        const page = await list({ prefix: ATTACHMENTS_PREFIX, limit: 1000 });
        for (const b of page.blobs) {
          blobCount += 1;
          blobTotalBytes += b.size ?? 0;
        }
      } catch {
        // listing is informational only
      }
    }

    const inlineAttachmentBytes = db.submission_attachments.reduce(
      (sum, att) => sum + (att.data_url ? att.data_url.length : 0),
      0
    );

    return NextResponse.json({
      mode: isBlobStore() ? "blob" : "file",
      db_bytes: approxSize(db),
      collections: collectionStats(db),
      attachments: {
        count: db.submission_attachments.length,
        inline_bytes: inlineAttachmentBytes,
        blob_count: blobCount,
        blob_bytes: blobTotalBytes,
        orphan_count: orphanAttachments.length,
        orphans: orphanAttachments.slice(0, 50).map((att) => ({
          id: att.id,
          filename: att.filename,
          size: att.size,
          uploaded_at: att.uploaded_at,
        })),
        recent: [...db.submission_attachments]
          .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
          .slice(0, 50)
          .map((att) => ({
            id: att.id,
            assignment_id: att.assignment_id,
            filename: att.filename,
            size: att.size,
            content_type: att.content_type,
            uploaded_at: att.uploaded_at,
            stored: att.blob_pathname ? "blob" : "inline",
          })),
      },
      hygiene: {
        sessions: db.sessions.length,
        expired_sessions: expiredSessions.length,
        login_attempts: db.login_attempts.length,
        rejected_users: rejectedUsers.length,
        pending_users: pendingUsers.length,
        activities: db.activities.length,
        notifications: db.notifications.length,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const actionSchema = z.object({
  action: z.enum([
    "purge_expired_sessions",
    "clear_login_attempts",
    "clear_activities",
    "clear_notifications",
    "purge_rejected_users",
    "purge_pending_users",
    "delete_attachment",
    "purge_orphan_attachments",
    "purge_old_submissions",
  ]),
  attachment_id: z.string().optional(),
  older_than_days: z.number().int().min(0).max(3650).optional(),
});

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAppAdmin();
    const body = await parseBody(req, actionSchema);
    const cutoffDays = body.older_than_days ?? 30;
    const cutoff = Date.now() - cutoffDays * 86400000;

    let removedBlobs: (string | null)[] = [];
    const result = await mutate((db) => {
      switch (body.action) {
        case "purge_expired_sessions": {
          const before = db.sessions.length;
          db.sessions = db.sessions.filter((s) => new Date(s.expires_at).getTime() >= Date.now());
          return { removed: before - db.sessions.length };
        }
        case "clear_login_attempts": {
          const before = db.login_attempts.length;
          db.login_attempts = [];
          pruneAttempts(db);
          return { removed: before };
        }
        case "clear_activities": {
          const before = db.activities.length;
          db.activities = [];
          return { removed: before };
        }
        case "clear_notifications": {
          const before = db.notifications.length;
          db.notifications = [];
          return { removed: before };
        }
        case "purge_rejected_users": {
          const targetIds = db.users
            .filter((u) => u.approval_status === "rejected")
            .map((u) => u.id);
          return purgeUsers(db, targetIds, user.id);
        }
        case "purge_pending_users": {
          const targetIds = db.users
            .filter(
              (u) =>
                u.approval_status === "pending" &&
                new Date(u.created_at).getTime() < cutoff
            )
            .map((u) => u.id);
          return purgeUsers(db, targetIds, user.id);
        }
        case "delete_attachment": {
          if (!body.attachment_id) throw new ApiError(400, "attachment_id is required");
          const att = db.submission_attachments.find((a) => a.id === body.attachment_id);
          if (!att) throw new ApiError(404, "Attachment not found");
          db.submission_attachments = db.submission_attachments.filter(
            (a) => a.id !== body.attachment_id
          );
          removedBlobs = [att.blob_pathname];
          return { removed: 1 };
        }
        case "purge_orphan_attachments": {
          const assignmentIds = new Set(db.issue_assignments.map((a) => a.id));
          const orphans = db.submission_attachments.filter(
            (att) => !assignmentIds.has(att.assignment_id)
          );
          removedBlobs = orphans.map((att) => att.blob_pathname);
          db.submission_attachments = db.submission_attachments.filter((att) =>
            assignmentIds.has(att.assignment_id)
          );
          return { removed: orphans.length };
        }
        case "purge_old_submissions": {
          const oldAssignments = db.issue_assignments.filter(
            (a) =>
              (a.status === "approved" || a.status === "rejected") &&
              new Date(a.updated_at).getTime() < cutoff
          );
          const ids = new Set(oldAssignments.map((a) => a.id));
          const atts = db.submission_attachments.filter((att) => ids.has(att.assignment_id));
          removedBlobs = atts.map((att) => att.blob_pathname);
          db.issue_assignments = db.issue_assignments.filter((a) => !ids.has(a.id));
          db.submission_attachments = db.submission_attachments.filter(
            (att) => !ids.has(att.assignment_id)
          );
          return { removed: oldAssignments.length, attachments_removed: atts.length };
        }
      }
    });

    await deleteAttachmentBlobs(removedBlobs);
    return NextResponse.json({ ok: true, action: body.action, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

function purgeUsers(db: DB, targetIds: string[], actorId: string) {
  const keep = new Set(targetIds.filter((id) => id === actorId));
  const ids = targetIds.filter((id) => !keep.has(id));
  if (!ids.length) return { removed: 0 };
  db.users = db.users.filter((u) => !ids.includes(u.id));
  db.password_credentials = db.password_credentials.filter((c) => !ids.includes(c.user_id));
  db.sessions = db.sessions.filter((s) => !ids.includes(s.user_id));
  db.workspace_members = db.workspace_members.filter((m) => !ids.includes(m.user_id));
  return { removed: ids.length };
}
