import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { handleApiError, parseBody, requireUser, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { logActivity, notify } from "@/lib/domain";
import { ensureBootstrap } from "@/lib/bootstrap";

async function requireAppAdmin() {
  ensureBootstrap();
  const user = await requireUser();
  const db = readDB();
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

export async function GET() {
  try {
    const { company } = await requireAppAdmin();
    const db = readDB();
    const pending = db.users
      .filter((u) => u.approval_status === "pending")
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar_color: u.avatar_color,
        requested_role: u.requested_role,
        created_at: u.created_at,
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const recent = db.users
      .filter((u) => u.approval_status !== "pending")
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar_color: u.avatar_color,
        requested_role: u.requested_role,
        approval_status: u.approval_status,
        rejection_reason: u.rejection_reason,
        created_at: u.created_at,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
    return NextResponse.json({ workspace_id: company.id, workspace_name: company.name, pending, recent });
  } catch (err) {
    return handleApiError(err);
  }
}

const actionSchema = z.object({
  user_id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  role: z.enum(["lead", "employee"]).optional(),
  rejection_reason: z.string().trim().max(500).optional(),
});

export async function PATCH(req: Request) {
  try {
    const { user: admin, company } = await requireAppAdmin();
    const body = await parseBody(req, actionSchema);

    const updated = mutate((db) => {
      const target = db.users.find((u) => u.id === body.user_id);
      if (!target) throw new ApiError(404, "User not found");
      if (target.approval_status !== "pending") throw new ApiError(400, "This request was already handled");

      if (body.action === "reject") {
        target.approval_status = "rejected";
        target.approved_at = nowISO();
        target.approved_by = admin.id;
        target.rejection_reason = body.rejection_reason ?? "No reason provided";
        notify(db, {
          user_id: target.id,
          title: "Access request declined",
          message: `Your request to join ${company.name} was declined. ${target.rejection_reason}`,
          link: "/login",
        });
        return { target, role: target.requested_role };
      }

      const role = body.role ?? target.requested_role;
      target.approval_status = "approved";
      target.approved_at = nowISO();
      target.approved_by = admin.id;
      target.rejection_reason = null;

      const alreadyMember = db.workspace_members.some(
        (m) => m.workspace_id === company.id && m.user_id === target.id
      );
      if (!alreadyMember) {
        db.workspace_members.push({
          id: newId("mem"),
          workspace_id: company.id,
          user_id: target.id,
          role,
          created_at: nowISO(),
        });
      }

      logActivity(db, {
        workspace_id: company.id,
        user_id: admin.id,
        action: "member.approved",
        entity_type: "member",
        entity_id: target.id,
        summary: `${admin.name} approved ${target.name} as ${role}`,
      });
      notify(db, {
        user_id: target.id,
        title: "Welcome aboard",
        message: `${admin.name} approved your access to ${company.name} as a ${role}.`,
        link: "/dashboard",
      });
      return { target, role };
    });

    return NextResponse.json({ ok: true, user: updated.target, role: updated.role });
  } catch (err) {
    return handleApiError(err);
  }
}
