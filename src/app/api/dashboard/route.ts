import { NextResponse } from "next/server";
import { requireMember, handleApiError, ApiError } from "@/lib/api";
import { readDB } from "@/lib/store";
import { issueKey } from "@/lib/domain";

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace query parameter is required");
    const { user, role } = await requireMember(workspaceId);

    const db = readDB();
    const projectIds = db.projects.filter((p) => p.workspace_id === workspaceId).map((p) => p.id);
    const issues = db.issues.filter((i) => projectIds.includes(i.project_id));
    const today = new Date().toISOString().slice(0, 10);

    const byStatus: Record<string, number> = {
      backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0,
    };
    let overdue = 0;
    let dueSoon = 0;
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    for (const i of issues) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      if (i.due_date && i.status !== "done") {
        if (i.due_date < today) overdue++;
        else if (i.due_date <= in7) dueSoon++;
      }
    }

    const memberIds = db.workspace_members.filter((m) => m.workspace_id === workspaceId).map((m) => m.user_id);
    const recentIssues = [...issues]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)
      .map((i) => {
        const p = db.projects.find((x) => x.id === i.project_id)!;
        const assignee = db.users.find((u) => u.id === i.assignee_id) ?? null;
        return {
          id: i.id,
          key: issueKey(db, i),
          title: i.title,
          status: i.status,
          priority: i.priority,
          due_date: i.due_date,
          project: { id: p.id, name: p.name, key: p.key },
          assignee: assignee ? { id: assignee.id, name: assignee.name, avatar_color: assignee.avatar_color } : null,
        };
      });

    const recentActivity = db.activities
      .filter((a) => a.workspace_id === workspaceId)
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        summary: a.summary,
        entity_type: a.entity_type,
        created_at: a.created_at,
        user: db.users.find((u) => u.id === a.user_id)
          ? { id: a.user_id!, name: db.users.find((u) => u.id === a.user_id)!.name, avatar_color: db.users.find((u) => u.id === a.user_id)!.avatar_color }
          : null,
      }));

    const projects = db.projects
      .filter((p) => p.workspace_id === workspaceId)
      .map((p) => {
        const pIssues = issues.filter((i) => i.project_id === p.id);
        const done = pIssues.filter((i) => i.status === "done").length;
        return {
          id: p.id,
          name: p.name,
          key: p.key,
          status: p.status,
          issue_count: pIssues.length,
          done_count: done,
          progress: pIssues.length ? Math.round((done / pIssues.length) * 100) : 0,
        };
      })
      .sort((a, b) => b.issue_count - a.issue_count)
      .slice(0, 6);

    const workload = memberIds
      .map((id) => {
        const u = db.users.find((x) => x.id === id);
        if (!u) return null;
        const assigned = issues.filter((i) => i.assignee_id === id && i.status !== "done");
        return {
          id: u.id,
          name: u.name,
          avatar_color: u.avatar_color,
          open_issues: assigned.length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.open_issues - a.open_issues);

    const total = issues.length;
    const completed = byStatus.done;
    return NextResponse.json({
      role,
      viewer: { id: user.id, name: user.name },
      stats: {
        total_issues: total,
        completed,
        in_progress: byStatus.in_progress + byStatus.review,
        overdue,
        due_soon: dueSoon,
        projects: projectIds.length,
        members: memberIds.length,
        completion_rate: total ? Math.round((completed / total) * 100) : 0,
      },
      by_status: byStatus,
      recent_issues: recentIssues,
      recent_activity: recentActivity,
      projects,
      workload,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
