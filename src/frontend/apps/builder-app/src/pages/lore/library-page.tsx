/** The books or the adventures: covers to open in the reader, with a search box and edition and kind filters. */
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CATEGORY_BY_ID } from "@/lib/lore/categories";
import { imageUrl, LoreMissingError, useCategoryIndex, useLoreMeta } from "@/lib/lore/data";
import { matchScore } from "@/lib/lore/search";
import type { BookRow } from "@/lib/lore/types";
import { cn } from "@/lib/utils";
import { LoreMissing } from "./lore-missing";
import { useHiddenSources } from "./lore-storage";

const GROUPS: Record<string, string> = { core: "Core rules", supplement: "Supplements", setting: "Settings", "supplement-alt": "Other supplements", "homebrew": "Homebrew", screen: "DM screens", other: "Other", organized: "Organized play", prerelease: "Playtest" };

function Cover({ path, name }: { path?: string; name: string }) {
  const meta = useLoreMeta();
  const [failed, setFailed] = useState(false);
  const url = path ? imageUrl(meta.data, { type: "internal", path }) : null;
  if (!url || failed) return <div className="flex aspect-[3/4] items-center justify-center rounded-md bg-muted p-2 text-center font-heading text-sm text-muted-foreground">{name}</div>;
  return <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="aspect-[3/4] w-full rounded-md object-cover shadow-sm" />;
}

export function LibraryPage({ kind }: { kind: "books" | "adventures" }) {
  const meta = useLoreMeta();
  const index = useCategoryIndex<BookRow>(meta.data, kind);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const ed = params.get("ed") ?? "";
  const group = params.get("group") ?? "";
  const hidden = useHiddenSources();
  const rows = useMemo(() => (index.data?.rows ?? []).filter((r) => !hidden.includes(r.src)), [index.data, hidden]);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group))], [rows]);
  const shown = useMemo(() => rows.filter((r) => (!ed || r.ed === ed) && (!group || r.group === group) && matchScore(`${r.name} ${r.src} ${r.storyline ?? ""}`, query) > 0), [rows, ed, group, query]);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  if (meta.error instanceof LoreMissingError) return <LoreMissing />;
  if (!meta.data || index.isLoading) return <Spinner className="mx-auto my-16 size-6" />;
  const info = CATEGORY_BY_ID[kind];
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted");
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/lore" className="hover:text-foreground">
          Compendium of Lore
        </Link>
        <span>/</span>
        <span className="text-foreground">{info.label}</span>
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="font-heading text-3xl tracking-wide">{info.label}</h1>
        <div className="relative sm:ml-auto sm:w-72">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={`Search ${info.label.toLowerCase()}`} aria-label={`Search ${info.label.toLowerCase()}`} value={query} onChange={(e) => set("q", e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filters">
        {["", "2024", "2014"].map((v) => (
          <button key={`ed${v}`} type="button" aria-pressed={ed === v} className={chip(ed === v)} onClick={() => set("ed", v)}>
            {v ? `${v} rules` : "Both editions"}
          </button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {["", ...groups].map((g) => (
          <button key={`g${g}`} type="button" aria-pressed={group === g} className={chip(group === g)} onClick={() => set("group", g)}>
            {g ? (GROUPS[g] ?? g) : "All kinds"}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{shown.length} of {rows.length}</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {shown.map((r) => (
          <li key={r.k}>
            <Link to={`/lore/${kind}/${r.k}`} className="group block space-y-1.5 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
              <Cover path={r.cover} name={r.name} />
              <span className="block text-sm font-medium leading-tight group-hover:text-primary">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[r.published?.slice(0, 4), r.level ? (/^(\d+)–\1$/.test(r.level) ? `level ${r.level.split("–")[0]}` : `levels ${r.level}`) : "", r.ed === "2024" ? "2024" : ""].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BooksPage() {
  return <LibraryPage kind="books" />;
}

export function AdventuresPage() {
  return <LibraryPage kind="adventures" />;
}
