"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api } from "@/lib/client";

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchResponse {
  projects: SearchResult[];
  issues: SearchResult[];
  documents: SearchResult[];
}

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Projects", href: "/dashboard/projects" },
  { label: "Issues", href: "/dashboard/issues" },
  { label: "Board", href: "/dashboard/kanban" },
  { label: "Calendar", href: "/dashboard/calendar" },
  { label: "Documents", href: "/dashboard/documents" },
  { label: "Teams", href: "/dashboard/teams" },
  { label: "Workspaces", href: "/dashboard/workspaces" },
  { label: "Settings", href: "/dashboard/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openEvent = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("melouz:open-search", openEvent);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("melouz:open-search", openEvent);
    };
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults(null);
      return;
    }
    try {
      const data = await api<SearchResponse>(`/api/search?q=${encodeURIComponent(q.trim())}`);
      setResults(data);
    } catch {
      setResults({ projects: [], issues: [], documents: [] });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 180);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const hasResults = results && (results.projects.length || results.issues.length || results.documents.length);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search issues, projects, documents… or jump to a page"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{query ? "No results found." : "Type to search, or pick a page below."}</CommandEmpty>
        {hasResults ? (
          <>
            {results.issues.length > 0 && (
              <CommandGroup heading="Issues">
                {results.issues.map((r) => (
                  <CommandItem key={`i-${r.id}`} onSelect={() => go(r.href)}>
                    <span className="text-muted-foreground">{r.subtitle}</span>
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.projects.length > 0 && (
              <CommandGroup heading="Projects">
                {results.projects.map((r) => (
                  <CommandItem key={`p-${r.id}`} onSelect={() => go(r.href)}>
                    <span className="text-muted-foreground">{r.subtitle}</span>
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.documents.length > 0 && (
              <CommandGroup heading="Documents">
                {results.documents.map((r) => (
                  <CommandItem key={`d-${r.id}`} onSelect={() => go(r.href)}>
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <CommandGroup heading="Go to">
            {NAV_ITEMS.map((item) => (
              <CommandItem key={item.href} onSelect={() => go(item.href)}>
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {hasResults && (
          <CommandGroup heading="Go to">
            {NAV_ITEMS.map((item) => (
              <CommandItem key={item.href} onSelect={() => go(item.href)}>
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
