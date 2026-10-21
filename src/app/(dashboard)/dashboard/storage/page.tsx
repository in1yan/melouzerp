"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Database, FileStack, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "sonner";

interface CollectionStat {
  name: string;
  count: number;
  bytes: number;
}

interface AttachmentRow {
  id: string;
  assignment_id: string;
  filename: string;
  size: number;
  content_type: string;
  uploaded_at: string;
  stored: string;
}

interface StorageSummary {
  mode: "mongodb";
  db_bytes: number;
  collections: CollectionStat[];
  attachments: {
    count: number;
    inline_bytes: number;
    file_count: number;
    file_bytes: number;
    orphan_count: number;
    orphans: { id: string; filename: string; size: number; uploaded_at: string }[];
    recent: AttachmentRow[];
  };
  hygiene: {
    sessions: number;
    expired_sessions: number;
    login_attempts: number;
    rejected_users: number;
    pending_users: number;
    activities: number;
    notifications: number;
  };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type PurgeAction =
  | "purge_expired_sessions"
  | "clear_login_attempts"
  | "clear_activities"
  | "clear_notifications"
  | "purge_rejected_users"
  | "purge_pending_users"
  | "purge_orphan_attachments";

const PURGE_BUTTONS: { action: PurgeAction; label: string; desc: string; confirm: string }[] = [
  {
    action: "purge_expired_sessions",
    label: "Expired sessions",
    desc: "Remove sessions that already expired.",
    confirm: "Remove all expired sessions?",
  },
  {
    action: "clear_login_attempts",
    label: "Login attempt log",
    desc: "Clear failed-attempt counters and any active lockouts.",
    confirm: "Clear the login attempt log and lockouts?",
  },
  {
    action: "clear_activities",
    label: "Activity history",
    desc: "Delete the activity feed (all workspaces).",
    confirm: "Delete the entire activity history?",
  },
  {
    action: "clear_notifications",
    label: "Notifications",
    desc: "Delete every notification for every user.",
    confirm: "Delete all notifications?",
  },
  {
    action: "purge_rejected_users",
    label: "Rejected users",
    desc: "Delete accounts whose access request was declined.",
    confirm: "Delete all rejected accounts?",
  },
  {
    action: "purge_pending_users",
    label: "Pending users (30+ days)",
    desc: "Delete access requests still pending after 30 days.",
    confirm: "Delete pending requests older than 30 days?",
  },
  {
    action: "purge_orphan_attachments",
    label: "Orphaned files",
    desc: "Delete uploaded files whose assignment was deleted.",
    confirm: "Delete all orphaned uploaded files?",
  },
];

export default function StoragePage() {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await api<StorageSummary>("/api/admin/storage"));
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not load storage info");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<StorageSummary>("/api/admin/storage")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled)
          toast.error(err instanceof ApiClientError ? err.message : "Could not load storage info");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  const runPurge = async (action: PurgeAction, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    setBusy(action);
    try {
      const res = await api<{ removed?: number; attachments_removed?: number }>(
        "/api/admin/storage",
        { method: "DELETE", body: { action } }
      );
      const removed = res.attachments_removed ?? res.removed ?? 0;
      toast.success(`Done — removed ${removed} item(s)`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Cleanup failed");
    } finally {
      setBusy(null);
    }
  };

  const deleteAttachment = async (att: AttachmentRow) => {
    if (!window.confirm(`Delete file "${att.filename}"? This cannot be undone.`)) return;
    setBusy(att.id);
    try {
      await api("/api/admin/storage", {
        method: "DELETE",
        body: { action: "delete_attachment", attachment_id: att.id },
      });
      toast.success(`Deleted "${att.filename}"`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not delete file");
    } finally {
      setBusy(null);
    }
  };

  const totalStoredBytes =
    summary ? summary.db_bytes + summary.attachments.file_bytes + summary.attachments.inline_bytes : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <HardDrive className="h-5 w-5" /> Storage management
          </h1>
          <p className="text-sm text-muted-foreground">
            Inspect and clean up what this deployment stores. Keep usage small — hosting plans are limited.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
      </div>

      {loading && !summary && <p className="text-sm text-muted-foreground">Loading…</p>}

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Panel
              icon={<Database className="h-4 w-4" />}
              title="Database"
              value={fmtBytes(summary.db_bytes)}
              sub={`${summary.mode === "mongodb" ? "MongoDB" : "Database"} · document store`}
            />
            <Panel
              icon={<FileStack className="h-4 w-4" />}
              title="Uploaded files"
              value={fmtBytes(summary.attachments.file_bytes + summary.attachments.inline_bytes)}
              sub={`${summary.attachments.count} file(s)`}
            />
            <Panel
              icon={<HardDrive className="h-4 w-4" />}
              title="Total used"
              value={fmtBytes(totalStoredBytes)}
              sub="Database + files"
            />
          </div>

          <section className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-sm font-medium">Data by collection</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Collection</th>
                  <th className="px-4 py-2 font-medium">Records</th>
                  <th className="px-4 py-2 text-right font-medium">Approx. size</th>
                </tr>
              </thead>
              <tbody>
                {summary.collections.map((c) => (
                  <tr key={c.name} className="border-t">
                    <td className="px-4 py-1.5 font-mono text-xs">{c.name}</td>
                    <td className="px-4 py-1.5">{c.count}</td>
                    <td className="px-4 py-1.5 text-right">{fmtBytes(c.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>

          <section className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-sm font-medium">Cleanup actions</div>
            <div className="divide-y">
              {PURGE_BUTTONS.map((b) => (
                <div key={b.action} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div>
                    <div className="text-sm font-medium">{b.label}</div>
                    <div className="text-xs text-muted-foreground">{b.desc}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 text-xs"
                    disabled={busy !== null}
                    onClick={() => runPurge(b.action, b.confirm)}
                  >
                    <Trash2 className="h-3 w-3" />
                    {busy === b.action ? "Working…" : "Clean up"}
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-medium">
                Uploaded files ({summary.attachments.count})
              </span>
              {summary.attachments.orphan_count > 0 && (
                <span className="text-xs text-amber-600">
                  {summary.attachments.orphan_count} orphaned
                </span>
              )}
            </div>
            {summary.attachments.recent.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No files stored.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">File</th>
                      <th className="px-4 py-2 font-medium">Size</th>
                      <th className="px-4 py-2 font-medium">Stored</th>
                      <th className="px-4 py-2 font-medium">Uploaded</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {summary.attachments.recent.map((att) => (
                      <tr key={att.id} className="border-t">
                        <td className="max-w-[240px] truncate px-4 py-1.5">{att.filename}</td>
                        <td className="px-4 py-1.5">{fmtBytes(att.size)}</td>
                        <td className="px-4 py-1.5 text-xs text-muted-foreground">{att.stored}</td>
                        <td className="px-4 py-1.5 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(att.uploaded_at), { addSuffix: true })}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            disabled={busy !== null}
                            title="Delete file"
                            onClick={() => deleteAttachment(att)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )}
          </section>

          <section className="rounded-lg border px-4 py-3">
            <div className="text-sm font-medium">Hygiene</div>
            <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>Active sessions: {summary.hygiene.sessions}</span>
              <span>Expired sessions: {summary.hygiene.expired_sessions}</span>
              <span>Tracked login attempts: {summary.hygiene.login_attempts}</span>
              <span>Rejected accounts: {summary.hygiene.rejected_users}</span>
              <span>Pending access requests: {summary.hygiene.pending_users}</span>
              <span>Activities: {summary.hygiene.activities}</span>
              <span>Notifications: {summary.hygiene.notifications}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Panel({
  icon,
  title,
  value,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {title}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
