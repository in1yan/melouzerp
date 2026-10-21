import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { ApiError, handleApiError, parseBody } from "@/lib/api";
import { notify } from "@/lib/domain";
import { ensureBootstrap, DEFAULT_ADMIN_EMAIL, COMPANY_WORKSPACE_NAME } from "@/lib/bootstrap";
import { lockedForSeconds, recordFailure, recordSuccess, signupAttemptKey } from "@/lib/rate-limit";

const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  requested_role: z.enum(["lead", "employee"], {
    message: "Choose whether you are a lead or an employee",
  }),
});

function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY !== "1") return "unknown";
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return (req.headers.get("x-real-ip") ?? "unknown").slice(0, 64);
}

export async function POST(req: Request) {
  try {
    await ensureBootstrap();
    const body = await parseBody(req, signupSchema);
    const ipKey = signupAttemptKey(clientIp(req));

    const db0 = await readDB();
    const lockedFor = lockedForSeconds(db0, ipKey);
    if (lockedFor > 0) {
      const minutes = Math.max(1, Math.ceil(lockedFor / 60));
      throw new ApiError(
        429,
        `Too many sign-up attempts from this device. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      );
    }

    const duplicate = db0.users.some((u) => u.email === body.email);
    if (duplicate) {
      // Anti-enumeration: respond exactly like a successful signup without
      // revealing whether the email is taken. No session is issued.
      await mutate((db) => {
        recordFailure(db, ipKey);
      });
      return NextResponse.json({ ok: true, pending: true }, { status: 201 });
    }

    // Hash outside the sync mutate callback.
    const passwordHash = await hashPassword(body.password);

    const created = await mutate((db) => {
      if (db.users.some((u) => u.email === body.email)) return null;
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
      db.password_credentials.push({ user_id: userId, password_hash: passwordHash });

      const admin = db.users.find((u) => u.email === DEFAULT_ADMIN_EMAIL);
      if (admin) {
        notify(db, {
          user_id: admin.id,
          title: "New access request",
          message: `${body.name} (${body.email}) requested to join as a ${body.requested_role} in ${COMPANY_WORKSPACE_NAME}. Approve them in Approvals.`,
          link: "/dashboard/approvals",
        });
      }
      recordSuccess(db, [ipKey]);
      return { userId };
    });

    if (!created) {
      return NextResponse.json({ ok: true, pending: true }, { status: 201 });
    }

    const token = await createSession(created.userId);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, pending: true }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
