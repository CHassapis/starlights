/**
 * Starting equipment as the books give it (from the Compendium's class and background data): groups of choices,
 * "(A) these items and 15 GP, or (B) 75 GP" in the 2024 books, "(a) chain mail or (b) leather armor, a longbow and
 * 20 arrows" in the 2014 ones, and the items that come with no choice. Each item is matched to an item of the
 * builder's catalog, so the picks go into the Equipment tab as real items.
 */
import type { ItemInfo } from "./items";

/** A kind of item to pick ("a martial weapon", "an artisan's tool"), from 5etools' equipmentType. */
export type EquipmentKind =
  | "weaponMartial"
  | "weaponMartialMelee"
  | "weaponSimple"
  | "weaponSimpleMelee"
  | "instrumentMusical"
  | "toolArtisan"
  | "setGaming"
  | "focusSpellcastingArcane"
  | "focusSpellcastingDruidic"
  | "focusSpellcastingHoly";

export interface StartItem {
  /** the item's name in the books ("chain mail", "arrows (20)") */
  name: string;
  quantity: number;
  /** what the book calls this one ("Book (Prayers)") */
  displayName?: string;
  /** an item to pick of a kind, instead of a named one */
  kind?: EquipmentKind;
  /** something with no item behind it ("a pouch containing 10 gp") */
  special?: string;
}

export interface StartOption {
  /** "A", "B" (or "" for what comes with no choice) */
  label: string;
  items: StartItem[];
  /** coins that come with it, in copper pieces */
  cp: number;
}

/** One choice between options (or a single option, when nothing is to be chosen). */
export type StartGroup = StartOption[];

const KIND_NAMES: Record<EquipmentKind, string> = {
  weaponMartial: "a martial weapon",
  weaponMartialMelee: "a martial melee weapon",
  weaponSimple: "a simple weapon",
  weaponSimpleMelee: "a simple melee weapon",
  instrumentMusical: "a musical instrument",
  toolArtisan: "a set of artisan's tools",
  setGaming: "a gaming set",
  focusSpellcastingArcane: "an arcane focus",
  focusSpellcastingDruidic: "a druidic focus",
  focusSpellcastingHoly: "a holy symbol",
};

export const kindName = (kind: EquipmentKind) => KIND_NAMES[kind];

/** Named items that are really a pick of a kind. */
const NAMED_KINDS: Record<string, EquipmentKind> = {
  "holy symbol": "focusSpellcastingHoly",
  "druidic focus": "focusSpellcastingDruidic",
  "arcane focus": "focusSpellcastingArcane",
};

