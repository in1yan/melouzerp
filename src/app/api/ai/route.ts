import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleApiError, parseBody, ApiError } from "@/lib/api";
import { getMembership } from "@/lib/auth";
import { readDB } from "@/lib/store";
import { issueKey } from "@/lib/domain";

function aiConfig() {
  const key = process.env.AI_API_KEY?.trim();
  const baseUrl = (process.env.AI_API_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL?.trim() || "gpt-4o-mini";
  return { key, baseUrl, model };
}

const setupHint =
  "The AI assistant is not configured. Set AI_API_KEY in .env.local (and optionally AI_API_BASE_URL, AI_MODEL), then restart the server.";

export async function GET() {
  try {
    await requireUser();
    const { key, model } = aiConfig();
    return NextResponse.json({ configured: Boolean(key), model: key ? model : null, hint: key ? null : setupHint });
  } catch (err) {
    return handleApiError(err);
  }
}

const messageSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(4000),
  workspace_id: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

function buildWorkspaceContext(db: Awaited<ReturnType<typeof readDB>>, workspaceId: string, userId: string): string {
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return "";
  const projects = db.projects.filter((p) => p.workspace_id === workspaceId);
  const issues = db.issues.filter((i) => projects.some((p) => p.id === i.project_id));
  const mine = issues.filter((i) => i.assignee_id === userId && i.status !== "done");
  const byStatus: Record<string, number> = {};
  for (const i of issues) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  const top = issues
    .filter((i) => i.status !== "done")
    .slice(0, 15)
    .map((i) => {
      const p = db.projects.find((x) => x.id === i.project_id)!;
      const assignee = db.users.find((u) => u.id === i.assignee_id);
      return `- ${issueKey(db, i)} [${i.status}/${i.priority}] ${i.title}${assignee ? ` (assignee: ${assignee.name})` : ""} project=${p.name}${i.due_date ? ` due=${i.due_date}` : ""}`;
    })
    .join("\n");
  return [
    `Workspace: ${ws.name}`,
    `Projects (${projects.length}): ${projects.map((p) => `${p.name} (${p.key}, ${db.issues.filter((i) => i.project_id === p.id).length} issues)`).join("; ") || "none"}`,
    `Issues by status: ${JSON.stringify(byStatus)}`,
    `My open assigned issues: ${mine.length}`,
    `Open issues:\n${top || "- none"}`,
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, messageSchema);
    const { key, baseUrl, model } = aiConfig();
    if (!key) throw new ApiError(503, setupHint);
    if (body.workspace_id && !(await getMembership(body.workspace_id, user.id))) {
      throw new ApiError(403, "You are not a member of this workspace");
    }

    const context = body.workspace_id
      ? buildWorkspaceContext(await readDB(), body.workspace_id, user.id)
      : "";
    const system = [
      "You are the built-in assistant for Melouz OS, a project management and ERP workspace.",
      "Answer concisely and practically. Use the live workspace context below when relevant; do not invent data that is not there.",
      context ? `Live workspace context:\n${context}` : "No workspace context was provided.",
    ].join("\n\n");

    const messages = [
      { role: "system", content: system },
      ...(body.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: body.message },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 800 }),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(502, `Could not reach the AI provider at ${baseUrl}. Check AI_API_BASE_URL and your network.`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new ApiError(502, "The AI provider rejected AI_API_KEY. Check your key.");
      throw new ApiError(502, `AI provider error (${res.status}). ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string") throw new ApiError(502, "AI provider returned an unexpected response shape.");
    return NextResponse.json({ reply });
  } catch (err) {
    return handleApiError(err);
  }
}
