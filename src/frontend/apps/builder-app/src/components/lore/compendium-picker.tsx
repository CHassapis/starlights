/**
 * Choosing something from the Compendium of Lore for a campaign: any entry, a place or section in a book or
 * adventure, a creature, or a map printed in the books. The lists load when the picker first opens.
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpenIcon, EyeIcon, EyeOffIcon, MapIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CATEGORY_BY_ID } from "@/lib/lore/categories";
import { imageUrl, LORE_BASE, useLoreMeta } from "@/lib/lore/data";
import { matchScore } from "@/lib/lore/search";
import { cn } from "@/lib/utils";
import type { CompendiumLink } from "@/lib/lore/campaign-links";
import { LoreLink } from "./lore-link";

export interface PickedMap {
  title: string;
  url: string;
  playerUrl: string | null;
  link: CompendiumLink;
}

type Mode = "everything" | "creatures" | "maps";
type Hit = [string, string, string, string];
type Section = [string, "books" | "adventures", string, number, string, string];
type MapRow = [string, "books" | "adventures", string, number, string, string, string];

interface Result {
  label: string;
  detail: string;
  score: number;
  link: CompendiumLink;
  map?: MapRow;
}

const get = async <T,>(url: string) => (await (await fetch(url)).json()) as T;

export function CompendiumPicker({
  open,
  onOpenChange,
  mode,
  onPick,
  onPickMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  onPick?: (link: CompendiumLink) => void;
  onPickMap?: (map: PickedMap) => void;
}) {
  const meta = useLoreMeta();
  const version = meta.data?.version;
  const [query, setQuery] = useState("");
  const entries = useQuery({ queryKey: ["lore", version, "search"], queryFn: () => get<Hit[]>(`${LORE_BASE}/${version}/search.json`), enabled: open && !!version && mode !== "maps", staleTime: Infinity });
  const sections = useQuery({ queryKey: ["lore", version, "sections"], queryFn: () => get<Section[]>(`${LORE_BASE}/${version}/sections.json`), enabled: open && !!version && mode === "everything", staleTime: Infinity });
  const maps = useQuery({ queryKey: ["lore", version, "maps"], queryFn: () => get<MapRow[]>(`${LORE_BASE}/${version}/maps.json`), enabled: open && !!version && mode === "maps", staleTime: Infinity });

  const results = useMemo(() => {
    if (query.trim().length < 2) return [];
    const out: Result[] = [];
    if (mode !== "maps") {
      for (const [name, category, key, src] of entries.data ?? []) {
        if (mode === "creatures" && category !== "bestiary") continue;
        const score = matchScore(name, query);
        if (score > 0) out.push({ label: name, detail: `${CATEGORY_BY_ID[category]?.singular ?? category} · ${meta.data?.sources[src]?.short ?? src}`, score: score - name.length / 1000, link: { category, key, name } });
      }
    }
    if (mode === "everything") {
      for (const [name, kind, key, ch, anchor, book] of sections.data ?? []) {
        const score = matchScore(name, query);
        if (score > 0) out.push({ label: name, detail: `in ${book}`, score: score - 0.5 - name.length / 1000, link: { category: kind, key, name: `${name} (${book})`, ch, anchor } });
      }
    }
    if (mode === "maps") {
      for (const m of maps.data ?? []) {
        const score = Math.max(matchScore(m[0], query), matchScore(`${m[0]} ${m[6]}`, query) - 0.3, matchScore(m[6], query) - 0.5);
        if (score > 0) out.push({ label: m[0], detail: m[6], score, link: { category: m[1], key: m[2], name: `${m[0]} (${m[6]})`, ch: m[3] }, map: m });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [query, mode, entries.data, sections.data, maps.data, meta.data]);

  const loading = entries.isLoading || sections.isLoading || maps.isLoading;
  const pick = (r: Result) => {
    if (r.map && onPickMap && meta.data) {
      onPickMap({ title: r.label, url: imageUrl(meta.data, { type: "internal", path: r.map[4] })!, playerUrl: r.map[5] ? imageUrl(meta.data, { type: "internal", path: r.map[5] }) : null, link: r.link });
    } else onPick?.(r.link);
    setQuery("");
    onOpenChange(false);
  };
  const title = mode === "maps" ? "A map from the books" : mode === "creatures" ? "A creature from the bestiary" : "Link from the Compendium";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-2 p-3">
        <DialogHeader className="px-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "maps" ? "Every map printed in the books and adventures (with the players' version where there is one)." : mode === "creatures" ? "Its name, type, picture and a link to its stat block." : "A creature, item, spell, place in an adventure, anything: players get a preview card once you reveal the entry."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input autoFocus className="pl-8" placeholder="Type a name" aria-label="Search the compendium" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {loading ? (
            <Spinner className="mx-auto my-4 size-5" />
          ) : meta.error ? (
            <p className="p-2 text-sm text-muted-foreground">The compendium is not set up on this server.</p>
          ) : query.trim().length < 2 ? (
            <p className="p-2 text-sm text-muted-foreground">Type at least two letters.</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Nothing found.</p>
          ) : (
            results.map((r, i) => (
              <button key={i} type="button" onClick={() => pick(r)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted">
                {r.map && meta.data ? <img src={imageUrl(meta.data, { type: "internal", path: r.map[5] || r.map[4] })!} alt="" loading="lazy" className="size-10 shrink-0 rounded object-cover" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sectionHref(l: CompendiumLink): string {
  return `/lore/${l.category}/${l.key}${l.ch != null ? `?ch=${l.ch}` : ""}${l.anchor ? `#e-${l.anchor}` : ""}`;
}

/** A campaign entry's links into the compendium, as chips (with previews for entries). */
/**
 * An entry's links as chips. A DM-only link (the stat block behind an alias) has a crossed eye; with onToggleDmOnly
 * the DM can switch that on and off. Players never get DM-only links: the server leaves them out.
 */
export function CompendiumLinks({
  links,
  onRemove,
  onToggleDmOnly,
  className,
}: {
  links: CompendiumLink[];
  onRemove?: (link: CompendiumLink) => void;
  onToggleDmOnly?: (link: CompendiumLink) => void;
  className?: string;
}) {
  if (!links.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5 text-xs", className)}>
      {links.map((l, i) => (
        <li key={i} className={cn("inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5", l.dmOnly && "border-dashed border-amber-500/60")}>
          {l.dmOnly && !onToggleDmOnly && <EyeOffIcon className="size-3 text-amber-600 dark:text-amber-400" aria-label="Only the DM sees this link" />}
          {l.category === "books" || l.category === "adventures" ? (
            <Link to={sectionHref(l)} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
              {l.ch != null && l.anchor == null ? <MapIcon className="size-3" /> : <BookOpenIcon className="size-3" />}
              {l.name}
            </Link>
          ) : (
            <LoreLink category={l.category} k={l.key}>
              {l.name}
            </LoreLink>
          )}
          {onToggleDmOnly && (
            <button
              type="button"
              className={cn("hover:text-foreground", l.dmOnly ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
              aria-pressed={!!l.dmOnly}
              aria-label={l.dmOnly ? `Show the link to ${l.name} to players` : `Keep the link to ${l.name} for the DM only`}
              title={l.dmOnly ? "Only the DM sees this link. Click to show it to players." : "Players see this link once the entry is revealed. Click to keep it for the DM only."}
              onClick={() => onToggleDmOnly(l)}
            >
              {l.dmOnly ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
            </button>
          )}
          {onRemove && (
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove the link to ${l.name}`} onClick={() => onRemove(l)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
