import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, readDB } from "@/lib/store";
import { requireUser, handleApiError, parseBody } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const db = readDB();
    const notifications = db.notifications
      .filter((n) => n.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
    return NextResponse.json({
      notifications,
      unread: notifications.filter((n) => !n.read).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, patchSchema);
    if (!body.all && (!body.ids || body.ids.length === 0)) {
      return NextResponse.json({ ok: true });
    }
    mutate((db) => {
      for (const n of db.notifications) {
        if (n.user_id !== user.id) continue;
        if (body.all) n.read = true;
        else if (body.ids && body.ids.includes(n.id)) n.read = true;
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
