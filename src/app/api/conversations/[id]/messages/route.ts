import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, newId, nowISO, readDB } from "@/lib/store";
import { handleApiError, parseBody, requireUser, ApiError } from "@/lib/api";
import { notify, userLite } from "@/lib/domain";
import type { Message } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

function assertParticipant(convId: string, userId: string) {
  const db = readDB();
  const conv = db.conversations.find((c) => c.id === convId);
  if (!conv) throw new ApiError(404, "Conversation not found");
  if (!conv.participant_ids.includes(userId)) throw new ApiError(403, "You are not in this conversation");
  return { conv, db };
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    assertParticipant(id, user.id);
    const db = readDB();
    const messages = db.messages
      .filter((m) => m.conversation_id === id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ ...m, sender: userLite(db, m.sender_id) }));

    const markRead = new URL(req.url).searchParams.get("mark_read") === "1";
    if (markRead) {
      mutate((d) => {
        for (const m of d.messages) {
          if (m.conversation_id === id && !m.read_by.includes(user.id)) m.read_by.push(user.id);
        }
      });
    }
    return NextResponse.json(messages);
  } catch (err) {
    return handleApiError(err);
  }
}

const sendSchema = z.object({ body: z.string().trim().min(1, "Message cannot be empty").max(5000) });

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    assertParticipant(id, user.id);
    const input = await parseBody(req, sendSchema);

    const message = mutate((db) => {
      const msg: Message = {
        id: newId("msg"),
        conversation_id: id,
        sender_id: user.id,
        body: input.body,
        read_by: [user.id],
        created_at: nowISO(),
      };
      db.messages.push(msg);
      const c = db.conversations.find((x) => x.id === id)!;
      c.updated_at = msg.created_at;
      for (const pid of c.participant_ids) {
        if (pid === user.id) continue;
        notify(db, {
          user_id: pid,
          title: `New message from ${user.name}`,
          message: input.body.slice(0, 140),
          link: "/dashboard",
        });
      }
      return msg;
    });

    const db = readDB();
    return NextResponse.json({ ...message, sender: userLite(db, user.id) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
