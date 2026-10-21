import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { logActivity, userLite } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

async function loadDoc(id: string) {
  const db = await readDB();
  const doc = db.documents.find((d) => d.id === id);
  if (!doc) throw new ApiError(404, "Document not found");
  return { db, doc };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { db, doc } = await loadDoc(id);
    await requireMember(doc.workspace_id);
    return NextResponse.json({
      ...doc,
      created_by_user: userLite(db, doc.created_by),
      updated_by_user: userLite(db, doc.updated_by),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200).optional(),
  content: z.string().max(200000).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { doc } = await loadDoc(id);
    const { user, role } = await requireMember(doc.workspace_id);
    const body = await parseBody(req, patchSchema);
    if (!isSuperiorRole(role) && user.id !== doc.created_by) {
      throw new ApiError(403, "Only the document author, a lead, or an admin can edit it");
    }
    const updated = await mutate((db) => {
      const d = db.documents.find((x) => x.id === id)!;
      if (body.title !== undefined) d.title = body.title;
      if (body.content !== undefined) d.content = body.content;
      d.updated_by = user.id;
      d.updated_at = nowISO();
      return d;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { doc } = await loadDoc(id);
    const { user, role } = await requireMember(doc.workspace_id);
    if (!isSuperiorRole(role) && user.id !== doc.created_by) {
      throw new ApiError(403, "Only the document author, a lead, or an admin can delete it");
    }
    await mutate((db) => {
      db.documents = db.documents.filter((d) => d.id !== id);
      logActivity(db, {
        workspace_id: doc.workspace_id,
        user_id: user.id,
        action: "document.deleted",
        entity_type: "document",
        entity_id: id,
        summary: `${user.name} deleted document "${doc.title}"`,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
