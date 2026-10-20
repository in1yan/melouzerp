import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireAdmin, requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { logActivity, notify } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await requireMember(id);
    const db = readDB();
    const members = db.workspace_members
      .filter((m) => m.workspace_id === id)
      .map((m) => {
        const u = db.users.find((x) => x.id === m.user_id);
        return {
          id: m.id,
          role: m.role,
          created_at: m.created_at,
          user: u
            ? { id: u.id, name: u.name, email: u.email, avatar_color: u.avatar_color }
            : { id: m.user_id, name: "Unknown user", email: "", avatar_color: "#94a3b8" },
        };
      });
    return NextResponse.json(members);
  } catch (err) {
    return handleApiError(err);
  }
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["admin", "lead", "employee"]).default("employee"),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user: admin } = await requireAdmin(id);
    const body = await parseBody(req, inviteSchema);

    const result = mutate((db) => {
      const target = db.users.find((u) => u.email === body.email);
      if (!target) {
        throw new ApiError(
          404,
          "No account exists with that email. Ask them to sign up first, then invite them."
        );
      }
      if (db.workspace_members.some((m) => m.workspace_id === id && m.user_id === target.id)) {
        throw new ApiError(409, "That user is already a member of this workspace");
      }
      db.workspace_members.push({
        id: newId("mem"),
        workspace_id: id,
        user_id: target.id,
        role: body.role,
        created_at: nowISO(),
      });
      const ws = db.workspaces.find((w) => w.id === id)!;
      logActivity(db, {
        workspace_id: id,
        user_id: admin.id,
        action: "member.added",
        entity_type: "member",
        entity_id: target.id,
        summary: `${admin.name} added ${target.name} as ${body.role}`,
      });
      notify(db, {
        user_id: target.id,
        title: "Added to workspace",
        message: `${admin.name} added you to "${ws.name}" as ${body.role}.`,
        link: "/dashboard",
      });
      return { target };
    });

    return NextResponse.json(
      { ok: true, user: { id: result.target.id, name: result.target.name, email: result.target.email } },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

const patchSchema = z.object({
  member_id: z.string().min(1),
  role: z.enum(["admin", "lead", "employee"]),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user: admin } = await requireAdmin(id);
    const body = await parseBody(req, patchSchema);

    mutate((db) => {
      const member = db.workspace_members.find((m) => m.id === body.member_id && m.workspace_id === id);
      if (!member) throw new ApiError(404, "Member not found");
      if (member.role === "owner") throw new ApiError(400, "The owner's role cannot be changed");
      const admins = db.workspace_members.filter(
        (m) => m.workspace_id === id && (m.role === "admin" || m.role === "owner")
      );
      if (member.role === "admin" && body.role !== "admin" && admins.length <= 1) {
        throw new ApiError(400, "A workspace must keep at least one admin");
      }
      member.role = body.role;
      const target = db.users.find((u) => u.id === member.user_id);
      logActivity(db, {
        workspace_id: id,
        user_id: admin.id,
        action: "member.role_changed",
        entity_type: "member",
        entity_id: member.user_id,
        summary: `${admin.name} changed ${target?.name ?? "a member"}'s role to ${body.role}`,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, role } = await requireMember(id);
    const member_id = new URL(req.url).searchParams.get("member_id");
    if (!member_id) throw new ApiError(400, "member_id is required");

    mutate((db) => {
      const member = db.workspace_members.find((m) => m.id === member_id && m.workspace_id === id);
      if (!member) throw new ApiError(404, "Member not found");
      const isSelf = member.user_id === user.id;
      const isAdmin = isAdminRole(role);
      if (!isSelf && !isAdmin) throw new ApiError(403, "Only admins can remove other members");
      if (member.role === "owner") throw new ApiError(400, "The owner cannot be removed");
      const admins = db.workspace_members.filter(
        (m) => m.workspace_id === id && (m.role === "admin" || m.role === "owner")
      );
      if (member.role === "admin" && admins.length <= 1) {
        throw new ApiError(400, "A workspace must keep at least one admin");
      }
      const target = db.users.find((u) => u.id === member.user_id);
      db.workspace_members = db.workspace_members.filter((m) => m.id !== member_id);
      logActivity(db, {
        workspace_id: id,
        user_id: user.id,
        action: "member.removed",
        entity_type: "member",
        entity_id: member.user_id,
        summary: `${user.name} removed ${target?.name ?? "a member"} from the workspace`,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
