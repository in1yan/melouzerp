import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { GridBackground } from "@/components/shared/grid-background";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#213183] text-white">
      <div className="absolute inset-0">
        <GridBackground />
        <div className="absolute inset-0 bg-[#101535]/40" />
      </div>
      <header className="relative z-10 flex items-center justify-between border-b border-white/20 px-6 py-4">
        <span className="text-sm font-semibold tracking-tight">Melouz OS</span>
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm" className="bg-white text-[#213183] hover:bg-white/90">Get started</Button>
          </Link>
        </nav>
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <div className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs text-white/85 backdrop-blur-sm">
          One workspace for focused teams
        </div>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Your team&apos;s work, in one operating system
        </h1>
        <p className="max-w-xl text-lg text-white/80">
          Workspaces, projects, issues, Kanban boards, documents, calendars and teams —
          a Notion-meets-Plane workspace that runs locally.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/signup">
            <Button size="lg" className="bg-white text-[#213183] hover:bg-white/90">Create your workspace</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white">Sign in</Button>
          </Link>
        </div>
      </main>
      <footer className="relative z-10 border-t border-white/20 px-6 py-4 text-center text-xs text-white/65">
        Melouz OS · team operations, simplified
      </footer>
    </div>
  );
}
