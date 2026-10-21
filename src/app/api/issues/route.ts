import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { logActivity, notify, issueKey, userLite } from "@/lib/domain";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspace");
    const projectId = url.searchParams.get("project");
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const assignee = url.searchParams.get("assignee");
    const parent = url.searchParams.get("parent");
    const q = url.searchParams.get("q")?.trim().toLowerCase();

    let scopeWorkspace = workspaceId;
    if (!scopeWorkspace && projectId) {
      const db0 = await readDB();
      const p = db0.projects.find((x) => x.id === projectId);
      if (!p) throw new ApiError(404, "Project not found");
      scopeWorkspace = p.workspace_id;
    }
    if (!scopeWorkspace) throw new ApiError(400, "workspace or project query parameter is required");
    await requireMember(scopeWorkspace);

    const db = await readDB();
    let issues = db.issues.filter((i) => {
      const project = db.projects.find((p) => p.id === i.project_id);
      return project && project.workspace_id === scopeWorkspace;
    });
    if (projectId) issues = issues.filter((i) => i.project_id === projectId);
    if (status) issues = issues.filter((i) => i.status === status);
    if (priority) issues = issues.filter((i) => i.priority === priority);
    if (assignee) {
      issues = assignee === "none"
        ? issues.filter((i) => !i.assignee_id)
        : issues.filter((i) => i.assignee_id === assignee);
    }
    if (parent === "none") issues = issues.filter((i) => !i.parent_id);
    else if (parent) issues = issues.filter((i) => i.parent_id === parent);
    if (q) {
      issues = issues.filter(
        (i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || issueKey(db, i).toLowerCase().includes(q)
      );
    }

    const payload = issues
      .map((i) => {
        const project = db.projects.find((p) => p.id === i.project_id)!;
        return {
          ...i,
          key: issueKey(db, i),
          project: { id: project.id, name: project.name, key: project.key },
          assignee: userLite(db, i.assignee_id),
          reporter: userLite(db, i.reporter_id),
          subtask_count: db.issues.filter((x) => x.parent_id === i.id).length,
        };
      })
      .sort((a, b) => a.order - b.order || b.created_at.localeCompare(a.created_at));

    return NextResponse.json(payload);
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  project_id: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().max(10000).optional(),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  assignee_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD").nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD").nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, createSchema);
    const db = await readDB();
    const project = db.projects.find((p) => p.id === body.project_id);
    if (!project) throw new ApiError(404, "Project not found");
    const { user } = await requireMember(project.workspace_id);

    if (body.assignee_id) {
      const isMember = db.workspace_members.some(
        (m) => m.workspace_id === project.workspace_id && m.user_id === body.assignee_id
      );
      if (!isMember) throw new ApiError(400, "Assignee is not a member of this workspace");
    }
    if (body.parent_id) {
      const parent = db.issues.find((i) => i.id === body.parent_id);
      if (!parent || parent.project_id !== body.project_id) throw new ApiError(400, "Invalid parent issue");
    }

    const issue = await mutate((db2) => {
      const siblings = db2.issues.filter((i) => i.project_id === body.project_id);
      const nextNumber = siblings.reduce((max, i) => Math.max(max, i.issue_number), 0) + 1;
      const maxOrder = siblings.reduce((max, i) => Math.max(max, i.order), 0);
      const id = newId("iss");
      db2.issues.push({
        id,
        project_id: body.project_id,
        issue_number: nextNumber,
        title: body.title,
        description: body.description ?? "",
        status: body.status ?? "backlog",
        priority: body.priority ?? "medium",
        assignee_id: body.assignee_id ?? null,
        reporter_id: user.id,
        parent_id: body.parent_id ?? null,
        start_date: body.start_date ?? null,
        due_date: body.due_date ?? null,
        labels: body.labels ?? [],
        order: maxOrder + 1,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      const created = db2.issues.find((i) => i.id === id)!;
      logActivity(db2, {
        workspace_id: project.workspace_id,
        user_id: user.id,
        action: "issue.created",
        entity_type: "issue",
        entity_id: id,
        summary: `${user.name} created ${issueKey(db2, created)} "${created.title}"`,
      });
      if (created.assignee_id && created.assignee_id !== user.id) {
        notify(db2, {
          user_id: created.assignee_id,
          title: "You were assigned an issue",
          message: `${user.name} assigned you ${issueKey(db2, created)}: ${created.title}`,
          link: `/dashboard/issues?issue=${id}`,
        });
      }
      if (created.parent_id) {
        const parent = db2.issues.find((i) => i.id === created.parent_id);
        if (parent && parent.reporter_id !== user.id) {
          notify(db2, {
            user_id: parent.reporter_id,
            title: "New subtask",
            message: `${user.name} added subtask "${created.title}" under ${issueKey(db2, parent)}`,
            link: `/dashboard/issues?issue=${parent.id}`,
          });
        }
      }
      return created;
    });

    return NextResponse.json(issue, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