function toItem(raw: unknown): StartItem | number | null {
  if (typeof raw === "string") {
    const name = raw.split("|")[0];
    return NAMED_KINDS[name.toLowerCase()] ? { name, quantity: 1, kind: NAMED_KINDS[name.toLowerCase()] } : { name, quantity: 1 };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { item?: string; quantity?: number; displayName?: string; equipmentType?: string; special?: string; value?: number; containsValue?: number };
  if (typeof o.value === "number" && !o.item && !o.special) return o.value;
  const quantity = o.quantity ?? 1;
  if (o.item) {
    const name = o.item.split("|")[0];
    const kind = NAMED_KINDS[name.toLowerCase()];
    return { name, quantity, displayName: o.displayName, ...(kind ? { kind } : {}) };
  }
  if (o.equipmentType && o.equipmentType in KIND_NAMES) return { name: KIND_NAMES[o.equipmentType as EquipmentKind], quantity, kind: o.equipmentType as EquipmentKind };
  if (o.special) return { name: o.special, quantity, special: o.special };
  return null;
}

/** The groups of a class's or background's startingEquipment (both books' shapes). */
export function startingGroups(startingEquipment: unknown): StartGroup[] {
  const se = startingEquipment as { defaultData?: unknown[] } | unknown[] | null | undefined;
  const data = Array.isArray(se) ? se : se?.defaultData;
  if (!Array.isArray(data)) return [];
  return data
    .filter((g): g is Record<string, unknown[]> => !!g && typeof g === "object")
    .map((g) =>
      Object.entries(g).map(([label, list]) => {
        const option: StartOption = { label: label === "_" ? "" : label.toUpperCase(), items: [], cp: 0 };
        for (const raw of Array.isArray(list) ? list : []) {
          const item = toItem(raw);
          if (typeof item === "number") option.cp += item;
          else if (item) option.items.push(item);
          // "a pouch containing 15 gp"
          const inside = (raw as { containsValue?: number } | null)?.containsValue;
          if (typeof inside === "number") option.cp += inside;
        }
        return option;
      }),
    )
    .filter((g) => g.length > 0);
}

/** The 2014 books' "or take gold instead" ("5d4 × 10"), as text, if there is one. */
export function goldAlternative(startingEquipment: unknown): string | null {
  const g = (startingEquipment as { goldAlternative?: string } | null)?.goldAlternative;
  if (!g) return null;
  const m = g.match(/\{@dice ([^|}]+)/);
  return `${(m ? m[1] : g).trim()} gp`;
}

/** Coins in copper pieces as the fewest coins: 1550 → { gp: 15, sp: 5 }. */
export function coinsOf(cp: number): { gp?: number; sp?: number; cp?: number } {
  const out: { gp?: number; sp?: number; cp?: number } = {};
  if (cp >= 100) out.gp = Math.floor(cp / 100);
  if (cp % 100 >= 10) out.sp = Math.floor((cp % 100) / 10);
  if (cp % 10) out.cp = cp % 10;
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** The names the catalog might use for a book's item name: "leather armor" → "leather", "hooded lantern" → "lantern, hooded". */
function candidates(name: string): { name: string; per: number }[] {
  const n = norm(name);
  const out: { name: string; per: number }[] = [{ name: n, per: 1 }];
  // "arrows (20)" → 20 × "arrow"; "crossbow bolts (20)" → "crossbow bolt"
  const bundle = n.match(/^(.+?)s \((\d+)\)$/);
  if (bundle) {
    out.push({ name: bundle[1], per: Number(bundle[2]) });
    if (bundle[1] === "bolt") out.push({ name: "crossbow bolt", per: Number(bundle[2]) });
  }
  if (n.endsWith(" armor")) out.push({ name: n.slice(0, -" armor".length), per: 1 });
  // "silk rope (50 feet)" → "rope, silk (50 feet)"; "common clothes" → "clothes, common"
  const m = n.match(/^(\S+(?: \S+)?) (\S+)( \(.+\))?$/);
  if (m) out.push({ name: `${m[2]}, ${m[1]}${m[3] ?? ""}`, per: 1 });
  // last: without a describing first word ("bone dice set" → "dice set")
  const rest = n.split(" ").slice(1).join(" ");
  if (rest.includes(" ")) out.push({ name: rest, per: 1 });
  return out;
}

/** The catalog item for a book's item name, the edition's own first; and how many catalog items one book item is. */
export function matchItem(catalog: ItemInfo[], name: string, revised: boolean): { item: ItemInfo; per: number } | null {
  const usable = catalog.filter((i) => !i.magic && !i.hidden && !i.buildOption);
  const isRevised = (i: ItemInfo) => /\((2024|2025)\)/.test(i.source ?? "");
  // the edition's own item under any of the names first ("light crossbow" is "Crossbow, Light" in 2014), then any
  for (const ownOnly of [true, false]) {
    for (const c of candidates(name)) {
      const found = usable.find((i) => norm(i.name) === c.name && (!ownOnly || isRevised(i) === revised));
      if (found) return { item: found, per: c.per };
    }
  }
  return null;
}

const FOCUS_NAMES: Partial<Record<EquipmentKind, string[]>> = {
  focusSpellcastingArcane: ["crystal", "orb", "rod", "staff", "wand"],
  focusSpellcastingHoly: ["amulet", "emblem", "reliquary"],
  focusSpellcastingDruidic: ["sprig of mistletoe", "totem", "wooden staff", "yew wand"],
};

/** The catalog items of a kind, one per name (the edition's own when there are two), sorted by name. */
export function itemsOfKind(catalog: ItemInfo[], kind: EquipmentKind, revised: boolean): ItemInfo[] {
  const fits = (i: ItemInfo): boolean => {
    if (i.magic || i.hidden || i.buildOption) return false;
    const w = i.weapon;
    switch (kind) {
      case "weaponMartial":
        return !!w && !!w.martial;
      case "weaponMartialMelee":
        return !!w && !!w.martial && !w.ranged;
      case "weaponSimple":
        return !!w && !w.martial;
      case "weaponSimpleMelee":
        return !!w && !w.martial && !w.ranged;
      case "instrumentMusical":
        return i.categories.some((c) => c.startsWith("Musical Instruments"));
      case "toolArtisan":
        return i.categories.includes("Tools") && /(tools|supplies)$/i.test(norm(i.name)) && !/thieves|navigator|disguise|forgery|herbalism|poisoner/i.test(i.name);
      case "setGaming":
        return i.categories.includes("Tools") && /(set|dice|cards|deck)/i.test(i.name) && !/tools|supplies/i.test(i.name);
      default:
        return i.categories.includes("Spellcasting Focus") && (FOCUS_NAMES[kind] ?? []).includes(norm(i.name));
    }
  };
  const byName = new Map<string, ItemInfo>();
  for (const i of catalog.filter(fits).filter((i) => !i.weapon || /handbook/i.test(i.source ?? ""))) {
    const key = norm(i.name);
    const had = byName.get(key);
    if (!had || (/\((2024|2025)\)/.test(i.source ?? "") === revised && /\((2024|2025)\)/.test(had.source ?? "") !== revised)) byName.set(key, i);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
