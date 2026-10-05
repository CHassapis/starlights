/** The Compendium of Lore's front page: its categories with their sizes, and what you pinned and opened lately. */
import { BookOpenIcon, BookMarkedIcon, ClockIcon, ColumnsIcon, PinIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LoreMeta } from "@/lib/lore/types";
import { Link } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { LORE_BACKGROUND } from "@/lib/art";
import { CATEGORIES, CATEGORY_BY_ID } from "@/lib/lore/categories";
import { LoreMissingError, useLoreMeta } from "@/lib/lore/data";
import { LoreMissing } from "./lore-missing";
import { setHiddenSources, useHiddenSources, usePins, useRecent, type EntryRef } from "./lore-storage";

function RefList({ title, icon, refs }: { title: string; icon: ReactNode; refs: EntryRef[] }) {
  if (refs.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-heading text-lg tracking-wide">
        {icon} {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {refs.slice(0, 16).map((r) => (
          <li key={`${r.category}/${r.key}`}>
            <Link to={`/lore/${r.category}/${r.key}`} className="inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-muted">
              {r.name}
              <span className="text-xs text-muted-foreground">{CATEGORY_BY_ID[r.category]?.singular}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "My books": the books to leave out of every list and search (kept in this browser, per player). */
function MyBooks({ meta, open, onOpenChange }: { meta: LoreMeta; open: boolean; onOpenChange: (o: boolean) => void }) {
  const hidden = useHiddenSources();
  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of Object.values(meta.categories)) for (const [src, n] of Object.entries(c.sources)) counts.set(src, (counts.get(src) ?? 0) + n);
    return [...counts.keys()].map((s) => meta.sources[s] ?? { abbr: s, name: s, edition: "2014", date: null }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [meta]);
  const toggle = (abbr: string) => setHiddenSources(hidden.includes(abbr) ? hidden.filter((h) => h !== abbr) : [...hidden, abbr]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>My books</DialogTitle>
          <DialogDescription>Untick the books you don't use: they are left out of every list and of search. Kept in this browser, for whoever is playing on it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setHiddenSources([])}>Use all</Button>
          <Button size="sm" variant="outline" onClick={() => setHiddenSources(used.filter((s) => s.edition === "2014").map((s) => s.abbr))}>Only 2024 books</Button>
          <Button size="sm" variant="outline" onClick={() => setHiddenSources(used.filter((s) => s.edition === "2024").map((s) => s.abbr))}>Only 2014 books</Button>
        </div>
        {(["2024", "2014"] as const).map((ed) => (
          <fieldset key={ed} className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{ed} rules</legend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {used.filter((s) => s.edition === ed).map((s) => (
                <label key={s.abbr} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={!hidden.includes(s.abbr)} onChange={() => toggle(s.abbr)} />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </DialogContent>
    </Dialog>
  );
}

export function LoreHome() {
  const [booksOpen, setBooksOpen] = useState(false);
  const hiddenCount = useHiddenSources().length;
  const meta = useLoreMeta();
  const pins = usePins();
  const recent = useRecent();
  if (meta.error instanceof LoreMissingError) return <LoreMissing />;
  if (meta.error) return <p className="p-8 text-center text-destructive">The compendium could not be loaded: {meta.error.message}</p>;
  if (!meta.data) return <Spinner className="mx-auto my-16 size-6" />;
  const built = CATEGORIES.filter((c) => meta.data.categories[c.id]);
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="relative isolate overflow-hidden rounded-2xl border bg-neutral-950 px-5 py-10 text-white shadow-lg sm:px-8 sm:py-14">
        <img src={LORE_BACKGROUND} alt="" aria-hidden className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_35%] opacity-70" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/85 via-black/55 to-black/10" />
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-200/80">The great library</p>
        <h1 className="mt-1 font-heading text-3xl tracking-wide drop-shadow sm:text-5xl">Compendium of Lore</h1>
        <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-base">Rules, creatures, items and the books themselves. Search a list, or point at any link in the text for a preview.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setBooksOpen(true)}>
          <BookMarkedIcon /> My books{hiddenCount ? ` (${hiddenCount} hidden)` : ""}
        </Button>
        {pins.filter((p) => p.category !== "books" && p.category !== "adventures").length >= 2 && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/lore/compare">
              <ColumnsIcon /> Compare pinned
            </Link>
          </Button>
        )}
      </div>
      <MyBooks meta={meta.data} open={booksOpen} onOpenChange={setBooksOpen} />
      <RefList title="Pinned" icon={<PinIcon className="size-4" />} refs={pins} />
      <RefList title="Recently opened" icon={<ClockIcon className="size-4" />} refs={recent} />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {built.map((c) => (
          <Link key={c.id} to={`/lore/${c.id}`} className="group rounded-lg border bg-background/60 p-4 transition-colors hover:border-primary/50 hover:bg-muted/40 motion-reduce:transition-none">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-heading text-lg tracking-wide group-hover:text-primary">{c.label}</span>
              <span className="text-sm text-muted-foreground">{meta.data.categories[c.id].count.toLocaleString()}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
          </Link>
        ))}
      </section>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BookOpenIcon className="size-3.5" /> Data: 5etools {meta.data.version.split("-")[0]}, built {new Date(meta.data.built).toLocaleDateString()}. The character builder's own options are in{" "}
        <Link to="/compendium" className="underline underline-offset-2">
          the Aurora compendium
        </Link>
        .
      </p>
    </div>
  );
}
