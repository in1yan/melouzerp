import { NextResponse } from "next/server";
import { z } from "zod";
import { readDB, mutate } from "@/lib/store";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { ApiError, handleApiError, parseBody } from "@/lib/api";
import { ensureBootstrap } from "@/lib/bootstrap";
import {
  emailAttemptKey,
  ipAttemptKey,
  lockedForSeconds,
  pruneAttempts,
  recordFailure,
  recordSuccess,
} from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(128),
});

function clientIp(req: Request): string {
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
    const body = await parseBody(req, schema);
    const emailKey = emailAttemptKey(body.email);
    const ipKey = ipAttemptKey(clientIp(req));

    const db0 = await readDB();
    const lockedEmail = lockedForSeconds(db0, emailKey);
    const lockedIp = lockedForSeconds(db0, ipKey);
    const lockedFor = Math.max(lockedEmail, lockedIp);
    if (lockedFor > 0) {
      const minutes = Math.max(1, Math.ceil(lockedFor / 60));
      throw new ApiError(
        429,
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      );
    }

    const user = db0.users.find((u) => u.email === body.email);
    const credential = user && db0.password_credentials.find((c) => c.user_id === user.id);
    const passwordOk =
      Boolean(user) && Boolean(credential) && (await verifyPassword(body.password, credential!.password_hash));

    if (!passwordOk) {
      const lockSeconds = await mutate((db) => {
        recordFailure(db, emailKey);
        recordFailure(db, ipKey);
        return Math.max(lockedForSeconds(db, emailKey), lockedForSeconds(db, ipKey));
      });
      if (lockSeconds > 0) {
        const minutes = Math.max(1, Math.ceil(lockSeconds / 60));
        throw new ApiError(
          429,
          `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
        );
      }
      throw new ApiError(401, "Invalid email or password");
    }

    if (user!.approval_status === "rejected") {
      throw new ApiError(403, "Your access request was declined. Contact an administrator.");
    }

    const token = await createSession(user!.id);
    await mutate((db) => {
      recordSuccess(db, [emailKey, ipKey]);
      pruneAttempts(db);
    });
    await setSessionCookie(token);
    return NextResponse.json({
      ok: true,
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        avatar_color: user!.avatar_color,
        approval_status: user!.approval_status,
      },
      approval_status: user!.approval_status,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
