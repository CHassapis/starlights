import { describe, expect, it } from "vitest";
import type { ItemInfo } from "./items";
import { coinsOf, goldAlternative, itemsOfKind, matchItem, startingGroups } from "./starting-equipment";

const PHB = "Player’s Handbook";
const XPHB = "Player’s Handbook (2024)";
const item = (name: string, source: string, extra: Partial<ItemInfo> = {}): ItemInfo => ({ id: `${name}|${source}`, name, source, elementType: "Item", auroraId: "", categories: [], ...extra });
const catalog: ItemInfo[] = [
  item("Chain Mail", PHB),
  item("Chain Mail", XPHB),
  item("Leather", PHB),
  item("Studded Leather", XPHB),
  item("Arrow", PHB),
  item("Crossbow, Light", PHB),
  item("Light Crossbow", XPHB),
  item("Crossbow Bolt", PHB),
  item("Clothes, Common", PHB),
  item("Lantern, Hooded", PHB),
  item("Rope, Silk (50 feet)", PHB),
  item("Thieves’ Tools", XPHB, { categories: ["Tools"] }),
  item("Smith’s Tools", XPHB, { categories: ["Tools"] }),
  item("Dice Set", XPHB, { categories: ["Tools"] }),
  item("Lute", XPHB, { categories: ["Musical Instruments"] }),
  item("Amulet", XPHB, { categories: ["Spellcasting Focus"] }),
  item("Orb", XPHB, { categories: ["Spellcasting Focus"] }),
  item("Longsword", XPHB, { weapon: { damage: "1d8", martial: true } }),
  item("Longbow", XPHB, { weapon: { damage: "1d8", martial: true, ranged: true } }),
  item("Dagger", PHB, { weapon: { damage: "1d4" } }),
  item("Dagger", XPHB, { weapon: { damage: "1d4" } }),
  item("Flame Tongue", XPHB, { weapon: { damage: "1d8", martial: true }, magic: { rarity: "Rare" } as ItemInfo["magic"] }),
];

describe("starting equipment", () => {
  it("reads the 2024 books' A or B, with coins in copper", () => {
    const groups = startingGroups({ defaultData: [{ A: [{ item: "greataxe|xphb" }, { item: "handaxe|xphb", quantity: 4 }, { value: 1500 }], B: [{ value: 7500 }] }] });
    expect(groups).toHaveLength(1);
    expect(groups[0].map((o) => o.label)).toEqual(["A", "B"]);
    expect(groups[0][0].items).toEqual([{ name: "greataxe", quantity: 1, displayName: undefined }, { name: "handaxe", quantity: 4, displayName: undefined }]);
    expect(groups[0][0].cp).toBe(1500);
    expect(groups[0][1]).toEqual({ label: "B", items: [], cp: 7500 });
  });

  it("reads the 2014 books' (a) or (b), what comes anyway, and picks of a kind", () => {
    const se = {
      defaultData: [{ a: ["chain mail|phb"], b: ["leather armor|phb", "longbow|phb", { item: "arrows (20)|phb", quantity: 1 }] }, { _: [{ equipmentType: "weaponMartial", quantity: 2 }, "holy symbol|phb"] }],
      goldAlternative: "{@dice 5d4 × 10|5d4 × 10|Starting Gold}",
    };
    const groups = startingGroups(se);
    expect(groups[0][1].items.map((i) => i.name)).toEqual(["leather armor", "longbow", "arrows (20)"]);
    expect(groups[1]).toHaveLength(1);
    expect(groups[1][0].label).toBe("");
    expect(groups[1][0].items[0]).toMatchObject({ kind: "weaponMartial", quantity: 2, name: "a martial weapon" });
    expect(groups[1][0].items[1]).toMatchObject({ kind: "focusSpellcastingHoly" });
    expect(goldAlternative(se)).toBe("5d4 × 10 gp");
    expect(startingGroups([{ _: ["robe|phb"] }])[0][0].items[0].name).toBe("robe");
    expect(startingGroups([{ _: [{ item: "pouch|phb", containsValue: 1500 }] }])[0][0].cp).toBe(1500);
  });

  it("finds the catalog's name for the book's, the edition's own first", () => {
    expect(matchItem(catalog, "chain mail", true)?.item.source).toBe(XPHB);
    expect(matchItem(catalog, "chain mail", false)?.item.source).toBe(PHB);
    expect(matchItem(catalog, "leather armor", false)?.item.name).toBe("Leather");
    expect(matchItem(catalog, "studded leather armor", true)?.item.name).toBe("Studded Leather");
    expect(matchItem(catalog, "arrows (20)", false)).toMatchObject({ item: { name: "Arrow" }, per: 20 });
    expect(matchItem(catalog, "bolts (20)", false)).toMatchObject({ item: { name: "Crossbow Bolt" }, per: 20 });
    expect(matchItem(catalog, "common clothes", false)?.item.name).toBe("Clothes, Common");
    expect(matchItem(catalog, "hooded lantern", false)?.item.name).toBe("Lantern, Hooded");
    expect(matchItem(catalog, "silk rope (50 feet)", false)?.item.name).toBe("Rope, Silk (50 feet)");
    expect(matchItem(catalog, "thieves' tools", true)?.item.name).toBe("Thieves’ Tools");
    expect(matchItem(catalog, "light crossbow", false)?.item.name).toBe("Crossbow, Light");
    expect(matchItem(catalog, "light crossbow", true)?.item.name).toBe("Light Crossbow");
    expect(matchItem(catalog, "bone dice set", true)?.item.name).toBe("Dice Set");
    expect(matchItem(catalog, "iron pot", true)).toBeNull();
  });

  it("lists the items of a kind, mundane only, one per name", () => {
    expect(itemsOfKind(catalog, "weaponMartial", true).map((i) => i.name)).toEqual(["Longbow", "Longsword"]);
    expect(itemsOfKind(catalog, "weaponMartialMelee", true).map((i) => i.name)).toEqual(["Longsword"]);
    expect(itemsOfKind(catalog, "weaponSimple", true)).toHaveLength(1);
    expect(itemsOfKind(catalog, "weaponSimple", true)[0].source).toBe(XPHB);
    expect(itemsOfKind(catalog, "toolArtisan", true).map((i) => i.name)).toEqual(["Smith’s Tools"]);
    expect(itemsOfKind(catalog, "setGaming", true).map((i) => i.name)).toEqual(["Dice Set"]);
    expect(itemsOfKind(catalog, "instrumentMusical", true).map((i) => i.name)).toEqual(["Lute"]);
    expect(itemsOfKind(catalog, "focusSpellcastingHoly", true).map((i) => i.name)).toEqual(["Amulet"]);
    expect(itemsOfKind(catalog, "focusSpellcastingArcane", true).map((i) => i.name)).toEqual(["Orb"]);
  });

  it("turns copper into the fewest coins", () => {
    expect(coinsOf(1550)).toEqual({ gp: 15, sp: 5 });
    expect(coinsOf(400)).toEqual({ gp: 4 });
    expect(coinsOf(7)).toEqual({ cp: 7 });
  });
});
