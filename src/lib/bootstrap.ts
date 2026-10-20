import { mutate, newId, nowISO } from "./store";
import { hashPassword } from "./auth";
import type { User } from "./types";

export const COMPANY_WORKSPACE_NAME = process.env.COMPANY_WORKSPACE_NAME || "Melouz Company";
export const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || "admin@melouz.local";
export const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "admin12345";

let bootstrapped = false;

export function ensureBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    mutate((db) => {
      let company = db.workspaces.find((w) => w.is_company);
      if (!company) {
        const existing = db.workspaces[0];
        if (existing) {
          existing.is_company = true;
          company = existing;
        } else {
          const wsId = newId("ws");
          company = {
            id: wsId,
            name: COMPANY_WORKSPACE_NAME,
            slug: "melouz-company",
            description: "The shared company workspace everyone joins.",
            created_by: "system",
            created_at: nowISO(),
            updated_at: nowISO(),
            is_company: true,
          };
          db.workspaces.push(company);
        }
      }

      let admin = db.users.find((u) => u.email === DEFAULT_ADMIN_EMAIL);
      if (!admin) {
        const adminId = newId("usr");
        admin = {
          id: adminId,
          email: DEFAULT_ADMIN_EMAIL,
          name: "Administrator",
          avatar_color: "#6366f1",
          created_at: nowISO(),
          requested_role: "lead",
          approval_status: "approved",
          approved_at: nowISO(),
          approved_by: null,
          rejection_reason: null,
        } satisfies User;
        db.users.push(admin);
        db.password_credentials.push({
          user_id: adminId,
          password_hash: hashPassword(DEFAULT_ADMIN_PASSWORD),
        });
      }

      const isMember = db.workspace_members.some(
        (m) => m.workspace_id === company.id && m.user_id === admin.id
      );
      if (!isMember) {
        db.workspace_members.push({
          id: newId("mem"),
          workspace_id: company.id,
          user_id: admin.id,
          role: "admin",
          created_at: nowISO(),
        });
      }

      const hasOwner = db.workspace_members.some(
        (m) => m.workspace_id === company.id && m.role === "owner"
      );
      if (!hasOwner) {
        const adminMember = db.workspace_members.find(
          (m) => m.workspace_id === company.id && m.user_id === admin.id
        );
        if (adminMember) adminMember.role = "owner";
      }
    });
  } catch (err) {
    bootstrapped = false;
    console.error("[bootstrap]", err);
  }
}
