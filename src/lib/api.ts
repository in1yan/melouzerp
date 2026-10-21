import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSessionUser, getMembership, isAdminRole } from "./auth";
import type { User } from "./types";
import { StoreConsistencyError } from "./store";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Not authenticated");
  if (user.approval_status !== "approved") throw new ApiError(403, "Account approval is required");
  return user;
}

export async function requireMember(workspaceId: string) {
  const user = await requireUser();
  const membership = await getMembership(workspaceId, user.id);
  if (!membership) throw new ApiError(403, "You are not a member of this workspace");
  return { user, ...membership };
}

export async function requireAdmin(workspaceId: string) {
  const result = await requireMember(workspaceId);
  if (!isAdminRole(result.role)) throw new ApiError(403, "Admin permissions required");
  return result;
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const path = first.path.join(".");
      throw new ApiError(400, first.message + (path ? ` (${path})` : ""));
    }
    throw new ApiError(400, "Invalid request body");
  }
}

export function handleApiError(err: unknown) {
  if (err instanceof ApiError) return jsonError(err.status, err.message);
  if (err instanceof StoreConsistencyError) return jsonError(503, "Database is busy; please retry");
  console.error("[api]", err);
  return jsonError(500, "Internal server error");
}
