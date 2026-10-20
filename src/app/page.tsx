import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">Melouz OS</span>
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Runs fully on localhost · no external services required
        </div>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Your team&apos;s work, in one operating system
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Workspaces, projects, issues, Kanban boards, documents, calendars and teams —
          a Notion-meets-Plane workspace that runs locally.
        </p>
        <div className="flex gap-3">
          <Link href="/signup">
            <Button size="lg">Create your workspace</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">Sign in</Button>
          </Link>
        </div>
      </main>
      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        Melouz OS · local-first ERP
      </footer>
    </div>
  );
}
