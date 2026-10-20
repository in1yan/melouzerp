"use client";

import { useRouter } from "next/navigation";
import { Clock, LogOut, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import type { User } from "@/lib/types";

export function PendingApproval({ user, rejected = false }: { user: User; rejected?: boolean }) {
  const router = useRouter();

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // best effort
    }
    router.push("/login");
    router.refresh();
  };

  const refresh = () => {
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-8 text-center shadow-sm">
        <div
          className={
            "mx-auto flex h-12 w-12 items-center justify-center rounded-full " +
            (rejected ? "bg-destructive/15" : "bg-amber-500/15")
          }
        >
          {rejected ? (
            <XCircle className="h-6 w-6 text-destructive" />
          ) : (
            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {rejected ? "Access declined" : "Awaiting approval"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rejected ? (
              <>
                Hi {user.name}, your request to join as a{" "}
                <span className="font-medium capitalize text-foreground">{user.requested_role}</span>{" "}
                was declined by an administrator.
              </>
            ) : (
              <>
                Thanks for signing up, {user.name}. Your request to join as a{" "}
                <span className="font-medium capitalize text-foreground">{user.requested_role}</span>{" "}
                is pending review by an administrator.
              </>
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
          <p>
            Requested role:{" "}
            <span className="font-medium capitalize text-foreground">{user.requested_role}</span>
          </p>
          <p className="truncate">
            Email: <span className="text-foreground">{user.email}</span>
          </p>
          {rejected && user.rejection_reason && (
            <p className="mt-1">
              Reason: <span className="text-foreground">{user.rejection_reason}</span>
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {rejected
            ? "Contact an administrator if you believe this is a mistake."
            : "You'll get access as soon as an admin approves you. Check back and refresh."}
        </p>
        <div className="flex justify-center gap-2">
          {!rejected && (
            <Button size="sm" onClick={refresh}>
              Refresh status
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
