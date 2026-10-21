"use client";

import { Blobatar } from "@blobatar/react";
import { useGaze } from "@blobatar/react/gaze";
import "blobatar/motion.css";
import "blobatar/gaze.css";
import { cn } from "@/lib/utils";
import type { IssueStatus, Priority } from "@/lib/types";

export { Blobatar };

export const STATUS_META: Record<IssueStatus, { label: string; dot: string; badge: string }> = {
  backlog: { label: "Backlog", dot: "bg-slate-400", badge: "bg-slate-400/15 text-slate-600 dark:text-slate-300" },
  todo: { label: "Todo", dot: "bg-blue-500", badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  in_progress: { label: "In progress", dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  review: { label: "Review", dot: "bg-violet-500", badge: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  done: { label: "Done", dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "text-red-600 dark:text-red-400" },
  high: { label: "High", className: "text-orange-600 dark:text-orange-400" },
  medium: { label: "Medium", className: "text-amber-600 dark:text-amber-400" },
  low: { label: "Low", className: "text-sky-600 dark:text-sky-400" },
  none: { label: "None", className: "text-muted-foreground" },
};

export function StatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.backlog;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        meta.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function PriorityIndicator({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.none;
  const bars = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 }[priority] ?? 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.className)} title={meta.label}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn(
              "w-[3px] rounded-sm",
              n <= bars ? "bg-current" : "bg-current opacity-20",
              n === 1 && "h-1.5",
              n === 2 && "h-2",
              n === 3 && "h-2.5",
              n === 4 && "h-3"
            )}
          />
        ))}
      </span>
      {withLabel && meta.label}
    </span>
  );
}

export function Avatar({
  name,
  size = "md",
  className,
  background,
}: {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  background?: boolean | "circle" | "square" | "squircle";
}) {
  const sizeCls = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-10 w-10" : "h-7 w-7";
  const cleanName = typeof name === "string" ? name.trim() : "";
  const seed = cleanName && cleanName !== "?" ? cleanName : "user";
  const title = cleanName && cleanName !== "?" ? cleanName : undefined;
  const { ref } = useGaze({ travel: 6, lookAt: "pointer" });

  return (
    <Blobatar
      ref={ref}
      name={seed}
      animate="always"
      background={background}
      className={cn("inline-block shrink-0 select-none", sizeCls, className)}
      title={title}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center", className)}>
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="max-w-sm text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
