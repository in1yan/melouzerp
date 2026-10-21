import crypto from "crypto";
import { mutate, newId, nowISO, readDB } from "./store";
import { hashPassword } from "./auth";
import type { User } from "./types";

export const COMPANY_WORKSPACE_NAME = process.env.COMPANY_WORKSPACE_NAME || "Melouz Company";
export const DEFAULT_ADMIN_EMAIL = (process.env.DEFAULT_ADMIN_EMAIL || "admin@melouz.local")
  .trim()
  .toLowerCase();

function resetRequested(): boolean {
  const v = (process.env.RESET_ADMIN_PASSWORD ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * How long a successful check is trusted. The database can be reset or
 * repointed while the process is running (a fresh cluster, a restored
 * snapshot, …) — after this interval the provisioning state is verified
 * again so the admin account and the company workspace are re-created when
 * they are missing.
 */
const BOOTSTRAP_RECHECK_MS = 30_000;

let bootstrapCheckedAt = 0;
let bootstrapReady = false;
/** A password reset is applied once per process, not on every re-check. */
let resetApplied = false;

function resolveAdminPassword(): { password: string; generated: boolean } {
  const fromEnv = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
  if (fromEnv) return { password: fromEnv, generated: false };
  if (process.env.NODE_ENV === "production") {
    // Never ship a well-known default to production: generate a strong random
    // password and surface it once in the server logs.
    return { password: crypto.randomBytes(18).toString("base64url"), generated: true };
  }
  return { password: "admin12345", generated: false };
}

export async function ensureBootstrap(): Promise<void> {
  if (bootstrapReady && Date.now() - bootstrapCheckedAt < BOOTSTRAP_RECHECK_MS) return;
  try {
    const current = await readDB();
    const existingAdmin = current.users.find((u) => u.email === DEFAULT_ADMIN_EMAIL);
    const hasCredential =
      Boolean(existingAdmin) &&
      current.password_credentials.some((c) => c.user_id === existingAdmin!.id);
    const isReset = resetRequested() && !resetApplied;
    const needsPassword = !existingAdmin || !hasCredential || isReset;

    // Fast path: if everything is already provisioned, avoid a redundant write
    // on every cold start (each write is a network round-trip and a conflict
    // point when several instances boot at the same time).
    const company = current.workspaces.find((w) => w.is_company);
    const adminMembership =
      company && existingAdmin
        ? current.workspace_members.find(
            (m) => m.workspace_id === company.id && m.user_id === existingAdmin.id
          )
        : undefined;
    const hasOwner = company
      ? current.workspace_members.some((m) => m.workspace_id === company.id && m.role === "owner")
      : false;
    if (!isReset && company && existingAdmin && hasCredential && adminMembership && hasOwner) {
      bootstrapReady = true;
      bootstrapCheckedAt = Date.now();
      return;
    }

    // Only hash/surface a password when it will actually be stored. This avoids
    // printing a useless new password on every cold start for an existing admin.
    let passwordHash: string | null = null;
    let generatedPassword: string | null = null;
    if (needsPassword) {
      const { password, generated } = resolveAdminPassword();
      passwordHash = await hashPassword(password);
      if (generated) generatedPassword = password;
    }

    await mutate((db) => {
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
          password_hash: passwordHash!,
        });
      } else if (needsPassword && passwordHash) {
        const credential = db.password_credentials.find((c) => c.user_id === admin!.id);
        if (credential) credential.password_hash = passwordHash;
        else db.password_credentials.push({ user_id: admin.id, password_hash: passwordHash });
      }

      const isMember = db.workspace_members.some(
        (m) => m.workspace_id === company!.id && m.user_id === admin!.id
      );
      if (!isMember) {
        db.workspace_members.push({
          id: newId("mem"),
          workspace_id: company!.id,
          user_id: admin!.id,
          role: "admin",
          created_at: nowISO(),
        });
      }

      const hasOwner = db.workspace_members.some(
        (m) => m.workspace_id === company!.id && m.role === "owner"
      );
      if (!hasOwner) {
        const adminMember = db.workspace_members.find(
          (m) => m.workspace_id === company!.id && m.user_id === admin!.id
        );
        if (adminMember) adminMember.role = "owner";
      }
    });

    if (generatedPassword) {
      console.log(
        `\n[bootstrap] ${isReset ? "ADMIN PASSWORD RESET" : "DEFAULT_ADMIN_PASSWORD is not set"}. ` +
          `A one-time admin password was generated:\n` +
          `            email:    ${DEFAULT_ADMIN_EMAIL}\n` +
          `            password: ${generatedPassword}\n` +
          `            Store it now — set DEFAULT_ADMIN_PASSWORD in your environment to control it.\n` +
          `            Remove RESET_ADMIN_PASSWORD afterwards to stop resetting on each boot.\n`
      );
    } else if (isReset) {
      console.log(
        `\n[bootstrap] Admin password for ${DEFAULT_ADMIN_EMAIL} was reset from DEFAULT_ADMIN_PASSWORD.` +
          `\n            Remove RESET_ADMIN_PASSWORD from your environment now so future restarts keep it.\n`
      );
    }
    if (isReset) resetApplied = true;
    bootstrapReady = true;
    bootstrapCheckedAt = Date.now();
  } catch (err) {
    // Retry on the next request — the database may not have been reachable.
    bootstrapReady = false;
    bootstrapCheckedAt = 0;
    console.error("[bootstrap]", err);
  }
}
