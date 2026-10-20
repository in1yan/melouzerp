"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client";
import { useWorkspace } from "@/components/providers/workspace-provider";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; hint?: string | null; model?: string | null } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (open && status === null) {
      api<{ configured: boolean; hint: string | null; model: string | null }>("/api/ai")
        .then(setStatus)
        .catch(() => setStatus({ configured: false, hint: "Could not reach /api/ai." }));
    }
  }, [open, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const res = await api<{ reply: string }>("/api/ai", {
        method: "POST",
        body: {
          message: text,
          workspace_id: workspace?.id,
          history: nextMessages.slice(0, -1).slice(-10),
        },
      });
      setMessages([...nextMessages, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "The assistant request failed.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen((o) => !o)}
        size="icon"
        className="fixed bottom-4 right-4 z-40 h-11 w-11 rounded-full shadow-lg"
        title="AI assistant"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>

      {open && (
        <div className="fixed bottom-20 right-4 z-40 flex h-[540px] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <h3 className="text-sm font-semibold">Melouz Assistant</h3>
            </div>
            {status && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  status.configured ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
                )}
              >
                {status.configured ? status.model ?? "configured" : "not configured"}
              </span>
            )}
          </div>

          {status && !status.configured && (
            <div className="border-b bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              AI is disabled until you configure it. Add <code className="rounded bg-background px-1">AI_API_KEY</code>{" "}
              (and optionally <code className="rounded bg-background px-1">AI_API_BASE_URL</code>,{" "}
              <code className="rounded bg-background px-1">AI_MODEL</code>) to <code className="rounded bg-background px-1">.env.local</code>,
              then restart the server. This assistant does not fake answers.
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {status?.configured
                    ? "Ask me about this workspace: open issues, what to work on next, or project status."
                    : "Configure AI_API_KEY to enable real answers. Until then requests will return the setup instructions."}
                </span>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 border-t p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your workspace…"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button onClick={send} size="icon" disabled={sending || !input.trim()} title="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
