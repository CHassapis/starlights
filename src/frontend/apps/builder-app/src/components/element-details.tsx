import DOMPurify from "dompurify";
import { ArrowLeftIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import DescriptionProseSection from "@/components/description-section";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useCompendium, useCompendiumEntry } from "@/lib/api/compendium";
import { useItemCatalog } from "@/lib/api/items";
import type { ItemInfo } from "@/lib/rules/items";
import { cn } from "@/lib/utils";

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** "3rd-level evocation (ritual)", "Divination cantrip". */
export function spellLevelText(setters: Record<string, string>): string {
  const level = Number(setters.level) || 0;
  const school = setters.school ?? "";
  const ritual = setters.isRitual === "true" ? " (ritual)" : "";
  return level === 0 ? `${school} cantrip` : `${ORDINAL[level]}-level ${school.toLowerCase()}${ritual}`;
}

export function spellComponents(setters: Record<string, string>): string {
  return [
    setters.hasVerbalComponent === "true" && "V",
    setters.hasSomaticComponent === "true" && "S",
    setters.hasMaterialComponent === "true" && `M (${setters.materialComponent ?? "…"})`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** What an active item does, and when: "While attuned", "While equipped". */
export function effectsHeading(item: ItemInfo): string {
  if (item.magic?.attunement) return "While attuned";
  if (item.categories.some((c) => ["Potions", "Scrolls", "Spell Scrolls"].includes(c))) return "When used";
  return "While equipped";
}

/**
 * Everything worth knowing about one element, for info cards and side panels: what it is, its game figures
 * (a spell's casting time, range, components and duration; an item's rarity, attunement, weight, damage or armor
 * class, and what it does while active) and its description. Spell names in a description open that spell here
 * too, with a Back button.
 */
export function ElementDetails({ id, emptyHint, compact = false }: { id: string | null; emptyHint?: string; compact?: boolean }) {
  const [stack, setStack] = useState<string[]>([]);
  const [forId, setForId] = useState(id);
  if (forId !== id) {
    // a new element from outside starts a new trail
    setForId(id);
    setStack([]);
  }
  const shown = stack.at(-1) ?? id;

  if (!shown) return emptyHint ? <p className="text-sm text-muted-foreground">{emptyHint}</p> : null;
  return (
    <div className="space-y-3">
      {stack.length > 0 && (
        <button type="button" onClick={() => setStack(stack.slice(0, -1))} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" /> Back
        </button>
      )}
      <Details id={shown} compact={compact} onOpen={(next) => setStack([...stack, next])} />
    </div>
  );
}

function Details({ id, compact, onOpen }: { id: string; compact: boolean; onOpen: (id: string) => void }) {
  const { data, isLoading } = useCompendiumEntry(id);
  const catalog = useItemCatalog();
  const item = catalog.data?.byId.get(id);
  const spells = useSpellIndex();

  // sanitized, with spell names written in italics turned into links to their own card
  const html = useMemo(() => {
    if (!data?.description) return "";
    const clean = DOMPurify.sanitize(data.description, { FORBID_ATTR: ["style"] });
    if (!spells.size) return clean;
    const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, "text/html");
    doc.body.querySelectorAll("i, em").forEach((node) => {
      const spellId = spells.get(normalize(node.textContent ?? ""));
      if (!spellId || spellId === id) return;
      const link = doc.createElement("button");
      link.type = "button";
      link.dataset.elementId = spellId;
      link.className = "element-link";
      link.textContent = node.textContent;
      const em = doc.createElement("em");
      em.appendChild(link);
      node.replaceWith(em);
    });
    return doc.body.firstElementChild?.innerHTML ?? clean;
  }, [data, spells, id]);

  if (isLoading && !data) return <Spinner className="mx-auto my-6 size-5" />;
  if (!data) return <p className="text-sm text-muted-foreground">Not found.</p>;

  const setters = (data.setters ?? {}) as Record<string, string>;
  const isSpell = data.type === "Spell";
  const onClick = (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-element-id]");
    if (target?.dataset.elementId) {
      e.preventDefault();
      onOpen(target.dataset.elementId);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 font-heading text-xl tracking-wide">
          {item?.magic && <SparklesIcon className="size-4 shrink-0 text-amber-500" />}
          {data.name}
        </h3>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {isSpell ? <Badge>{spellLevelText(setters)}</Badge> : item ? item.categories.map((c) => <Badge key={c}>{c}</Badge>) : <Badge>{data.type}</Badge>}
          {item?.magic?.rarity && <Badge variant="secondary">{item.magic.rarity}</Badge>}
          {item?.magic?.attunement && <Badge variant="secondary">Attunement{item.magic.attunementBy ? ` ${item.magic.attunementBy}` : ""}</Badge>}
          {isSpell && setters.isConcentration === "true" && <Badge variant="secondary">Concentration</Badge>}
          {data.source && <Badge variant="outline">{data.source}</Badge>}
        </div>
      </div>

      {isSpell && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {(
            [
              ["Casting time", setters.time],
              ["Range", setters.range],
              ["Components", spellComponents(setters)],
              ["Duration", setters.duration],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      )}

      {item && <ItemFigures item={item} />}

      {html ? (
        <DescriptionProseSection
          className={cn(
            "prose-sm [&_.element-link]:cursor-pointer [&_.element-link]:underline [&_.element-link]:decoration-dotted [&_table]:block [&_table]:overflow-x-auto [&_td]:pr-3 [&_thead_td]:font-semibold",
            compact && "max-h-72 overflow-y-auto pr-1",
          )}
        >
          <div onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        </DescriptionProseSection>
      ) : (
        !item?.effects?.length && <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </div>
  );
}

function ItemFigures({ item }: { item: ItemInfo }) {
  const facts = [
    item.weight ? `${item.weight} lb` : null,
    item.cost ? `${item.cost} ${item.currency ?? "gp"}` : null,
    item.magic?.charges ? `${item.magic.charges} charges` : null,
    item.container?.capacityLb ? `Holds ${item.container.capacityLb} lb${item.container.weightless ? " (weighs nothing inside)" : ""}` : null,
    item.magic?.cursed ? "Cursed" : null,
  ].filter(Boolean);
  const weapon = item.weapon;
  const armor = item.armor;
  return (
    <div className="space-y-2 text-sm">
      {facts.length > 0 && <p className="text-muted-foreground">{facts.join(" · ")}</p>}
      {weapon && (
        <p>
          <span className="font-medium">{weapon.damage} {weapon.damageType}</span>
          {weapon.versatile && <span> (versatile {weapon.versatile})</span>}
          {weapon.range && <span> · range {weapon.range}</span>}
          {weapon.properties?.length ? <span className="text-muted-foreground"> · {weapon.properties.join(", ")}</span> : null}
        </p>
      )}
      {armor && (
        <p>
          <span className="font-medium">{armor.kind === "Shield" ? `+${armor.armorClass} AC` : `AC ${armor.armorClass}`}</span>
          <span className="text-muted-foreground">
            {armor.kind === "Light" ? " + Dex" : armor.kind === "Medium" ? " + Dex (max 2)" : ""}
            {armor.kind !== "Shield" ? ` · ${armor.kind.toLowerCase()} armor` : " · shield"}
            {armor.strengthRequirement ? ` · Str ${armor.strengthRequirement}` : ""}
            {armor.stealthDisadvantage ? " · Stealth disadvantage" : ""}
          </span>
        </p>
      )}
      {item.base && <p className="text-muted-foreground">Made from {item.base.kind === "Weapon" ? "a weapon" : "armor"} of your choice (added with the item).</p>}
      {item.effects && item.effects.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">{effectsHeading(item)}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {item.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const normalize = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/** Spell names → element id, for linking spell names in descriptions. */
function useSpellIndex(): Map<string, string> {
  const { data } = useCompendium();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const e of data?.items ?? []) if (e.type === "Spell" && !map.has(normalize(e.name))) map.set(normalize(e.name), e.id);
    return map;
  }, [data]);
}
