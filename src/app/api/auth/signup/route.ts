import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO } from "@/lib/store";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { ApiError, handleApiError, parseBody } from "@/lib/api";
import { notify } from "@/lib/domain";
import { ensureBootstrap, DEFAULT_ADMIN_EMAIL, COMPANY_WORKSPACE_NAME } from "@/lib/bootstrap";

const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  requested_role: z.enum(["lead", "employee"], {
    message: "Choose whether you are a lead or an employee",
  }),
});

export async function POST(req: Request) {
  try {
    ensureBootstrap();
    const body = await parseBody(req, signupSchema);

    const existing = mutate((db) => {
      if (db.users.some((u) => u.email === body.email)) {
        throw new ApiError(409, "An account with this email already exists");
      }
      const userId = newId("usr");
      const colors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444"];
      db.users.push({
        id: userId,
        email: body.email,
        name: body.name,
        avatar_color: colors[db.users.length % colors.length],
        created_at: nowISO(),
        requested_role: body.requested_role,
        approval_status: "pending",
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
      });
      db.password_credentials.push({ user_id: userId, password_hash: hashPassword(body.password) });

      const admin = db.users.find((u) => u.email === DEFAULT_ADMIN_EMAIL);
      if (admin) {
        notify(db, {
          user_id: admin.id,
          title: "New access request",
          message: `${body.name} (${body.email}) requested to join as a ${body.requested_role} in ${COMPANY_WORKSPACE_NAME}. Approve them in Approvals.`,
          link: "/dashboard/approvals",
        });
      }
      return { userId };
    });

    const token = createSession(existing.userId);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, pending: true }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
