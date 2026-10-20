import crypto from "crypto";
import { cookies } from "next/headers";
import { readDB, mutate, nowISO } from "./store";
import type { Role, User, Workspace } from "./types";

export const SESSION_COOKIE = "melouz_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  mutate((db) => {
    const now = Date.now();
    db.sessions = db.sessions.filter((s) => new Date(s.expires_at).getTime() > now);
    db.sessions.push({
      token,
      user_id: userId,
      created_at: nowISO(),
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    });
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = readDB();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  const user = db.users.find((u) => u.id === session.user_id);
  if (!user) return null;
  return user;
}

export function getUserWorkspaces(userId: string) {
  const db = readDB();
  return db.workspace_members
    .filter((m) => m.user_id === userId)
    .map((m) => {
      const ws = db.workspaces.find((w) => w.id === m.workspace_id);
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        description: ws.description,
        role: m.role,
        is_company: ws.is_company,
        project_count: db.projects.filter((p) => p.workspace_id === ws.id).length,
        member_count: db.workspace_members.filter((x) => x.workspace_id === ws.id).length,
        created_at: ws.created_at,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export function getMembership(workspaceId: string, userId: string): { role: Role; workspace: Workspace } | null {
  const db = readDB();
  const member = db.workspace_members.find((m) => m.workspace_id === workspaceId && m.user_id === userId);
  if (!member) return null;
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return null;
  return { role: member.role, workspace: ws };
}

export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "owner";
}

export function isLeadRole(role: Role): boolean {
  return role === "lead" || isAdminRole(role);
}

export function isSuperiorRole(role: Role | undefined | null): boolean {
  return role === "lead" || role === "admin" || role === "owner";
}

export function findCompanyWorkspace() {
  const db = readDB();
  const company = db.workspaces.find((w) => w.is_company) ?? db.workspaces[0];
  return company ?? null;
}
