import type { ItemInfo } from "./items";

/** Aurora's compendium categories, in its order; the picker's category chips. */
export const ITEM_CATEGORIES = [
  "Adventuring Gear",
  "Treasure",
  "Trade Goods",
  "Equipment Packs",
  "Tools",
  "Musical Instruments",
  "Armor",
  "Magic Armor",
  "Weapons",
  "Magic Weapons",
  "Ammunition",
  "Spellcasting Focus",
  "Wondrous Items",
  "Supernatural Gifts",
  "Staffs",
  "Rods",
  "Wands",
  "Rings",
  "Potions",
  "Poison",
  "Scrolls",
  "Spell Scrolls",
  "Explosives",
  "Mounts & Vehicles",
] as const;

export const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"] as const;

export interface ItemFilters {
  /** mundane items, magic items, or both */
  kind: "all" | "item" | "magic";
  /** any of these (empty: all) */
  categories: string[];
  rarities: string[];
  attunement: "any" | "yes" | "no";
  /** false: only the character's ticked books */
  allSources: boolean;
}

export const NO_FILTERS: ItemFilters = { kind: "all", categories: [], rarities: [], attunement: "any", allSources: false };

export const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();

/** Rarity as written in Aurora ("Very rare", "Rare (+2)", "Varies") → one of RARITIES, or null. */
export function rarityOf(item: ItemInfo): string | null {
  const text = normalizeText(item.magic?.rarity ?? "");
  if (!text) return null;
  return [...RARITIES].reverse().find((r) => text.startsWith(normalizeText(r))) ?? null;
}

/** Whether an item passes the filters (search aside). */
export function matchesFilters(item: ItemInfo, filters: ItemFilters, restrictedSources: ReadonlySet<string>): boolean {
  if (item.buildOption || item.hidden) return false;
  if (!filters.allSources && item.source && restrictedSources.has(item.source)) return false;
  const magic = !!item.magic;
  if (filters.kind === "item" && magic) return false;
  if (filters.kind === "magic" && !magic) return false;
  if (filters.categories.length && !filters.categories.some((c) => item.categories.includes(c))) return false;
  if (filters.rarities.length && !filters.rarities.includes(rarityOf(item) ?? "")) return false;
  if (filters.attunement === "yes" && !item.magic?.attunement) return false;
  if (filters.attunement === "no" && item.magic?.attunement) return false;
  return true;
}

/**
 * Items for a search: every word of the query must appear in the name (or a category); exact names first, then
 * names starting with the query, then words starting with it, then the rest, alphabetically within each.
 */
export function searchItems(items: readonly ItemInfo[], query: string, filters: ItemFilters, restrictedSources: ReadonlySet<string>): ItemInfo[] {
  const q = normalizeText(query);
  const words = q.split(" ").filter(Boolean);
  const scored: { item: ItemInfo; score: number; name: string }[] = [];
  for (const item of items) {
    if (!matchesFilters(item, filters, restrictedSources)) continue;
    const name = normalizeText(item.name);
    if (words.length) {
      const haystack = `${name} ${normalizeText(item.categories.join(" "))}`;
      if (!words.every((w) => haystack.includes(w))) continue;
    }
    const score = !q ? 3 : name === q ? 0 : name.startsWith(q) ? 1 : name.split(" ").some((w) => w.startsWith(words[0] ?? "")) ? 2 : 3;
    scored.push({ item, score, name });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name) || (a.item.source ?? "").localeCompare(b.item.source ?? ""));
  return scored.map((s) => s.item);
}

/** How many items each category would have with the current other filters (for the chips). */
export function categoryCounts(items: readonly ItemInfo[], filters: ItemFilters, restrictedSources: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  const without = { ...filters, categories: [] };
  for (const item of items) {
    if (!matchesFilters(item, without, restrictedSources)) continue;
    for (const c of item.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}
