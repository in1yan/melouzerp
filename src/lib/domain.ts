import { newId, nowISO, readDB } from "./store";
import type { Activity, DB, Issue, Notification, Project } from "./types";
import { sendEmail } from "./mailer";

export function logActivity(
  db: DB,
  entry: Omit<Activity, "id" | "created_at">
): Activity {
  const activity: Activity = { ...entry, id: newId("act"), created_at: nowISO() };
  db.activities.unshift(activity);
  if (db.activities.length > 500) db.activities.length = 500;
  return activity;
}

export function notify(db: DB, entry: Omit<Notification, "id" | "created_at" | "read">): Notification {
  const notification: Notification = {
    ...entry,
    id: newId("ntf"),
    read: false,
    created_at: nowISO(),
  };
  db.notifications.unshift(notification);
  if (db.notifications.length > 500) db.notifications.length = 500;
  const recipient = db.users.find((user) => user.id === notification.user_id);
  if (recipient) {
    queueMicrotask(() => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      void sendEmail({
        to: recipient.email,
        subject: notification.title,
        text: `${notification.message}${
          notification.link ? `\n\nOpen Melouz OS: ${appUrl ? `${appUrl}${notification.link}` : notification.link}` : ""
        }`,
      }).catch((error) => {
        console.error("[mailer] notification delivery failed:", error);
      });
    });
  }
  return notification;
}

export function projectOf(db: DB, issue: Issue): Project | undefined {
  return db.projects.find((p) => p.id === issue.project_id);
}

export function issueKey(db: DB, issue: Issue): string {
  const project = projectOf(db, issue);
  return project ? `${project.key}-${issue.issue_number}` : issue.id;
}

export function userLite(db: DB, userId: string | null) {
  if (!userId) return null;
  const u = db.users.find((x) => x.id === userId);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatar_color: u.avatar_color };
}

export function workspaceOfIssue(db: DB, issueId: string) {
  const issue = db.issues.find((i) => i.id === issueId);
  if (!issue) return null;
  const project = db.projects.find((p) => p.id === issue.project_id);
  if (!project) return null;
  return db.workspaces.find((w) => w.id === project.workspace_id) ?? null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function ensureWorkspaceSlug(db: DB, base: string, excludeId?: string): string {
  let slug = base || "workspace";
  if (slug.length < 2) slug = `ws-${slug}`;
  let candidate = slug;
  let i = 1;
  while (db.workspaces.some((w) => w.slug === candidate && w.id !== excludeId)) {
    candidate = `${slug}-${i++}`;
  }
  return candidate;
}

export function ensureProjectKey(db: DB, workspaceId: string, base: string, excludeId?: string): string {
  let candidate = base;
  let i = 1;
  while (db.projects.some((p) => p.workspace_id === workspaceId && p.key === candidate && p.id !== excludeId)) {
    candidate = `${base}${i++}`.slice(0, 10);
  }
  return candidate;
}

export async function getDb() {
  return readDB();
}
