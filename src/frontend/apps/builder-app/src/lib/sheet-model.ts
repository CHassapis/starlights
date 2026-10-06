import { armorClass, attunementMax, displayName, resolve, sheetAttacks, weight, type Catalog, type CharacterFacts, type Inventory, type Resolved } from "@/lib/rules/items";
import { preparedIds, spellSlots, type Caster, type KnownSpell, type MagicState, type Spellcasting } from "@/lib/rules/magic";

/*
 * What Aurora's sheet shows of a character's equipment and spellcasting, worked out from Starlights' inventory,
 * spellcasting and magic state, following Aurora's own sheets (their form fields are the reference, see
 * homelab/scripts/starlights-compare-sheet.py): gear in [brackets] when equipped or attuned, Aurora's generated item
 * names in the lists and the player's own on the cards, prepared spells first and ticked, then the rest of the
 * class list.
 */

/** A compendium entry's text, for item cards and descriptions. */
export interface ItemText {
  name: string;
  description: string;
  source: string | null;
  setters: Record<string, string>;
}

export interface GearLine {
  name: string;
  count: number;
  /** total pounds, "—" for none */
  weight: string;
}

export interface SheetEquipment {
  gear: GearLine[];
  magicGear: GearLine[];
  valuables: GearLine[];
  coins: Record<"cp" | "sp" | "ep" | "gp" | "pp", number>;
  carried: number;
  capacity: number;
  drag: number;
  attuned: number;
  attunementMax: number;
  /** magic items equipped or attuned: name and description, for the item descriptions box */
  descriptions: { title: string; html: string }[];
  /** Aurora's two "stored items" boxes: a mount's or vehicle's load, or what is stored away */
  storage: { name: string; items: GearLine[] }[];
  treasure: string;
  questItems: string;
}

export interface SheetItemCard {
  title: string;
  subtitle: string;
  html: string;
  weight: string;
  source: string;
}

export interface SheetArmor {
  total: number;
  /** the armor's AC, or without armor the unarmored calculation's total (Mage Armor and the like compare with it) */
  base: number;
  /** "Light", "Medium" or "Heavy"; null without armor */
  armorKind: string | null;
  hasShield: boolean;
  /** "Chain Mail", "Unarmored (13)", "Draconic Resilience (Sorcerer) (17)" */
  label: string;
  shield: string;
  stealthDisadvantage: boolean;
}

export interface SheetAttackLine {
  name: string;
  range: string;
  attack: string;
  damage: string;
  description: string;
}

export interface SheetSpellLine {
  name: string;
  prepared: boolean;
}

