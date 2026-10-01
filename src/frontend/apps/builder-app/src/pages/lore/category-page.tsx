/**
 * A category of the Compendium of Lore: search box, filters, the list (only the visible rows are drawn) and the
 * open entry beside it, or on its own page on a phone. Everything is in the address (search, filters, sort and the
 * open entry), so a link shows the same thing. Keys: "/" to search, ↑ ↓ to move, Enter to open, Esc to clear.
 */
import { ArrowLeftIcon, ChevronDownIcon, FilterIcon, LibraryBigIcon, PrinterIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { EntryView } from "@/components/lore/entry-view";
import { VirtualList } from "@/components/lore/virtual-list";
import { CATEGORY_BY_ID } from "@/lib/lore/categories";
import { LoreMissingError, redirectKey, useCategoryIndex, useLoreEntry, useLoreMeta } from "@/lib/lore/data";
import { commonFacets } from "@/lib/lore/facets";
import { keyFromParam } from "@/lib/lore/keys";
import { facetCounts, filterRows, selectionFromParams, selectionToParams, type Facet, type Selection } from "@/lib/lore/search";
import type { IndexRow, LoreMeta } from "@/lib/lore/types";
import { cn } from "@/lib/utils";
import { DEFAULT_CONFIG, LIST_CONFIG, type ListConfig } from "./list-config";
import { LoreMissing } from "./lore-missing";
import { rememberRecent } from "./lore-storage";

const ROW = 56;

export function CategoryPage() {
  const { category = "", key: keyParam } = useParams();
  const meta = useLoreMeta();
  const info = CATEGORY_BY_ID[category];

  if (meta.error instanceof LoreMissingError) return <LoreMissing />;
  if (meta.error) return <p className="p-8 text-center text-destructive">The compendium could not be loaded: {meta.error.message}</p>;
  if (!meta.data) return <Spinner className="mx-auto my-16 size-6" />;
  if (!info || !meta.data.categories[category]) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-muted-foreground">There is no “{category}” in this build of the compendium.</p>
        <Link to="/lore" className="mt-3 inline-block text-primary underline-offset-2 hover:underline">
          Back to the Compendium of Lore
        </Link>
      </div>
    );
  }
  return <CategoryList key={category} meta={meta.data} category={category} openKey={keyParam ? keyFromParam(keyParam) : null} />;
}

