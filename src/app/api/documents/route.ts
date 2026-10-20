import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { logActivity, userLite } from "@/lib/domain";

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace query parameter is required");
    await requireMember(workspaceId);
    const db = readDB();
    const docs = db.documents
      .filter((d) => d.workspace_id === workspaceId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((d) => ({
        id: d.id,
        title: d.title,
        excerpt: d.content.replace(/[#*`>\[\]()!-]/g, "").slice(0, 100),
        updated_at: d.updated_at,
        updated_by: userLite(db, d.updated_by),
      }));
    return NextResponse.json(docs);
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  content: z.string().max(200000).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, createSchema);
    const { user } = await requireMember(body.workspace_id);
    const doc = mutate((db) => {
      const id = newId("doc");
      const title = body.title?.trim() || "Untitled";
      db.documents.push({
        id,
        workspace_id: body.workspace_id,
        title,
        content: body.content ?? "",
        created_by: user.id,
        updated_by: user.id,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      logActivity(db, {
        workspace_id: body.workspace_id,
        user_id: user.id,
        action: "document.created",
        entity_type: "document",
        entity_id: id,
        summary: `${user.name} created document "${title}"`,
      });
      return db.documents.find((d) => d.id === id)!;
    });
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
