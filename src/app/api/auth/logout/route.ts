import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mutate } from "@/lib/store";
import { SESSION_COOKIE, hashSessionToken } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    await mutate((db) => {
      db.sessions = db.sessions.filter((s) => s.token_hash !== tokenHash);
    });
  }
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
