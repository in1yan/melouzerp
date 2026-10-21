import { NextResponse } from "next/server";
import { readDB } from "@/lib/store";
import { requireMember, handleApiError, ApiError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspace = url.searchParams.get("workspace");
    const issue = url.searchParams.get("issue");
    const mine = url.searchParams.get("mine");
    let wsId = workspace;
    const db = await readDB();
    if (issue) {
      const iss = db.issues.find((i) => i.id === issue);
      if (!iss) throw new ApiError(404, "Issue not found");
      const proj = db.projects.find((p) => p.id === iss.project_id);
      if (!proj) throw new ApiError(404, "Project not found");
      wsId = proj.workspace_id;
    }
    let userId: string | null = null;
    if (mine === "1") {
      const u = await getSessionUser();
      if (u) userId = u.id;
    }
    if (wsId) await requireMember(wsId);
    else if (mine !== "1") throw new ApiError(400, "workspace is required");

    let list = db.issue_assignments.slice();
    if (issue) list = list.filter((a) => a.issue_id === issue);
    if (userId && mine === "1") list = list.filter((a) => a.user_id === userId);
    if (wsId && !issue && mine !== "1") {
      const projIds = new Set(db.projects.filter((p) => p.workspace_id === wsId).map((p) => p.id));
      list = list.filter((a) => projIds.has(db.issues.find((i) => i.id === a.issue_id)?.project_id ?? ""));
    }

    const payload = list.map((a) => {
      const iss = db.issues.find((i) => i.id === a.issue_id);
      const proj = iss ? db.projects.find((p) => p.id === iss.project_id) : null;
      const assignee = db.users.find((u) => u.id === a.user_id);
      const assigner = db.users.find((u) => u.id === a.assigned_by);
      const atts = db.submission_attachments.filter((att) => att.assignment_id === a.id);
      return {
        ...a,
        issue: iss ? { id: iss.id, title: iss.title, issue_number: iss.issue_number, project_id: iss.project_id } : null,
        project: proj ? { id: proj.id, name: proj.name, key: proj.key } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name, avatar_color: assignee.avatar_color } : null,
        assigner: assigner ? { id: assigner.id, name: assigner.name } : null,
        attachments: atts.map((att) => ({
          id: att.id,
          filename: att.filename,
          content_type: att.content_type,
          size: att.size,
          uploaded_at: att.uploaded_at,
        })),
      };
    });
    return NextResponse.json(payload);
  } catch (err) {
    return handleApiError(err);
  }
}
