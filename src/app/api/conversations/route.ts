import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { handleApiError, parseBody, requireMember, requireUser, ApiError } from "@/lib/api";
import { userLite } from "@/lib/domain";
import type { Conversation, Message } from "@/lib/types";

function enrich(db: ReturnType<typeof readDB>, conv: Conversation, meId: string) {
  const otherIds = conv.participant_ids.filter((id) => id !== meId);
  const last = db.messages
    .filter((m) => m.conversation_id === conv.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const unread = db.messages.filter(
    (m) => m.conversation_id === conv.id && m.sender_id !== meId && !m.read_by.includes(meId)
  ).length;
  return {
    id: conv.id,
    workspace_id: conv.workspace_id,
    participants: conv.participant_ids.map((id) => userLite(db, id)),
    others: otherIds.map((id) => userLite(db, id)),
    last_message: last
      ? {
          id: last.id,
          body: last.body,
          sender_id: last.sender_id,
          sender: userLite(db, last.sender_id),
          created_at: last.created_at,
        }
      : null,
    unread,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
  };
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspace");
    const db = readDB();
    let convs = db.conversations.filter((c) => c.participant_ids.includes(user.id));
    if (workspaceId) convs = convs.filter((c) => c.workspace_id === workspaceId);
    const enriched = convs
      .map((c) => enrich(db, c, user.id))
      .sort((a, b) => (b.last_message?.created_at ?? b.created_at).localeCompare(a.last_message?.created_at ?? a.created_at));
    return NextResponse.json(enriched);
  } catch (err) {
    return handleApiError(err);
  }
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, createSchema);
    const { user } = await requireMember(body.workspace_id);
    if (body.user_id === user.id) throw new ApiError(400, "You cannot message yourself");

    const db0 = readDB();
    const target = db0.users.find((u) => u.id === body.user_id);
    if (!target) throw new ApiError(404, "That user does not exist");
    const targetMember = db0.workspace_members.some(
      (m) => m.workspace_id === body.workspace_id && m.user_id === body.user_id
    );
    if (!targetMember) throw new ApiError(400, "That user is not a member of this workspace");

    const existing = db0.conversations.find(
      (c) =>
        c.workspace_id === body.workspace_id &&
        c.participant_ids.length === 2 &&
        c.participant_ids.includes(user.id) &&
        c.participant_ids.includes(body.user_id)
    );

    const result = mutate((db) => {
      if (existing) return { conv: existing, created: false };
      const conv: Conversation = {
        id: newId("conv"),
        workspace_id: body.workspace_id,
        participant_ids: [user.id, body.user_id],
        created_by: user.id,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
      db.conversations.push(conv);
      return { conv, created: true };
    });

    return NextResponse.json(enrich(db0, result.conv, user.id), { status: result.created ? 201 : 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

export type { Message };
