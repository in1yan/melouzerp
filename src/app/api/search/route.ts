import { NextResponse } from "next/server";
import { requireUser, handleApiError, ApiError } from "@/lib/api";
import { getUserWorkspaces } from "@/lib/auth";
import { readDB } from "@/lib/store";
import { issueKey } from "@/lib/domain";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (q.length < 1) return NextResponse.json({ projects: [], issues: [], documents: [] });
    if (q.length > 100) throw new ApiError(400, "Search query too long");

    const wsIds = (await getUserWorkspaces(user.id)).map((w) => w.id);
    const db = await readDB();

    const projects = db.projects
      .filter((p) => wsIds.includes(p.workspace_id))
      .filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ id: p.id, title: p.name, subtitle: p.key, href: `/dashboard/issues?project=${p.id}` }));

    const issues = db.issues
      .filter((i) => {
        const p = db.projects.find((x) => x.id === i.project_id);
        return p && wsIds.includes(p.workspace_id);
      })
      .filter((i) => i.title.toLowerCase().includes(q) || issueKey(db, i).toLowerCase().includes(q))
      .slice(0, 12)
      .map((i) => ({ id: i.id, title: i.title, subtitle: issueKey(db, i), href: `/dashboard/issues?issue=${i.id}` }));

    const documents = db.documents
      .filter((d) => wsIds.includes(d.workspace_id))
      .filter((d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q))
      .slice(0, 8)
      .map((d) => ({ id: d.id, title: d.title, subtitle: "Document", href: `/dashboard/documents?doc=${d.id}` }));

    return NextResponse.json({ projects, issues, documents });
  } catch (err) {
    return handleApiError(err);
  }
}
