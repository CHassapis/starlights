import { describe, expect, it } from "vitest";
import type { ItemInfo } from "./items";
import { NO_FILTERS, categoryCounts, rarityOf, searchItems } from "./picker";

const item = (name: string, more: Partial<ItemInfo> = {}): ItemInfo => ({ id: name, name, elementType: "Item", auroraId: name, categories: ["Adventuring Gear"], ...more });

const items: ItemInfo[] = [
  item("Longsword", { categories: ["Weapons"], source: "Player’s Handbook (2024)" }),
  item("Longsword", { id: "Longsword 2014", categories: ["Weapons"], source: "Player’s Handbook" }),
  item("Flame Tongue", { categories: ["Magic Weapons", "Weapons"], magic: { rarity: "Rare", attunement: true } }),
  item("Sword of Sharpness", { categories: ["Magic Weapons", "Weapons"], magic: { rarity: "Very rare", attunement: true } }),
  item("Ring of Protection", { categories: ["Rings"], magic: { rarity: "Rare", attunement: true } }),
  item("Potion of Healing", { categories: ["Potions"], magic: { rarity: "Common" } }),
  item("Rope, Hempen (50 feet)"),
  item("Heward’s Handy Haversack", { categories: ["Wondrous Items"], magic: { rarity: "Rare" } }),
  item("Speed: Fly +10 Feet", { categories: ["Additional Feature"], buildOption: true }),
  item("Companion Selection", { hidden: true }),
];
const none = new Set<string>();

describe("item search", () => {
  it("never offers build options or hidden items", () => {
    expect(searchItems(items, "", NO_FILTERS, none).map((i) => i.name)).not.toContain("Speed: Fly +10 Feet");
    expect(searchItems(items, "companion", NO_FILTERS, none)).toEqual([]);
  });

  it("ranks exact names, then prefixes, then word starts", () => {
    expect(searchItems(items, "sword", NO_FILTERS, none).map((i) => i.name)).toEqual(["Sword of Sharpness", "Longsword", "Longsword"]);
  });

  it("matches every word, ignoring case, accents and apostrophes", () => {
    expect(searchItems(items, "hewards haversack", NO_FILTERS, none).map((i) => i.name)).toEqual(["Heward’s Handy Haversack"]);
    expect(searchItems(items, "ROPE hemp", NO_FILTERS, none)).toHaveLength(1);
  });

  it("combines item vs magic item with categories", () => {
    const magicWeapons = searchItems(items, "", { ...NO_FILTERS, kind: "magic", categories: ["Weapons"] }, none).map((i) => i.name);
    expect(magicWeapons).toEqual(["Flame Tongue", "Sword of Sharpness"]);
    const mundaneWeapons = searchItems(items, "", { ...NO_FILTERS, kind: "item", categories: ["Weapons"] }, none);
    expect(mundaneWeapons).toHaveLength(2);
    // categories are "any of"
    expect(searchItems(items, "", { ...NO_FILTERS, categories: ["Rings", "Potions"] }, none)).toHaveLength(2);
  });

  it("filters by rarity and attunement", () => {
    expect(searchItems(items, "", { ...NO_FILTERS, rarities: ["Very Rare"] }, none).map((i) => i.name)).toEqual(["Sword of Sharpness"]);
    expect(searchItems(items, "", { ...NO_FILTERS, kind: "magic", attunement: "no" }, none).map((i) => i.name)).toEqual(["Heward’s Handy Haversack", "Potion of Healing"]);
  });

  it("keeps to the character's books unless all books are asked for", () => {
    const restricted = new Set(["Player’s Handbook"]);
    expect(searchItems(items, "longsword", NO_FILTERS, restricted).map((i) => i.source)).toEqual(["Player’s Handbook (2024)"]);
    expect(searchItems(items, "longsword", { ...NO_FILTERS, allSources: true }, restricted)).toHaveLength(2);
  });

  it("counts items per category for the other filters", () => {
    const counts = categoryCounts(items, { ...NO_FILTERS, kind: "magic", categories: ["Rings"] }, none);
    expect(counts.get("Weapons")).toBe(2);
    expect(counts.get("Rings")).toBe(1);
    expect(counts.get("Adventuring Gear")).toBeUndefined();
  });

  it("reads Aurora's rarity spellings", () => {
    expect(rarityOf(item("x", { magic: { rarity: "Very rare" } }))).toBe("Very Rare");
    expect(rarityOf(item("x", { magic: { rarity: "Rare (+2)" } }))).toBe("Rare");
    expect(rarityOf(item("x", { magic: { rarity: "Varies" } }))).toBeNull();
  });
});
