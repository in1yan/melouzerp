import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO } from "@/lib/store";
import { requireUser, handleApiError, parseBody } from "@/lib/api";
import { getUserWorkspaces } from "@/lib/auth";
import { logActivity, slugify, ensureWorkspaceSlug } from "@/lib/domain";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getUserWorkspaces(user.id));
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Workspace name must be at least 2 characters").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]*$/, "Slug may contain lowercase letters, numbers and dashes")
    .max(60)
    .optional(),
  description: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, createSchema);
    const workspace = await mutate((db) => {
      const wsId = newId("ws");
      const baseSlug = slugify(body.slug || body.name);
      db.workspaces.push({
        id: wsId,
        name: body.name,
        slug: ensureWorkspaceSlug(db, baseSlug),
        description: body.description ?? "",
        created_by: user.id,
        created_at: nowISO(),
        updated_at: nowISO(),
        is_company: false,
      });
      db.workspace_members.push({
        id: newId("mem"),
        workspace_id: wsId,
        user_id: user.id,
        role: "owner",
        created_at: nowISO(),
      });
      logActivity(db, {
        workspace_id: wsId,
        user_id: user.id,
        action: "workspace.created",
        entity_type: "workspace",
        entity_id: wsId,
        summary: `${user.name} created workspace "${body.name}"`,
      });
      return db.workspaces.find((w) => w.id === wsId)!;
    });
    return NextResponse.json(workspace, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