export interface SheetSpellPage {
  title: string;
  ability: string;
  attack: string;
  save: string;
  prepare: string;
  levels: { level: number; slots: number; spells: SheetSpellLine[] }[];
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
// Aurora writes half a pound ".5"
const pounds = (n: number) => (n <= 0 ? "—" : Number.isInteger(n) ? String(n) : String(+n.toFixed(2)).replace(/^0\./, "."));
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Aurora's name for an item in lists: its own name, or the magic item's made from its base ("Spear +1"), not the player's. */
export function generatedName(r: Resolved): string {
  return r.entry.custom ? (r.entry.name ?? "Homebrew item") : displayName({ ...r.entry, name: null }, r.item, r.base);
}

/**
 * The armor box: the armor's name, or without armor the calculation that wins, as Aurora writes it: the feature
 * that gives it with its class and the AC ("Draconic Resilience (Sorcerer) (17)"), else "Unarmored (13)".
 */
export function sheetArmor(inventory: Inventory, catalog: Catalog, facts: CharacterFacts, featureOf: (statistic: string) => string | undefined): SheetArmor {
  const ac = armorClass(inventory, catalog, facts);
  const unarmored = ac.parts[0]?.value ?? 10;
  const feature = ac.calculation ? featureOf(ac.calculation) : undefined;
  return {
    total: ac.total,
    base: ac.parts[0]?.value ?? 10,
    armorKind: ac.armor?.armor?.kind ?? null,
    hasShield: !!ac.shield,
    label: ac.armor ? generatedName(ac.armor) : feature ? `${feature} (${unarmored})` : `Unarmored (${unarmored})`,
    shield: ac.shield ? generatedName(ac.shield) : "",
    stealthDisadvantage: ac.stealthDisadvantage,
  };
}

export function sheetAttackLines(inventory: Inventory, catalog: Catalog, facts: CharacterFacts): SheetAttackLine[] {
  return sheetAttacks(inventory, catalog, facts).map((a) => ({ name: a.name, range: a.range, attack: a.attack, damage: a.damage, description: a.properties.join(", ") }));
}

export function sheetEquipment(inventory: Inventory, catalog: Catalog, facts: CharacterFacts & { strength: number }, texts: ReadonlyMap<string, ItemText>): SheetEquipment {
  const resolved = inventory.items.map((e) => resolve(e, catalog));
  const byId = new Map(resolved.map((r) => [r.entry.id, r]));
  const line = (r: Resolved, prefix = ""): GearLine => {
    const name = generatedName(r);
    return { name: `${prefix}${r.entry.equipped || r.entry.attuned ? `[${name}]` : name}`, count: r.entry.quantity, weight: pounds(r.weight * r.entry.quantity) };
  };

  // where an entry is: carried (possibly in a backpack), or away (stored, or in a mount's or vehicle's load)
  const awayRoot = (r: Resolved): Resolved | "stored" | null => {
    for (let at: Resolved | undefined = r; at; at = at.entry.containerId ? byId.get(at.entry.containerId) : undefined) {
      if (at.entry.stored) return "stored";
      if (at !== r && at.container?.detached) return at;
    }
    return null;
  };

  const gear: GearLine[] = [];
  const magicItems: Resolved[] = [];
  const valuables: GearLine[] = [];
  // carried things in inventory order, a container's contents right after it
  const visit = (r: Resolved, depth: number) => {
    if (awayRoot(r)) return;
    if (r.item?.valuable && !r.magic) valuables.push(line(r));
    else if (r.magic) magicItems.push(r);
    else gear.push(line(r, depth > 0 ? "– " : ""));
    for (const inside of resolved.filter((x) => x.entry.containerId === r.entry.id)) visit(inside, depth + 1);
  };
  for (const r of resolved.filter((x) => !x.entry.containerId || !byId.has(x.entry.containerId))) visit(r, 0);

  // Aurora lists magic weapons and armor (made from a base item) before the other magic items
  const magicGear = [...magicItems.filter((r) => r.base), ...magicItems.filter((r) => !r.base)].map((r) => line(r));

  const storage: SheetEquipment["storage"] = [];
  for (const holder of resolved.filter((r) => r.container?.detached && !awayRoot(r))) {
    storage.push({ name: generatedName(holder), items: resolved.filter((r) => awayRoot(r) === holder).map((r) => line(r)) });
  }
  const stored = resolved.filter((r) => awayRoot(r) === "stored");
  if (stored.length > 0) storage.push({ name: "Stored", items: stored.map((r) => line(r)) });
  // Aurora's boxes are headed "#1" and "#2" when nothing names them
  while (storage.length < 2) storage.push({ name: `#${storage.length + 1}`, items: [] });

  const w = weight(inventory, catalog, facts.strength);
  return {
    gear,
    magicGear,
    valuables,
    coins: { cp: inventory.coins.cp ?? 0, sp: inventory.coins.sp ?? 0, ep: inventory.coins.ep ?? 0, gp: inventory.coins.gp ?? 0, pp: inventory.coins.pp ?? 0 },
    carried: Math.round(w.carried * 100) / 100,
    capacity: w.capacity,
    drag: w.pushDragLift,
    attuned: resolved.filter((r) => r.entry.attuned).length,
    attunementMax: attunementMax(facts),
    descriptions: resolved
      .filter((r) => r.magic && (r.entry.equipped || r.entry.attuned))
      .map((r) => ({ title: generatedName(r), html: r.entry.custom?.description ?? texts.get(r.item?.id ?? "")?.description ?? "" }))
      .filter((d) => d.html),
    storage: storage.slice(0, 2),
    treasure: inventory.treasure ?? "",
    questItems: inventory.questItems ?? "",
  };
}

/**
 * Item cards, in inventory order, for the entries that want one: the player's name for it, the base item's category
 * and weight as the book writes them ("5 lb. (full)"), the magic item's description and book.
 */
export function sheetItemCards(inventory: Inventory, catalog: Catalog, texts: ReadonlyMap<string, ItemText>): SheetItemCard[] {
  return inventory.items
    .filter((e) => e.card !== false)
    .map((e) => resolve(e, catalog))
    .map((r) => {
      const own = texts.get(r.item?.id ?? "");
      const base = r.base ? texts.get(r.base.id) : own;
      const custom = r.entry.custom;
      return {
        title: r.entry.name?.trim() || generatedName(r),
        subtitle: custom?.category ?? base?.setters.category ?? own?.setters.category ?? r.categories[0] ?? "",
        html: custom?.description ?? own?.description ?? "",
        // the book's weight text, as Aurora's cards print it ("5 lb. (full)", "—")
        weight: custom?.weight ? `${custom.weight} lb.` : (base?.setters.weight ?? own?.setters.weight ?? ""),
        source: custom ? (custom.source ?? "Homebrew") : (own?.source ?? ""),
      };
    });
}

/**
 * The spellcasting pages, one per spellcasting and one for other spells. A class that prepares lists its prepared
 * spells first and ticked (always-prepared ones marked so), then what it could prepare instead; a class that knows
 * its spells lists them. Slots are the shared pool when multiclassed, pact slots for a warlock.
 */
export function sheetSpellPages(
  casting: Spellcasting,
  magic: MagicState,
  spellName: (elementId: string) => { name: string; level: number } | undefined,
  options: { subclassOf: (c: Caster) => string | undefined; otherLabel: (s: KnownSpell) => string; order: (s: KnownSpell) => number },
): SheetSpellPage[] {
  const shared = spellSlots(casting.casters);
  const pages: SheetSpellPage[] = casting.casters.map((c) => {
    const slots: Record<number, number> = c.pact ? { [c.pact.level]: c.pact.count } : shared;
    const levels = new Map<number, { ticked: SheetSpellLine[]; rest: SheetSpellLine[] }>();
    const at = (level: number) => levels.get(level) ?? (levels.set(level, { ticked: [], rest: [] }), levels.get(level)!);
    const chosen = new Set(preparedIds(c, magic));
    const listed = new Set<string>();

    for (const s of c.spells) {
      if (s.kind === "cantrip") at(0).rest.push({ name: s.name, prepared: false });
      else if (s.kind === "always" && !s.fromElsewhere) at(s.level).ticked.push({ name: `${s.name} (Always Prepared)`, prepared: true });
      else if (s.kind === "spellbook" || s.kind === "known" || !c.knowsWholeList) {
        if (chosen.has(s.elementId)) continue;
        at(s.level).rest.push({ name: s.name, prepared: false });
      } else continue;
      listed.add(s.elementId);
    }
    for (const id of chosen) {
      const spell = spellName(id);
      if (spell) at(spell.level).ticked.push({ name: spell.name, prepared: true });
      listed.add(id);
    }
    if (c.knowsWholeList) {
      // the rest of the class list, with feat and species spells it takes in
      const rest = [...c.preparable, ...c.spells.filter((s) => s.fromElsewhere).map((s) => s.elementId)];
      for (const id of new Set(rest)) {
        if (listed.has(id)) continue;
        const spell = spellName(id);
        if (spell && spell.level > 0) at(spell.level).rest.push({ name: spell.name, prepared: false });
      }
    }

    const top = Math.max(0, ...Object.keys(slots).map(Number), ...levels.keys());
    const subclass = options.subclassOf(c);
    return {
      title: subclass ? `${c.name}, ${subclass}` : c.name,
      ability: c.ability ?? "",
      attack: sign(c.attack),
      save: String(c.dc),
      prepare: c.prepares && c.prepareMax !== null ? String(c.prepareMax) : "N/A",
      levels: Array.from({ length: top + 1 }, (_, level) => ({ level, slots: slots[level] ?? 0, spells: levels.get(level) }))
        .filter((l) => (l.spells && l.spells.ticked.length + l.spells.rest.length > 0) || (l.level > 0 && l.slots > 0))
        .map((l) => ({ level: l.level, slots: l.level > 0 ? l.slots : 0, spells: [...(l.spells?.ticked ?? []).sort(byName), ...(l.spells?.rest ?? []).sort(byName)] })),
    };
  });

  if (casting.otherSpells.length > 0) {
    const levels = new Map<number, SheetSpellLine[]>();
    for (const s of [...casting.otherSpells].sort((a, b) => a.level - b.level || options.order(a) - options.order(b))) {
      const label = options.otherLabel(s);
      if (!levels.has(s.level)) levels.set(s.level, []);
      levels.get(s.level)!.push({ name: label ? `${s.name} (${label})` : s.name, prepared: false });
    }
    pages.push({ title: "Other Spells", ability: "", attack: "", save: "", prepare: "", levels: [...levels.entries()].map(([level, spells]) => ({ level, slots: 0, spells })) });
  }
  return pages;
}