function CategoryList({ meta, category, openKey }: { meta: LoreMeta; category: string; openKey: string | null }) {
  const info = CATEGORY_BY_ID[category];
  const config = (LIST_CONFIG[category] ?? DEFAULT_CONFIG) as ListConfig<IndexRow>;
  const index = useCategoryIndex(meta, category);
  const rows = useMemo(() => index.data?.rows ?? [], [index.data]);
  const facets = useMemo(() => [...config.facets, ...commonFacets(meta, rows)], [config, meta, rows]);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get("q") ?? "";
  const selection = useMemo(() => selectionFromParams(params, facets), [params, facets]);
  const sort = config.sorts.find((s) => s.id === params.get("sort")) ?? config.sorts[0];
  const [highlight, setHighlight] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const found = filterRows(rows, query, facets, selection);
    return query.trim() && !params.get("sort") ? found : [...found].sort(sort.compare);
  }, [rows, query, facets, selection, sort, params]);

  // "/" anywhere on the page goes to the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const queryString = (p: URLSearchParams) => (p.toString() ? `?${p}` : "");
  const update = (next: URLSearchParams) => {
    setParams(next, { replace: true });
    setHighlight(0);
  };
  const setQuery = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    update(next);
  };
  const setSelection = (s: Selection) => update(selectionToParams(s, params));
  const open = (row: IndexRow) => navigate(`/lore/${category}/${row.k}${queryString(params)}`);
  const activeCount = Object.values(selection).reduce((n, v) => n + v.length, 0);

  const filterPanel = <FilterPanel rows={rows} query={query} facets={facets} selection={selection} onChange={setSelection} />;

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-4">
      <nav className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground print:hidden">
        <Link to="/lore" className="hover:text-foreground">
          Compendium of Lore
        </Link>
        <span>/</span>
        <Link to={`/lore/${category}${queryString(params)}`} className="text-foreground hover:underline">
          {info.label}
        </Link>
      </nav>

      <div className={cn("grid gap-4 md:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(17rem,24rem)_minmax(0,1fr)]")}>
        <aside className="hidden max-h-[calc(100dvh-9rem)] overflow-y-auto pr-1 xl:block print:hidden" aria-label="Filters">
          {filterPanel}
        </aside>

        <section className={cn("min-w-0 space-y-2 print:hidden", openKey && "hidden md:block")} aria-label={info.label}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                ref={search}
                className="pl-8"
                placeholder={`Search ${info.label.toLowerCase()} (press /)`}
                aria-label={`Search ${info.label.toLowerCase()}`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(results.length - 1, h + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(0, h - 1));
                  } else if (e.key === "Enter" && results[highlight]) {
                    open(results[highlight]);
                  } else if (e.key === "Escape") {
                    setQuery("");
                  }
                }}
              />
            </div>
            <Button variant="outline" className="xl:hidden" onClick={() => setFiltersOpen(true)} aria-label="Filters">
              <FilterIcon />
              {activeCount > 0 && <Badge className="h-5 px-1.5">{activeCount}</Badge>}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">
              {index.isLoading ? "Loading…" : `${results.length.toLocaleString()} of ${rows.length.toLocaleString()} ${results.length === 1 ? info.singular : info.label.toLowerCase()}`}
            </span>
            <label className="flex items-center gap-1">
              Sort
              <select
                className="rounded border bg-background px-1 py-0.5 text-xs text-foreground"
                value={params.get("sort") ?? ""}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  if (e.target.value) next.set("sort", e.target.value);
                  else next.delete("sort");
                  update(next);
                }}
              >
                <option value="">{query ? "Best match" : config.sorts[0].label}</option>
                {config.sorts.slice(query ? 0 : 1).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ActiveFilters facets={facets} selection={selection} onChange={setSelection} />
          {index.isLoading ? (
            <Spinner className="mx-auto my-8 size-6" />
          ) : index.error ? (
            <p className="text-sm text-destructive">The list could not be loaded: {index.error.message}</p>
          ) : (
            <VirtualList
              label={info.label}
              items={results}
              rowHeight={ROW}
              highlight={highlight}
              className="h-[calc(100dvh-14rem)] rounded-lg border bg-background/60"
              render={(row, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={row.k === openKey}
                  onClick={() => open(row)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex h-full w-full flex-col justify-center border-b px-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    row.k === openKey ? "bg-primary/10" : i === highlight ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title={meta.sources[row.src]?.name}>
                      {meta.sources[row.src]?.short ?? row.src}
                      {row.ed === "2014" && <span className="ml-1 opacity-70">’14</span>}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{config.summary(row)}</span>
                </button>
              )}
            />
          )}
        </section>

        <section className={cn("min-w-0", !openKey && "hidden md:block")} aria-label="Entry">
          {openKey ? (
            <EntryPane meta={meta} category={category} k={openKey} backTo={`/lore/${category}${queryString(params)}`} />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LibraryBigIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing open</EmptyTitle>
                <EmptyDescription>Pick {info.singular === "species" ? "a species" : `a ${info.singular}`} from the list. Links in the text show a preview when you point at them.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{filterPanel}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActiveFilters({ facets, selection, onChange }: { facets: Facet<IndexRow>[]; selection: Selection; onChange: (s: Selection) => void }) {
  const chips = facets.flatMap((f) => (selection[f.id] ?? []).map((v) => ({ facet: f, value: v, label: f.options?.find((o) => o.value === v)?.label ?? v })));
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <button
          key={`${c.facet.id}-${c.value}`}
          type="button"
          onClick={() => onChange({ ...selection, [c.facet.id]: selection[c.facet.id].filter((v) => v !== c.value) })}
          className="inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs hover:bg-muted"
          aria-label={`Remove filter ${c.facet.label}: ${c.label}`}
        >
          {c.label}
          <XIcon className="size-3" />
        </button>
      ))}
      <button type="button" className="px-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => onChange(Object.fromEntries(facets.map((f) => [f.id, []])))}>
        Clear all
      </button>
    </div>
  );
}

