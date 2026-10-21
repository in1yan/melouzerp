import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, readDB } from "@/lib/store";
import { requireUser, handleApiError, parseBody, ApiError } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80).optional(),
  current_password: z.string().max(128).optional(),
  new_password: z.string().min(8, "New password must be at least 8 characters").max(128).optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, schema);
    if (!body.name && !body.new_password) throw new ApiError(400, "Nothing to update");
    let newPasswordHash: string | null = null;
    if (body.new_password) {
      if (!body.current_password) throw new ApiError(400, "Enter your current password to change it");
      const db = await readDB();
      const cred = db.password_credentials.find((c) => c.user_id === user.id);
      if (!cred || !(await verifyPassword(body.current_password, cred.password_hash))) {
        throw new ApiError(403, "Current password is incorrect");
      }
      newPasswordHash = await hashPassword(body.new_password);
    }
    const updated = await mutate((db) => {
      const u = db.users.find((x) => x.id === user.id)!;
      if (body.name) u.name = body.name;
      if (newPasswordHash) {
        const cred = db.password_credentials.find((c) => c.user_id === user.id);
        if (cred) cred.password_hash = newPasswordHash;
        else db.password_credentials.push({ user_id: user.id, password_hash: newPasswordHash });
        // Invalidate every session for this user; the client re-authenticates.
        db.sessions = db.sessions.filter((s) => s.user_id !== user.id);
      }
      return u;
    });
    return NextResponse.json({ user: updated, password_changed: Boolean(body.new_password) });
  } catch (err) {
    return handleApiError(err);
  }
}
