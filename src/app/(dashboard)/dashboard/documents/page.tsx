"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, Plus, Trash2, Eye, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { EmptyState } from "@/components/shared/meta";
import { api, ApiClientError } from "@/lib/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface DocListItem {
  id: string;
  title: string;
  excerpt: string;
  updated_at: string;
  updated_by: { id: string; name: string; avatar_color: string } | null;
}

interface DocDetail {
  id: string;
  title: string;
  content: string;
  workspace_id: string;
  created_by: string;
  updated_at: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(raw); continue; }
    const line = raw
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = h[1].length;
      out.push(`<h${level + 2} class="mt-3 mb-1 font-semibold">${h[2]}</h${level + 2}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul class=\"list-disc pl-5 space-y-0.5\">"); inList = true; }
      out.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
      continue;
    }
    if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push('<div class="h-2"></div>');
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p class="mb-1.5 leading-relaxed">${line}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function DocumentsInner() {
  const { workspace, loading: wsLoading } = useWorkspace();
  const search = useSearchParams();
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => search.get("doc"));
  const [selectedId, setSelectedId] = useState<string | null>(() => search.get("doc"));
  const [active, setActive] = useState<DocDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const loadList = useCallback(() => {
    if (!workspace) return;
    api<DocListItem[]>(`/api/documents?workspace=${workspace.id}`)
      .then((data) => {
        setDocs(data);
      })
      .finally(() => setLoading(false));
  }, [workspace]);

  const loadDoc = useCallback((id: string) => {
    api<DocDetail>(`/api/documents/${id}`)
      .then((data) => {
        setActive(data);
        setTitle(data.title);
        setContent(data.content);
        dirty.current = false;
        setSaveState("idle");
        setDocLoading(false);
      })
      .catch((err) => {
        toast.error(err instanceof ApiClientError ? err.message : "Could not open document");
        setActive(null);
        setDocLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!wsLoading) loadList();
  }, [wsLoading, loadList]);

  useEffect(() => {
    if (activeId) loadDoc(activeId);
  }, [activeId, loadDoc]);

  const persist = useCallback(
    async (fields: { title?: string; content?: string }) => {
      if (!activeId) return;
      setSaveState("saving");
      try {
        await api(`/api/documents/${activeId}`, { method: "PATCH", body: fields });
        setSaveState("saved");
        dirty.current = false;
        setDocs((prev) =>
          prev.map((d) =>
            d.id === activeId
              ? { ...d, title: fields.title ?? d.title, updated_at: new Date().toISOString() }
              : d
          )
        );
      } catch (err) {
        setSaveState("error");
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    },
    [activeId]
  );

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist({ title: title || "Untitled", content }), 900);
  }, [title, content, persist]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current && activeId) {
        void api(`/api/documents/${activeId}`, {
          method: "PATCH",
          body: { title: title || "Untitled", content },
        }).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const createDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    try {
      const doc = await api<{ id: string }>("/api/documents", {
        method: "POST",
        body: { workspace_id: workspace.id, title: newTitle.trim() || "Untitled" },
      });
      setCreateOpen(false);
      setNewTitle("");
      await loadList();
      setSelectedId(doc.id);
      const params = new URLSearchParams(window.location.search);
      params.set("doc", doc.id);
      window.history.replaceState(null, "", `/dashboard/documents?${params.toString()}`);
      toast.success("Document created");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not create document");
    }
  };

  const removeDoc = async (id: string, docTitle: string) => {
    if (!window.confirm(`Delete document "${docTitle}"? This cannot be undone.`)) return;
    try {
      await api(`/api/documents/${id}`, { method: "DELETE" });
      toast.success("Document deleted");
      if (selectedId === id) {
        setSelectedId(null);
        setActiveId(null);
        const params = new URLSearchParams(window.location.search);
        params.delete("doc");
        window.history.replaceState(null, "", `/dashboard/documents${params.toString() ? `?${params}` : ""}`);
      }
      loadList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete document");
    }
  };

  const openDoc = (id: string) => {
    setSelectedId(id);
    setActiveId(id);
    const params = new URLSearchParams(window.location.search);
    params.set("doc", id);
    window.history.replaceState(null, "", `/dashboard/documents?${params.toString()}`);
  };

  const previewHtml = useMemo(() => renderMarkdown(content), [content]);

  if (!wsLoading && !workspace) {
    return (
      <div className="p-8">
        <EmptyState title="No workspace selected" description="Select a workspace to work on documents." action={null} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-44 shrink-0 flex-col border-r bg-muted/20 sm:w-64">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-semibold">Documents</span>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New document"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {createOpen && (
            <form onSubmit={createDoc} className="mb-2 flex gap-1">
              <Input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Document title"
                className="h-8 text-sm"
              />
              <Button type="submit" size="sm" className="h-8 shrink-0">
                Add
              </Button>
            </form>
          )}
          {loading && <div className="space-y-2">{[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted" />
          ))}</div>}
          {!loading && docs.length === 0 && !createOpen && (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              No documents yet. Click + to create one.
            </div>
          )}
          {docs.map((d) => (
            <div
              key={d.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                d.id === selectedId ? "bg-accent font-medium" : "hover:bg-accent"
              )}
              onClick={() => openDoc(d.id)}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeDoc(d.id, d.title);
                }}
                className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                title="Delete document"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {!selectedId && !createOpen && (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              title={docs.length === 0 ? "Create your first document" : "Select a document"}
              description={
                docs.length === 0
                  ? "Documents are your team's knowledge base — notes, specs, wikis. Markdown is supported."
                  : "Pick a document from the left, or create a new one."
              }
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" /> New document
                </Button>
              }
            />
          </div>
        )}
        {activeId && (!active || active.id !== activeId) && (
          <div className="p-8 text-sm text-muted-foreground">Loading document…</div>
        )}
        {active && active.id === activeId && !docLoading && (
          <div className="mx-auto flex h-full max-w-4xl flex-col">
            <div className="flex items-center gap-2 border-b px-4 py-3 sm:px-6">
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  scheduleSave();
                }}
                className="h-auto border-none px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                placeholder="Untitled"
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {saveState === "saving" && "Saving…"}
                {saveState === "saved" && (
                  <span className="text-emerald-600">Saved</span>
                )}
                {saveState === "error" && <span className="text-destructive">Save failed</span>}
                {saveState === "idle" && `Edited ${formatDistanceToNow(new Date(active.updated_at), { addSuffix: true })}`}
              </span>
              <div className="ml-2 flex shrink-0 items-center gap-1 rounded-md border p-0.5">
                <button
                  onClick={() => setPreview(false)}
                  className={cn("rounded p-1.5", !preview ? "bg-accent" : "text-muted-foreground")}
                  title="Edit"
                >
                  {preview ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => setPreview(true)}
                  className={cn("rounded p-1.5", preview ? "bg-accent" : "text-muted-foreground")}
                  title="Preview"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => {
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  void persist({ title: title || "Untitled", content });
                }}
              >
                <Check className="h-3 w-3" /> Save
              </Button>
            </div>
            {preview ? (
              <div
                className="flex-1 overflow-y-auto px-4 py-5 text-sm [&_a]:text-blue-500 [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_h4]:text-base [&_h5]:text-sm [&_h6]:text-sm [&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 sm:px-6"
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-muted-foreground">Nothing to preview yet.</p>' }}
              />
            ) : (
              <Textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  scheduleSave();
                }}
                placeholder={
                  "Start writing…\n\n# Heading\n## Subheading\n- bullet point\n**bold** and `code` and [link](https://example.com)"
                }
                className="min-h-0 flex-1 resize-none border-none px-6 py-5 text-sm shadow-none focus-visible:ring-0"
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsInner />
    </Suspense>
  );
}
