import { ArrowLeftIcon, CheckIcon, FilterIcon, MinusIcon, PlusIcon, SearchIcon, SparklesIcon, WandIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ElementDetails } from "@/components/element-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBaseCandidates, useItemCatalog } from "@/lib/api/items";
import type { CustomItem, ItemInfo } from "@/lib/rules/items";
import { ITEM_CATEGORIES, NO_FILTERS, RARITIES, categoryCounts, rarityOf, searchItems, type ItemFilters } from "@/lib/rules/picker";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "starlights.recent-items";
const PAGE = 100;

function readRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function remember(id: string) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...readRecents().filter((r) => r !== id)].slice(0, 12)));
  } catch {
    // private browsing: no recents
  }
}

export interface AddItem {
  item?: ItemInfo;
  baseElementId?: string;
  quantity: number;
  name?: string;
  custom?: CustomItem;
}

/**
 * Finding and adding equipment: search every item, narrow by item or magic item, categories (any of them), rarity,
 * attunement and books (the character's ticked books unless "all books"), see an item before adding it, choose
 * the base item of a magic weapon or armor, or describe your own. Keyboard: type to search, arrows to move, Enter
 * to add. Full screen on phones.
 */
export function ItemPicker({
  open,
  onOpenChange,
  restrictedSources,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restrictedSources: readonly string[];
  onAdd: (add: AddItem) => void;
}) {
  const isMobile = useIsMobile();
  const { data: catalog, isLoading } = useItemCatalog();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ItemFilters>(NO_FILTERS);
  const [moreFilters, setMoreFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const restricted = useMemo(() => new Set(restrictedSources), [restrictedSources]);
  const results = useMemo(() => (catalog ? searchItems(catalog.items, query, filters, restricted) : []), [catalog, query, filters, restricted]);
  const counts = useMemo(() => (catalog ? categoryCounts(catalog.items, filters, restricted) : new Map<string, number>()), [catalog, filters, restricted]);
  const recents = useMemo(
    () => (open && !query && sameFilters(filters, NO_FILTERS) ? readRecents().map((id) => catalog?.byId.get(id)).filter((i): i is ItemInfo => !!i) : []),
    [open, query, filters, catalog],
  );
  const shown = results.slice(0, limit);
  const current = selected ? catalog?.byId.get(selected) : isMobile ? undefined : shown[highlight];

  // a new search starts at the top
  useEffect(() => {
    setHighlight(0);
    setLimit(PAGE);
  }, [query, filters]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && shown[highlight]) {
      e.preventDefault();
      // straight in, unless it needs a choice first
      if (shown[highlight].base) setSelected(shown[highlight].id);
      else add({ item: shown[highlight], quantity: 1 });
    }
  }

  function add(entry: AddItem) {
    if (entry.item) remember(entry.item.id);
    onAdd(entry);
  }

  const toggleCategory = (c: string) =>
    setFilters((f) => ({ ...f, categories: f.categories.includes(c) ? f.categories.filter((x) => x !== c) : [...f.categories, c] }));
  const activeFilters = filters.categories.length + filters.rarities.length + (filters.attunement !== "any" ? 1 : 0) + (filters.allSources ? 1 : 0) + (filters.kind !== "all" ? 1 : 0);

  const list = (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Items">
      {isLoading && <Spinner className="mx-auto my-10 size-6" />}
      {recents.length > 0 && (
        <div className="border-b pb-2">
          <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recently added</p>
          {recents.map((item) => (
            <ItemRow key={`r-${item.id}`} item={item} active={selected === item.id} onClick={() => setSelected(item.id)} />
          ))}
        </div>
      )}
      {!isLoading && results.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Nothing matches.{" "}
          {!filters.allSources && (
            <button type="button" className="underline" onClick={() => setFilters({ ...filters, allSources: true })}>
              Search all books
            </button>
          )}
        </p>
      )}
      {shown.map((item, index) => (
        <ItemRow
          key={item.id}
          item={item}
          index={index}
          active={selected ? selected === item.id : !isMobile && index === highlight}
          onClick={() => {
            setHighlight(index);
            setSelected(item.id);
          }}
        />
      ))}
      {results.length > limit && (
        <button type="button" className="w-full py-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => setLimit(limit + PAGE)}>
          Show more ({results.length - limit} left)
        </button>
      )}
    </div>
  );

  const details = creating ? (
    <CustomItemForm
      onCancel={() => setCreating(false)}
      onAdd={(custom) => {
        onAdd(custom);
        setCreating(false);
      }}
    />
  ) : current ? (
    <AddPanel key={current.id} item={current} restricted={restricted} onAdd={add} onBack={isMobile ? () => setSelected(null) : undefined} />
  ) : (
    <p className="p-6 text-sm text-muted-foreground">Point at an item to see it here. Enter adds the highlighted item.</p>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSelected(null);
          setCreating(false);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile ? "h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none border-0" : "h-[85vh] max-h-[52rem] w-[min(72rem,95vw)] max-w-none sm:max-w-none",
        )}
      >
        <DialogTitle className="sr-only">Add equipment</DialogTitle>
        <DialogDescription className="sr-only">Search items and magic items, filter them and add them to the inventory.</DialogDescription>

        {/* on a phone, an open item or the homebrew form takes the whole screen */}
        {isMobile && (current || creating) ? (
          <div className="min-h-0 flex-1 overflow-y-auto">{details}</div>
        ) : (
          <>
            <div className="space-y-2 border-b p-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus={!isMobile}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search items…"
                    className="pl-8"
                    aria-label="Search items"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
                  <FilterIcon /> <span className="hidden sm:inline">Filters</span>
                  {activeFilters > 0 && <Badge className="ml-1 px-1.5">{activeFilters}</Badge>}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => onOpenChange(false)}>
                  <XIcon />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "item", "magic"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={filters.kind === kind}
                    onClick={() => setFilters({ ...filters, kind })}
                    className={cn("rounded-full border px-3 py-1 text-xs", filters.kind === kind ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {kind === "all" ? "All" : kind === "item" ? "Items" : (
                      <span className="flex items-center gap-1">
                        <SparklesIcon className="size-3" /> Magic items
                      </span>
                    )}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" />
                <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs hover:bg-muted">
                  <WandIcon className="size-3" /> Your own item
                </button>
              </div>

              {/* categories: a scrolling strip on phones */}
              <div className={cn("flex gap-1.5", isMobile ? "-mx-3 overflow-x-auto px-3 pb-1" : "flex-wrap")}>
                {ITEM_CATEGORIES.filter((c) => counts.get(c) || filters.categories.includes(c)).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={filters.categories.includes(c)}
                    onClick={() => toggleCategory(c)}
                    className={cn(
                      "shrink-0 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
                      filters.categories.includes(c) ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c} <span className="opacity-60">{counts.get(c) ?? 0}</span>
                  </button>
                ))}
                {filters.categories.length > 0 && (
                  <button type="button" className="shrink-0 px-2 text-xs underline" onClick={() => setFilters({ ...filters, categories: [] })}>
                    clear
                  </button>
                )}
              </div>

              {moreFilters && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground">Rarity</span>
                    {RARITIES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={filters.rarities.includes(r)}
                        onClick={() => setFilters({ ...filters, rarities: filters.rarities.includes(r) ? filters.rarities.filter((x) => x !== r) : [...filters.rarities, r] })}
                        className={cn("rounded-md border px-2 py-0.5", filters.rarities.includes(r) ? "border-primary bg-primary/15" : "hover:bg-muted")}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1">
                    <span className="text-muted-foreground">Attunement</span>
                    <select
                      value={filters.attunement}
                      onChange={(e) => setFilters({ ...filters, attunement: e.target.value as ItemFilters["attunement"] })}
                      className="h-7 rounded-md border bg-background px-1"
                    >
                      <option value="any">any</option>
                      <option value="yes">needs attunement</option>
                      <option value="no">no attunement</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={filters.allSources} onChange={(e) => setFilters({ ...filters, allSources: e.target.checked })} className="accent-primary" />
                    All books (not only this character's)
                  </label>
                  {activeFilters > 0 && (
                    <button type="button" className="underline" onClick={() => setFilters(NO_FILTERS)}>
                      Reset filters
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1">
              <div className={cn("flex min-h-0 flex-col", isMobile ? "flex-1" : "w-[45%] border-r")}>
                <p className="px-3 py-1.5 text-xs text-muted-foreground">
                  {results.length} {results.length === 1 ? "item" : "items"}
                </p>
                {list}
              </div>
              {!isMobile && <div className="min-h-0 flex-1 overflow-y-auto">{details}</div>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function sameFilters(a: ItemFilters, b: ItemFilters) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ItemRow({ item, index, active, onClick }: { item: ItemInfo; index?: number; active: boolean; onClick: () => void }) {
  const rarity = rarityOf(item);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-index={index}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", active ? "bg-muted" : "hover:bg-muted/60")}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {item.magic && <SparklesIcon className={cn("size-3.5 shrink-0", rarityColor(rarity))} />}
          <span className="truncate font-medium">{item.name}</span>
          {item.magic?.attunement && <span className="shrink-0 text-[10px] text-muted-foreground" title="Needs attunement">A</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[item.categories.slice(0, 2).join(", "), item.magic?.rarity, item.source].filter(Boolean).join(" · ")}
        </span>
      </span>
      {item.weight ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.weight} lb</span> : null}
    </button>
  );
}

export function rarityColor(rarity: string | null): string {
  switch (rarity) {
    case "Uncommon":
      return "text-green-600 dark:text-green-400";
    case "Rare":
      return "text-sky-600 dark:text-sky-400";
    case "Very Rare":
      return "text-purple-600 dark:text-purple-400";
    case "Legendary":
      return "text-orange-600 dark:text-orange-400";
    case "Artifact":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-amber-500";
  }
}

/** The item's details with how many and (for "Weapon, +1" and the like) which weapon or armor, then Add. */
function AddPanel({ item, restricted, onAdd, onBack }: { item: ItemInfo; restricted: ReadonlySet<string>; onAdd: (add: AddItem) => void; onBack?: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const bases = useBaseCandidates(item.base ? item.id : null);
  const options = useMemo(() => {
    const all = bases.data?.items ?? [];
    const inBooks = all.filter((b) => !b.source || !restricted.has(b.source));
    return (inBooks.length ? inBooks : all).sort((a, b) => a.name.localeCompare(b.name));
  }, [bases.data, restricted]);
  // one possible base (Staff of the Adder is a quarterstaff): chosen already
  const base = baseId ?? (options.length === 1 ? options[0].id : null);
  const canAdd = !item.base || !!base;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeftIcon className="size-4" /> Back to the list
          </button>
        )}
        <ElementDetails id={item.id} />
      </div>
      <div className="space-y-2 border-t p-3">
        {item.base && (
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">{item.base.kind === "Weapon" ? "Which weapon is it?" : "Which armor is it?"}</span>
            {bases.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              <select value={base ?? ""} onChange={(e) => setBaseId(e.target.value || null)} className="h-9 w-full rounded-md border bg-background px-2">
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {options.some((x) => x.id !== o.id && x.name === o.name) ? ` (${o.source})` : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border">
            <Button size="icon-sm" variant="ghost" aria-label="Fewer" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
              <MinusIcon />
            </Button>
            <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
            <Button size="icon-sm" variant="ghost" aria-label="More" onClick={() => setQuantity(quantity + 1)}>
              <PlusIcon />
            </Button>
          </div>
          <Button
            className="flex-1"
            disabled={!canAdd}
            onClick={() => {
              onAdd({ item, baseElementId: base ?? undefined, quantity });
              setAdded(true);
              setTimeout(() => setAdded(false), 1500);
            }}
          >
            {added ? <CheckIcon /> : <PlusIcon />} {added ? "Added" : "Add to inventory"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A homebrew item: a name, what it is and weighs, and whether it is magic or holds other things. */
function CustomItemForm({ onAdd, onCancel }: { onAdd: (add: AddItem) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [custom, setCustom] = useState<CustomItem>({ category: "Adventuring Gear" });
  const set = (change: Partial<CustomItem>) => setCustom({ ...custom, ...change });
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd({ name: name.trim(), quantity: 1, custom });
      }}
    >
      <button type="button" onClick={onCancel} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> Back
      </button>
      <h3 className="font-heading text-xl">Your own item</h3>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Name</span>
        <Input autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Grandmother's locket" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Kind</span>
          <select value={custom.category ?? ""} onChange={(e) => set({ category: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2">
            {ITEM_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Weight (lb)</span>
          <Input inputMode="decimal" value={custom.weight ?? ""} onChange={(e) => set({ weight: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!custom.magic} onChange={(e) => set({ magic: e.target.checked })} className="accent-primary" /> Magic item
      </label>
      {custom.magic && (
        <div className="grid grid-cols-2 gap-3 pl-6">
          <select value={custom.rarity ?? ""} onChange={(e) => set({ rarity: e.target.value || null })} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">Rarity…</option>
            {RARITIES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!custom.attunement} onChange={(e) => set({ attunement: e.target.checked })} className="accent-primary" /> Needs attunement
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!custom.container} onChange={(e) => set({ container: e.target.checked })} className="accent-primary" /> Holds other items
      </label>
      {custom.container && (
        <label className="flex items-center gap-2 pl-6 text-sm">
          Capacity <Input className="w-24" inputMode="decimal" value={custom.capacity ?? ""} onChange={(e) => set({ capacity: e.target.value === "" ? null : Number(e.target.value) || 0 })} /> lb
        </label>
      )}
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">What it is and does</span>
        <textarea
          rows={5}
          maxLength={20_000}
          value={custom.description ?? ""}
          onChange={(e) => set({ description: e.target.value || null })}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim()}>
          <PlusIcon /> Add to inventory
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