function FilterPanel({ rows, query, facets, selection, onChange }: { rows: IndexRow[]; query: string; facets: Facet<IndexRow>[]; selection: Selection; onChange: (s: Selection) => void }) {
  return (
    <div className="space-y-3">
      {facets.map((f) => (
        <FacetGroup key={f.id} rows={rows} query={query} facets={facets} facet={f} selection={selection} onChange={onChange} />
      ))}
    </div>
  );
}

function FacetGroup({ rows, query, facets, facet, selection, onChange }: { rows: IndexRow[]; query: string; facets: Facet<IndexRow>[]; facet: Facet<IndexRow>; selection: Selection; onChange: (s: Selection) => void }) {
  const chosen = selection[facet.id] ?? [];
  const [open, setOpen] = useState(!facet.folded || chosen.length > 0);
  const counts = useMemo(() => (open ? facetCounts(rows, query, facets, selection, facet) : new Map<string, number>()), [open, rows, query, facets, selection, facet]);
  const options = useMemo(() => {
    const listed = facet.options ?? [];
    const known = new Set(listed.map((o) => o.value));
    const extra = [...counts.keys()].filter((v) => !known.has(v) && v).sort().map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
    return [...listed, ...extra];
  }, [facet, counts]);
  const toggle = (v: string) => onChange({ ...selection, [facet.id]: chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v] });
  return (
    <div className="rounded-lg border bg-background/60">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {facet.label}
          {chosen.length > 0 && <span className="ml-1.5 text-xs text-primary">({chosen.length})</span>}
        </span>
        <ChevronDownIcon className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex max-h-72 flex-wrap gap-1 overflow-y-auto px-3 pb-3">
          {options.map((o) => {
            const n = counts.get(o.value) ?? 0;
            const on = chosen.includes(o.value);
            if (!on && n === 0) return null;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.value)}
                className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {o.label} <span className={cn(on ? "opacity-80" : "text-muted-foreground")}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EntryPane({ meta, category, k, backTo }: { meta: LoreMeta; category: string; k: string; backTo: string }) {
  const loaded = useLoreEntry(meta, category, k);
  const navigate = useNavigate();
  const entry = loaded.data?.entry;

  // a key that was renamed or reprinted goes to its current page
  useEffect(() => {
    if (loaded.isSuccess && !entry) {
      const to = redirectKey(meta, category, k);
      if (to) navigate(`/lore/${category}/${to}`, { replace: true });
    }
  }, [loaded.isSuccess, entry, meta, category, k, navigate]);

  useEffect(() => {
    if (!entry) return;
    document.title = `${entry.name} · Compendium of Lore`;
    rememberRecent({ category, key: k, name: entry.name, source: entry.source });
    return () => {
      document.title = "Starlights";
    };
  }, [entry, category, k]);

  return (
    <div className="rounded-lg border bg-background/60 p-4 sm:p-6 md:max-h-[calc(100dvh-9rem)] md:overflow-y-auto print:max-h-none print:overflow-visible print:border-0 print:p-0">
      <div className="mb-3 flex items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" className="md:hidden" asChild>
          <Link to={backTo}>
            <ArrowLeftIcon /> Back to the list
          </Link>
        </Button>
        {entry && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => window.print()} aria-label="Print">
            <PrinterIcon /> <span className="hidden sm:inline">Print</span>
          </Button>
        )}
      </div>
      {loaded.isLoading ? (
        <Spinner className="mx-auto my-8 size-6" />
      ) : loaded.error ? (
        <p className="text-sm text-destructive">This entry could not be loaded: {loaded.error.message}</p>
      ) : entry ? (
        <EntryView meta={meta} category={category} entry={entry} />
      ) : (
        <p className="text-sm text-muted-foreground">This entry is not in the compendium.</p>
      )}
    </div>
  );
}
