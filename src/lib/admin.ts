import { requireUser, ApiError } from "./api";
import { isAdminRole } from "./auth";
import { ensureBootstrap } from "./bootstrap";
import { readDB } from "./store";
import type { User, Workspace } from "./types";

/**
 * Requires the caller to be an admin/owner of the company workspace.
 * Used by instance-wide admin surfaces (approvals, storage management).
 */
export async function requireAppAdmin(): Promise<{
  user: User;
  company: Workspace;
  role: "admin" | "owner";
}> {
  await ensureBootstrap();
  const user = await requireUser();
  const db = await readDB();
  const adminMemberships = db.workspace_members.filter(
    (m) => m.user_id === user.id && (m.role === "admin" || m.role === "owner")
  );
  if (adminMemberships.length === 0) {
    throw new ApiError(403, "Admin permissions required");
  }
  const company =
    db.workspaces.find((w) => w.is_company) ??
    db.workspaces.find((w) => adminMemberships.some((m) => m.workspace_id === w.id));
  if (!company) throw new ApiError(400, "No workspace available");
  const membership = adminMemberships.find((m) => m.workspace_id === company.id);
  if (!membership || !isAdminRole(membership.role)) {
    throw new ApiError(403, "You must be an admin of the company workspace");
  }
  return { user, company, role: membership.role };
}
