/**
 * Around every compendium page: the search across everything (Ctrl+K, or the search button), which loads its
 * index the first time it opens. Results skip the books hidden in "my books".
 */
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CATEGORY_BY_ID } from "@/lib/lore/categories";
import { LORE_BASE, useLoreMeta } from "@/lib/lore/data";
import { matchScore } from "@/lib/lore/search";
import { cn } from "@/lib/utils";
import { useHiddenSources } from "./lore-storage";

type Hit = [string, string, string, string];

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const meta = useLoreMeta();
  const hidden = useHiddenSources();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const index = useQuery({
    queryKey: ["lore", meta.data?.version, "search"],
    queryFn: async () => (await (await fetch(`${LORE_BASE}/${meta.data!.version}/search.json`)).json()) as Hit[],
    enabled: open && !!meta.data,
    staleTime: Infinity,
  });
  const results = useMemo(() => {
    if (!index.data || query.trim().length < 2) return [];
    const scored: { hit: Hit; score: number }[] = [];
    for (const hit of index.data) {
      if (hidden.includes(hit[3])) continue;
      const score = matchScore(hit[0], query);
      // among equal matches, shorter names (closer to what was typed) and books first
      if (score > 0) scored.push({ hit, score: score + (hit[1] === "books" || hit[1] === "adventures" ? 0.1 : 0) - hit[0].length / 1000 });
    }
    scored.sort((a, b) => b.score - a.score || a.hit[0].localeCompare(b.hit[0]));
    return scored.slice(0, 60).map((s) => s.hit);
  }, [index.data, query, hidden]);
  const go = (hit: Hit) => {
    onOpenChange(false);
    setQuery("");
    navigate(`/lore/${hit[1]}/${hit[2]}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10vh] max-w-xl translate-y-0 gap-2 p-3">
        <DialogHeader className="sr-only">
          <DialogTitle>Search the compendium</DialogTitle>
          <DialogDescription>Spells, creatures, items, rules, books and everything else.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search everything: spells, creatures, items, books…"
            aria-label="Search everything"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(results.length - 1, h + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter" && results[highlight]) go(results[highlight]);
            }}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto" role="listbox" aria-label="Results">
          {index.isLoading ? (
            <Spinner className="mx-auto my-4 size-5" />
          ) : query.trim().length < 2 ? (
            <p className="p-2 text-sm text-muted-foreground">Type a name. ↑ ↓ to move, Enter to open.</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nothing found.</p>
          ) : (
            results.map((hit, i) => (
              <button
                key={`${hit[1]}/${hit[2]}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(hit)}
                className={cn("flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left", i === highlight ? "bg-muted" : "")}
              >
                <span className="truncate font-medium">{hit[0]}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {CATEGORY_BY_ID[hit[1]]?.singular ?? hit[1]} · {meta.data?.sources[hit[3]]?.short ?? hit[3]}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LoreShell() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <Outlet />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border bg-background/90 px-4 py-2 text-sm shadow-lg backdrop-blur hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring print:hidden"
        aria-label="Search the whole compendium (Ctrl K)"
      >
        <SearchIcon className="size-4" />
        <span className="hidden sm:inline">Search everything</span>
        <kbd className="hidden rounded border px-1 text-[10px] text-muted-foreground sm:inline">Ctrl K</kbd>
      </button>
      <Palette open={open} onOpenChange={setOpen} />
    </>
  );
}
