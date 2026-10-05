/**
 * One compendium entry: its name and book, the category's own block (a spell's casting time and range, a
 * creature's stat block, …), its text, and its lore and pictures (the "fluff" 5etools keeps apart from the rules),
 * shown alongside the rules rather than on another page.
 */
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useLoreEntry, useLoreMeta } from "@/lib/lore/data";
import { monsterSubtitle } from "@/lib/lore/monster-text";
import { componentsText, durationText, levelSchoolText, rangeText, timeText } from "@/lib/lore/spell-text";
import type { LoreEntry, LoreMeta } from "@/lib/lore/types";
import { cn } from "@/lib/utils";
import { Entries, LoreRenderProvider, Picture, RichText } from "./render";
import { StatBlock } from "./stat-block";

type Obj = Record<string, unknown>;

/** "Player's Handbook (2024), p. 274" with the edition. */
export function SourceLine({ meta, entry, className }: { meta: LoreMeta; entry: LoreEntry; className?: string }) {
  const source = meta.sources[entry.source];
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span>
        {source?.name ?? entry.source}
        {entry.page ? `, p. ${entry.page}` : ""}
      </span>
      {source && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{source.edition}</Badge>}
      {Boolean(entry.srd || entry.srd52 || entry.basicRules || entry.basicRules2024) && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]" title="In the free rules (SRD or Basic Rules)">
          Free rules
        </Badge>
      )}
    </p>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function SpellBlock({ entry }: { entry: LoreEntry }) {
  const time = timeText(entry.time, true);
  const classes = (entry._classes as { name: string; source: string; variant?: boolean }[] | undefined) ?? [];
  const bySource = new Map<string, string[]>();
  for (const c of classes) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c.variant ? `${c.name} (optional)` : c.name]);
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 @2xl:grid-cols-4">
        <Stat label="Casting time">{time}{(entry.meta as Obj | undefined)?.ritual ? " or ritual" : ""}</Stat>
        <Stat label="Range">{rangeText(entry.range)}</Stat>
        <Stat label="Components"><RichText text={componentsText(entry.components, true)} /></Stat>
        <Stat label="Duration">{durationText(entry.duration)}</Stat>
      </dl>
      <div className="text-[0.95rem]">
        <Entries entries={entry.entries} depth={3} />
        <Entries entries={entry.entriesHigherLevel} depth={3} />
      </div>
      {bySource.size > 0 && (
        <p className="text-sm">
          <span className="font-medium">Classes: </span>
          {[...bySource].map(([source, names], i) => (
            <Fragment key={source}>
              {i > 0 && " · "}
              {names.sort().join(", ")} <span className="text-muted-foreground">({source})</span>
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
}

function subtitle(category: string, entry: LoreEntry): string | null {
  if (category === "bestiary") return monsterSubtitle(entry);
  if (category === "spells") {
    const level = typeof entry.level === "number" ? entry.level : 0;
    const ritual = (entry.meta as Obj | undefined)?.ritual;
    return `${levelSchoolText(level, String(entry.school ?? ""))}${ritual ? " (ritual)" : ""}`;
  }
  return null;
}

function Body({ meta, category, entry }: { meta: LoreMeta; category: string; entry: LoreEntry }) {
  switch (category) {
    case "spells":
      return <SpellBlock entry={entry} />;
    case "bestiary": {
      const versionOf = entry._versionOf as { name: string; source: string } | undefined;
      return (
        <>
          {versionOf && (
            <p className="text-sm text-muted-foreground">
              A version of <RichText text={`{@creature ${versionOf.name}|${versionOf.source}}`} />.
            </p>
          )}
          <StatBlock meta={meta} m={entry} />
          {Array.isArray(entry.environment) && (
            <p className="text-xs text-muted-foreground">Found in: {(entry.environment as string[]).join(", ")}</p>
          )}
        </>
      );
    }
    default:
      return (
        <div className="text-[0.95rem]">
          <Entries entries={entry.entries} depth={3} />
        </div>
      );
  }
}

function Lore({ entry, compact }: { entry: LoreEntry; compact: boolean }) {
  const fluff = entry._fluff;
  if (!fluff?.entries?.length && !fluff?.images?.length) return null;
  const [cover, ...images] = (fluff.images ?? []) as Obj[];
  if (compact) return cover ? <Picture image={cover} small /> : null;
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="font-heading text-lg tracking-wide">Lore</h3>
      {cover && <Picture image={cover} />}
      <div className="text-[0.95rem]">
        <Entries entries={fluff.entries} depth={2} />
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((im, i) => (
            <Picture key={i} image={im} small />
          ))}
        </div>
      )}
    </section>
  );
}

/** An entry in full (its page) or compact (a preview card). */
export function EntryView({ meta, category, entry, compact = false }: { meta: LoreMeta; category: string; entry: LoreEntry; compact?: boolean }) {
  const sub = subtitle(category, entry);
  return (
    <LoreRenderProvider value={{ meta }}>
      <article className="@container space-y-3">
        <header className="space-y-0.5">
          <h2 className={cn("font-heading tracking-wide", compact ? "text-lg" : "text-2xl sm:text-3xl")}>{entry.name}</h2>
          {sub && <p className="text-sm italic text-muted-foreground">{sub}</p>}
          <SourceLine meta={meta} entry={entry} />
        </header>
        {compact && <Lore entry={entry} compact />}
        <Body meta={meta} category={category} entry={entry} />
        {!compact && <Lore entry={entry} compact={false} />}
      </article>
    </LoreRenderProvider>
  );
}

/** The preview a cross-reference shows: loads the entry's source file, then the compact view. */
export function EntryPreview({ category, k }: { category: string; k: string }) {
  const meta = useLoreMeta();
  const entry = useLoreEntry(meta.data, category, k);
  if (meta.error || entry.error) return <p className="text-sm text-muted-foreground">This entry could not be loaded.</p>;
  if (!meta.data || entry.isLoading) return <Spinner className="mx-auto my-4 size-5" />;
  if (!entry.data?.entry) return <p className="text-sm text-muted-foreground">This entry is not in the compendium.</p>;
  return <EntryView meta={meta.data} category={category} entry={entry.data.entry} compact />;
}
