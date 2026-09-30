import DOMPurify from "dompurify";
import { ArrowLeftIcon, LibraryBigIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DescriptionProseSection from "@/components/description-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useCompendium, useCompendiumEntry, type CompendiumListItem, type CompendiumRule } from "@/lib/api/compendium";
import { cn } from "@/lib/utils";

// Aurora bookkeeping and the builder's own rule elements: only listed when their type is picked explicitly
const INTERNAL_TYPES = new Set(["Grants", "Rule", "Character Creation", "Source", "Information"]);
const ALL = "all";
const PAGE_SIZE = 200;

function countBy(items: CompendiumListItem[], key: (item: CompendiumListItem) => string | null): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function CompendiumPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const type = params.get("type") ?? ALL;
  const source = params.get("source") ?? ALL;
  const selectedId = params.get("id");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, error } = useCompendium();
  const items = useMemo(() => data?.items ?? [], [data]);
  const types = useMemo(() => countBy(items, (i) => i.type), [items]);
  const sources = useMemo(() => countBy(items, (i) => i.source), [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (type === ALL ? !INTERNAL_TYPES.has(i.type) : i.type === type) &&
        (source === ALL || i.source === source) &&
        (!q || i.name.toLowerCase().includes(q)),
    );
  }, [items, query, type, source]);

  // filters replace the history entry while typing; opening an element pushes one so Back returns to the list
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    const opensElement = "id" in changes;
    setParams(next, { replace: !opensElement });
    if (!opensElement) setLimit(PAGE_SIZE);
    else window.scrollTo({ top: 0 });
  }

  return (
    <div className="space-y-6 pb-16">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl tracking-wide">Compendium</h1>
        <p className="text-muted-foreground">
          {isLoading ? "Loading…" : `${items.length.toLocaleString()} elements imported from Aurora content.`}
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by name" value={query} onChange={(e) => update({ q: e.target.value })} />
        </div>
        <Select value={type} onValueChange={(value) => update({ type: value })}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All player options</SelectItem>
            {types.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                {name} ({count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => update({ source: value })}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            {sources.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                {name} ({count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="text-destructive">Could not load the compendium: {error.message}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className={cn(selectedId && "hidden md:block")}>
            <p className="mb-2 text-xs text-muted-foreground">{filtered.length.toLocaleString()} results</p>
            {isLoading ? (
              <Spinner className="mx-auto my-8 size-6" />
            ) : (
              <ul className="divide-y rounded-lg border bg-background/60 md:max-h-[70vh] md:overflow-y-auto">
                {filtered.slice(0, limit).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => update({ id: item.id })}
                      className={cn("w-full px-3 py-2 text-left hover:bg-muted", item.id === selectedId && "bg-muted")}
                    >
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.type}
                        {item.source ? ` · ${item.source}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {filtered.length > limit && (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Show more
              </Button>
            )}
          </div>

          <div className={cn(!selectedId && "hidden md:block")}>
            <EntryDetail id={selectedId} onBack={() => update({ id: null })} onOpen={(id) => update({ id })} />
          </div>
        </div>
      )}
    </div>
  );
}

function EntryDetail({ id, onBack, onOpen }: { id: string | null; onBack: () => void; onOpen: (id: string) => void }) {
  const { data, isLoading, error } = useCompendiumEntry(id);
  // inline styles are tuned for Aurora's own viewer (negative margins etc.) and clash with the prose styles
  const html = useMemo(() => (data ? DOMPurify.sanitize(data.description, { FORBID_ATTR: ["style"] }) : ""), [data]);

  if (!id) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryBigIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing selected</EmptyTitle>
          <EmptyDescription>Pick an element from the list to read its description and rules.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isLoading) return <Spinner className="mx-auto my-8 size-6" />;
  if (error || !data) return <p className="text-destructive">Could not load this element.</p>;

  return (
    <article className="space-y-5 rounded-lg border bg-background/60 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
        <ArrowLeftIcon /> Back to list
      </Button>

      <div className="space-y-2">
        <h2 className="font-heading text-2xl tracking-wide">{data.name}</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>{data.type}</Badge>
          {data.auroraType && data.auroraType !== data.type && <Badge variant="secondary">Aurora: {data.auroraType}</Badge>}
          {data.source && <Badge variant="outline">{data.source}</Badge>}
        </div>
        {data.supports.length > 0 && <p className="text-xs text-muted-foreground">Supports: {data.supports.join(", ")}</p>}
      </div>

      {html && (
        <DescriptionProseSection className="prose-sm [&_table]:block [&_table]:overflow-x-auto [&_td]:pr-3 [&_thead_td]:font-semibold">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </DescriptionProseSection>
      )}

      <RulesSection rules={data.rules} onOpen={onOpen} />

      {data.auroraId && <p className="font-mono text-xs text-muted-foreground">{data.auroraId}</p>}
    </article>
  );
}

function levelLabel(level: number) {
  return level > 0 ? `Level ${level}` : "Always";
}

function RulesSection({ rules, onOpen }: { rules: CompendiumRule[]; onOpen: (id: string) => void }) {
  const byLevel = (a: CompendiumRule, b: CompendiumRule) => a.level - b.level;
  const grants = rules.filter((r) => r.kind === "include" && r.element).sort(byLevel);
  const choices = rules.filter((r) => r.kind === "selection").sort(byLevel);
  const stats = rules.filter((r) => r.kind === "statistic").sort(byLevel);

  if (grants.length + choices.length + stats.length === 0) return null;

  return (
    <div className="space-y-5">
      {grants.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-lg">Grants</h3>
          <ul className="space-y-1 text-sm">
            {grants.map((rule, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 text-muted-foreground">{levelLabel(rule.level)}</span>
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onOpen(rule.element!.id)}>
                  {rule.element!.name}
                </button>
                <span className="text-muted-foreground">{rule.element!.type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {choices.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-lg">Choices</h3>
          <ul className="space-y-1 text-sm">
            {choices.map((rule, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 text-muted-foreground">{levelLabel(rule.level)}</span>
                <span>
                  {rule.quantity && rule.quantity > 1 ? `Choose ${rule.quantity}: ` : "Choose: "}
                  {rule.name}
                  <span className="text-muted-foreground">
                    {" "}
                    ({rule.elementType}
                    {rule.supports ? `, ${rule.supports}` : ""})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-lg">Statistics</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">Level</th>
                  <th className="py-1 pr-3 font-normal">Name</th>
                  <th className="py-1 pr-3 font-normal">Value</th>
                  <th className="py-1 font-normal">Bonus</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {stats.map((rule, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-3 font-sans">{levelLabel(rule.level)}</td>
                    <td className="py-1 pr-3">{rule.name}</td>
                    <td className="py-1 pr-3">{rule.value}</td>
                    <td className="py-1">{rule.bonus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
