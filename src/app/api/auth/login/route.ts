import { NextResponse } from "next/server";
import { z } from "zod";
import { readDB } from "@/lib/store";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { ApiError, handleApiError, parseBody } from "@/lib/api";
import { ensureBootstrap } from "@/lib/bootstrap";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: Request) {
  try {
    ensureBootstrap();
    const body = await parseBody(req, schema);
    const db = readDB();
    const user = db.users.find((u) => u.email === body.email);
    const credential = user && db.password_credentials.find((c) => c.user_id === user.id);
    if (!user || !credential || !verifyPassword(body.password, credential.password_hash)) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (user.approval_status === "rejected") {
      throw new ApiError(403, "Your access request was declined. Contact an administrator.");
    }
    const token = createSession(user.id);
    await setSessionCookie(token);
    return NextResponse.json({
      ok: true,
      user,
      approval_status: user.approval_status,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
