import { NextResponse } from "next/server";
import { readDB } from "@/lib/store";
import { handleApiError, requireMember, ApiError } from "@/lib/api";
import { isAdminRole } from "@/lib/auth";
import { userLite, issueKey } from "@/lib/domain";
import type { Role } from "@/lib/types";

interface MetricsRow {
  user: { id: string; name: string; email: string; avatar_color: string };
  role: Role;
  assigned: number;
  pending: number;
  submitted: number;
  approved: number;
  rejected: number;
  in_review: number;
  completion_rate: number;
  avg_approval_hours: number | null;
  assigned_work: number;
  created_issues: number;
  submit_count: number;
  resubmit_count: number;
  raised: { id: string; key: string; title: string; status: string; created_at: string }[];
  works: {
    id: string;
    issue_id: string;
    issue_key: string;
    issue_title: string;
    status: string;
    submit_count: number;
    resubmit_count: number;
    assigned_at: string;
    submitted_at: string | null;
    rejection_reason: string | null;
  }[];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspace");
    if (!workspaceId) throw new ApiError(400, "workspace query parameter is required");
    const { user: me, role: myRole } = await requireMember(workspaceId);

    const db = await readDB();
    const members = db.workspace_members.filter((m) => m.workspace_id === workspaceId);
    const projectIds = new Set(db.projects.filter((p) => p.workspace_id === workspaceId).map((p) => p.id));
    const workspaceIssueIds = new Set(db.issues.filter((i) => projectIds.has(i.project_id)).map((i) => i.id));

    const admin = isAdminRole(myRole);
    const lead = myRole === "lead";

    const visible = members.filter((m) => {
      if (admin) return true;
      if (lead) return m.role === "employee" || m.user_id === me.id;
      return m.user_id === me.id;
    });

    const rows: MetricsRow[] = visible.map((m) => {
      const info = userLite(db, m.user_id)!;
      const assignments = db.issue_assignments.filter(
        (a) => a.user_id === m.user_id && workspaceIssueIds.has(a.issue_id)
      );
      const approved = assignments.filter((a) => a.status === "approved").length;
      const rejected = assignments.filter((a) => a.status === "rejected").length;
      const submitted = assignments.filter((a) => a.status === "submitted").length;
      const pending = assignments.filter((a) => a.status === "pending").length;

      const approvalTimes = assignments
        .filter((a) => a.approved_at && a.submitted_at)
        .map(
          (a) =>
            (new Date(a.approved_at as string).getTime() -
              new Date(a.submitted_at as string).getTime()) /
            3_600_000
        );
      const avgApproval =
        approvalTimes.length > 0
          ? approvalTimes.reduce((s, x) => s + x, 0) / approvalTimes.length
          : null;

      const createdIssues = db.issues
        .filter((i) => projectIds.has(i.project_id) && i.reporter_id === m.user_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      const works = assignments
        .map((a) => {
          const iss = db.issues.find((i) => i.id === a.issue_id);
          return {
            id: a.id,
            issue_id: a.issue_id,
            issue_key: iss ? issueKey(db, iss) : a.issue_id,
            issue_title: iss?.title ?? "Unknown issue",
            status: a.status,
            submit_count: a.submit_count ?? 0,
            resubmit_count: a.resubmit_count ?? 0,
            assigned_at: a.created_at,
            submitted_at: a.submitted_at,
            rejection_reason: a.rejection_reason,
          };
        })
        .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));

      const submitCount = assignments.reduce((s, a) => s + (a.submit_count ?? 0), 0);
      const resubmitCount = assignments.reduce((s, a) => s + (a.resubmit_count ?? 0), 0);

      return {
        user: info,
        role: m.role,
        assigned: assignments.length,
        pending,
        submitted,
        approved,
        rejected,
        in_review: submitted,
        completion_rate: assignments.length ? Math.round((approved / assignments.length) * 100) : 0,
        avg_approval_hours: avgApproval !== null ? Math.round(avgApproval * 10) / 10 : null,
        assigned_work: assignments.length,
        created_issues: createdIssues.length,
        submit_count: submitCount,
        resubmit_count: resubmitCount,
        raised: createdIssues.map((i) => ({
          id: i.id,
          key: issueKey(db, i),
          title: i.title,
          status: i.status,
          created_at: i.created_at,
        })),
        works,
      };
    });

    rows.sort((a, b) => b.approved - a.approved || b.assigned - a.assigned);

    const scope = admin ? "all" : lead ? "employees" : "self";
    return NextResponse.json({ scope, viewer_role: myRole, rows });
  } catch (err) {
    return handleApiError(err);
  }
}
