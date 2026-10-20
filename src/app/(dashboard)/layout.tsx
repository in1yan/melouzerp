import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser, getUserWorkspaces } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { AppShell } from "@/components/layout/app-shell";
import { PendingApproval } from "@/components/shared/pending-approval";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  ensureBootstrap();
  const jar = await cookies();
  const user = await getSessionUser();
  if (!user) {
    // Session cookie present but stale/invalid. Redirect with a flag so the proxy
    // clears the cookie and lets /login render, otherwise /login -> /dashboard loops.
    redirect("/login?stale=1");
  }
  if (user.approval_status === "pending") {
    return <PendingApproval user={user} />;
  }
  if (user.approval_status === "rejected") {
    return <PendingApproval user={user} rejected />;
  }
  const workspaces = getUserWorkspaces(user.id);
  const activeCookie = jar.get("melouz.activeWorkspace")?.value;
  const initialActiveId =
    activeCookie && workspaces.some((w) => w.id === activeCookie)
      ? activeCookie
      : (workspaces[0]?.id ?? null);
  return (
    <AppShell user={user} workspaces={workspaces} initialActiveId={initialActiveId}>
      {children}
    </AppShell>
  );
}
