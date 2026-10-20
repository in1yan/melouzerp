"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Plus, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/shared/meta";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UserLite {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
}

interface ConversationSummary {
  id: string;
  others: (UserLite | null)[];
  last_message: { body: string; created_at: string; sender_id: string } | null;
  unread: number;
  updated_at: string;
  created_at: string;
}

interface MessageItem {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: UserLite | null;
}

interface MemberRow {
  id: string;
  role: string;
  user: UserLite;
}

function otherName(conv: ConversationSummary): string {
  const o = conv.others.find(Boolean) as UserLite | undefined;
  return o?.name ?? "Unknown";
}

export function MessagesDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { workspace, user } = useWorkspace();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(() => {
    if (!workspace) return;
    api<ConversationSummary[]>(`/api/conversations?workspace=${workspace.id}`)
      .then((data) => setConversations(data))
      .catch(() => {});
  }, [workspace]);

  const loadMessages = useCallback((convId: string) => {
    api<MessageItem[]>(`/api/conversations/${convId}/messages?mark_read=1`)
      .then((data) => {
        setMessages(data);
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, unread: 0 } : c))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open || !workspace) return;
    loadConversations();
    api<MemberRow[]>(`/api/workspaces/${workspace.id}/members`)
      .then((data) => setMembers(data.filter((m) => m.user.id !== user.id)))
      .catch(() => {});
  }, [open, workspace, user.id, loadConversations]);

  useEffect(() => {
    if (!open || !activeId) return;
    loadMessages(activeId);
    const id = setInterval(() => loadMessages(activeId), 8000);
    return () => clearInterval(id);
  }, [open, activeId, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const openConversation = (id: string) => {
    setActiveId(id);
    setPicking(false);
  };

  const startConversation = async (otherId: string) => {
    if (!workspace) return;
    try {
      const conv = await api<{ id: string }>("/api/conversations", {
        method: "POST",
        body: { workspace_id: workspace.id, user_id: otherId },
      });
      setPicking(false);
      setPickQuery("");
      loadConversations();
      setActiveId(conv.id);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not start conversation");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !draft.trim()) return;
    setSending(true);
    const bodyText = draft.trim();
    try {
      const msg = await api<MessageItem>(`/api/conversations/${activeId}/messages`, {
        method: "POST",
        body: { body: bodyText },
      });
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      loadConversations();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  };

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const filteredMembers = members.filter(
    (m) =>
      m.user.name.toLowerCase().includes(pickQuery.toLowerCase()) ||
      m.user.email.toLowerCase().includes(pickQuery.toLowerCase())
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false}>
        <SheetHeader className="border-b p-3">
          <div className="flex items-center gap-2">
            {activeId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setActiveId(null);
                  setMessages([]);
                }}
                title="Back to conversations"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <SheetTitle className="flex-1 truncate">
              {active ? otherName(active) : "Messages"}
            </SheetTitle>
            {!activeId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPicking((p) => !p)}
                title="New message"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
          <SheetDescription className="sr-only">
            Direct messages with your workspace teammates
          </SheetDescription>
        </SheetHeader>

        {picking && !activeId ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b p-2">
              <Input
                autoFocus
                value={pickQuery}
                onChange={(e) => setPickQuery(e.target.value)}
                placeholder="Search teammates…"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {filteredMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => startConversation(m.user.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                >
                  <Avatar name={m.user.name} color={m.user.avatar_color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                    {m.role}
                  </span>
                </button>
              ))}
              {filteredMembers.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No teammates found.
                </div>
              )}
            </div>
          </div>
        ) : active ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
              {messages.length === 0 && (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  No messages yet. Say hello to {otherName(active)}.
                </div>
              )}
              {messages.map((m) => {
                const mine = m.sender_id === user.id;
                return (
                  <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                    {!mine && <Avatar name={m.sender?.name ?? "?"} color={m.sender?.avatar_color} size="sm" />}
                    <div className={cn("max-w-[75%] space-y-0.5", mine && "items-end text-right")}>
                      <div
                        className={cn(
                          "whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm",
                          mine ? "bg-primary text-primary-foreground" : "bg-muted"
                        )}
                      >
                        {m.body}
                      </div>
                      <div className="px-1 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <form onSubmit={send} className="flex items-end gap-2 border-t p-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(e as unknown as React.FormEvent);
                  }
                }}
                placeholder="Write a message…"
                rows={1}
                className="max-h-28 min-h-8 flex-1 resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={sending || !draft.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-1.5">
            {conversations.length === 0 && (
              <div className="px-3 py-10 text-center text-xs text-muted-foreground">
                No conversations yet.
                <br />
                Tap <Plus className="inline h-3 w-3" /> to message a teammate.
              </div>
            )}
            {conversations.map((c) => {
              const o = c.others.find(Boolean) as UserLite | undefined;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                >
                  <Avatar name={o?.name ?? "?"} color={o?.avatar_color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{o?.name ?? "Unknown"}</span>
                      {c.unread > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.last_message
                        ? `${c.last_message.sender_id === user.id ? "You: " : ""}${c.last_message.body}`
                        : "No messages yet"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
