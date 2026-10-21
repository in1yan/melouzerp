import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { requireMember, handleApiError, parseBody, ApiError } from "@/lib/api";
import { isSuperiorRole } from "@/lib/auth";
import { logActivity, notify, issueKey } from "@/lib/domain";

type Ctx = { params: Promise<{ id: string }> };

const assignSchema = z.object({
  user_ids: z.array(z.string().min(1)).min(1, "Select at least one employee"),
  note: z.string().max(2000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const db0 = await readDB();
    const issue = db0.issues.find((i) => i.id === id);
    if (!issue) throw new ApiError(404, "Issue not found");
    const project = db0.projects.find((p) => p.id === issue.project_id);
    if (!project) throw new ApiError(404, "Project not found");
    const { user, role } = await requireMember(project.workspace_id);
    if (!isSuperiorRole(role) && project.lead_id !== user.id) {
      throw new ApiError(403, "Only workspace admins, leads, or the project lead can assign work");
    }
    const body = await parseBody(req, assignSchema);

    const result = await mutate((db) => {
      const assigned: string[] = [];
      for (const uid of body.user_ids) {
        const isMember = db.workspace_members.some((m) => m.workspace_id === project.workspace_id && m.user_id === uid);
        if (!isMember) continue;
        if (db.issue_assignments.some((a) => a.issue_id === id && a.user_id === uid && a.status !== "rejected")) continue;
        const aid = newId("asn");
        db.issue_assignments.push({
          id: aid,
          issue_id: id,
          user_id: uid,
          assigned_by: user.id,
          note: body.note ?? "",
          due_date: body.due_date ?? null,
          status: "pending",
          submission_text: "",
          submit_count: 0,
          resubmit_count: 0,
          submitted_at: null,
          approved_at: null,
          approved_by: null,
          rejection_reason: null,
          created_at: nowISO(),
          updated_at: nowISO(),
        });
        assigned.push(uid);
        if (uid !== user.id) {
          notify(db, {
            user_id: uid,
            title: "New work assigned",
            message: `${user.name} assigned you ${issueKey(db, issue)}: ${issue.title}`,
            link: `/dashboard/issues?issue=${id}`,
          });
        }
      }
      if (assigned.length) {
        logActivity(db, {
          workspace_id: project.workspace_id,
          user_id: user.id,
          action: "issue.assigned",
          entity_type: "issue",
          entity_id: id,
          summary: `${user.name} assigned ${issueKey(db, issue)} to ${assigned.length} member(s)`,
        });
      }
      return assigned;
    });

    return NextResponse.json({ ok: true, assigned_count: result.length });
  } catch (err) {
    return handleApiError(err);
  }
}
