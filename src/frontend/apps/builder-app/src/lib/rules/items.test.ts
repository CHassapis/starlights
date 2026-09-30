import { describe, expect, it } from "vitest";
import {
  armorClass,
  attacks,
  attunementMax,
  displayName,
  equipProblems,
  equipSlots,
  groupInventory,
  isActive,
  resolve,
  weight,
  type CharacterFacts,
  type Inventory,
  type InventoryEntry,
  type ItemInfo,
} from "./items";

// a small catalog shaped like the server's (GET /api/elements/items)
const items: ItemInfo[] = [
  { id: "longsword", name: "Longsword", elementType: "Weapon", auroraId: "ID_LONGSWORD", categories: ["Weapons"], weight: 3, slot: "onehand",
    weapon: { damage: "1d8", damageType: "slashing", versatile: "1d10", properties: ["Versatile"], martial: true, proficiencyId: "ID_PROFICIENCY_WEAPON_PROFICIENCY_LONGSWORD" } },
  { id: "rapier", name: "Rapier", elementType: "Weapon", auroraId: "ID_RAPIER", categories: ["Weapons"], weight: 2,
    weapon: { damage: "1d8", damageType: "piercing", properties: ["Finesse"], martial: true, proficiencyId: "ID_PROFICIENCY_WEAPON_PROFICIENCY_RAPIER" } },
  { id: "dagger", name: "Dagger", elementType: "Weapon", auroraId: "ID_DAGGER", categories: ["Weapons"], weight: 1,
    weapon: { damage: "1d4", damageType: "piercing", range: "20/60", properties: ["Finesse", "Light", "Thrown"], proficiencyId: "ID_PROFICIENCY_WEAPON_PROFICIENCY_DAGGER" } },
  { id: "longbow", name: "Longbow", elementType: "Weapon", auroraId: "ID_LONGBOW", categories: ["Weapons"], weight: 2,
    weapon: { damage: "1d8", damageType: "piercing", range: "150/600", properties: ["Ammunition", "Heavy", "Two-Handed"], martial: true, ranged: true } },
  { id: "glaive", name: "Glaive", elementType: "Weapon", auroraId: "ID_GLAIVE", categories: ["Weapons"], weight: 6,
    weapon: { damage: "1d10", damageType: "slashing", properties: ["Heavy", "Reach", "Two-Handed"], martial: true, proficiencyId: "ID_PROFICIENCY_WEAPON_PROFICIENCY_GLAIVE" } },
  { id: "chain", name: "Chain Mail", elementType: "Armor", auroraId: "ID_CHAIN", categories: ["Armor"], weight: 55, slot: "body",
    armor: { kind: "Heavy", armorClass: 16, strengthRequirement: 13, stealthDisadvantage: true } },
  { id: "leather", name: "Leather Armor", elementType: "Armor", auroraId: "ID_LEATHER", categories: ["Armor"], weight: 10, armor: { kind: "Light", armorClass: 11 } },
  { id: "breastplate", name: "Breastplate", elementType: "Armor", auroraId: "ID_BREASTPLATE", categories: ["Armor"], weight: 20, armor: { kind: "Medium", armorClass: 14 } },
  { id: "shield", name: "Shield", elementType: "Armor", auroraId: "ID_SHIELD", categories: ["Armor"], weight: 6, armor: { kind: "Shield", armorClass: 2 } },
  { id: "weapon+1", name: "Weapon, +1", elementType: "Magic Item", auroraId: "ID_WEAPON_1", categories: ["Magic Weapons", "Weapons"],
    magic: { rarity: "Uncommon", enhancement: 1 }, base: { kind: "Weapon", rule: "ID_…", nameFormat: "{{parent}} +{{enhancement}}" } },
  { id: "flametongue", name: "Flame Tongue", elementType: "Magic Item", auroraId: "ID_FLAME", categories: ["Magic Weapons", "Weapons"],
    magic: { rarity: "Rare", attunement: true }, base: { kind: "Weapon", rule: "ID_…", nameFormat: "Flame Tongue {{parent}}" } },
  { id: "cloak", name: "Cloak of Protection", elementType: "Magic Item", auroraId: "ID_CLOAK", categories: ["Wondrous Items"], slot: "shoulders",
    magic: { rarity: "Uncommon", attunement: true }, hasRules: true, effects: ["+1 to all saving throws", "+1 AC"] },
  { id: "bag", name: "Bag of Holding", elementType: "Magic Item", auroraId: "ID_BAG", categories: ["Wondrous Items"], weight: 15, magic: { rarity: "Uncommon" },
    container: { capacityLb: 500, weightless: true } },
  { id: "backpack", name: "Backpack", elementType: "Item", auroraId: "ID_BACKPACK", categories: ["Adventuring Gear"], weight: 5, container: { capacityLb: 30 } },
  { id: "cart", name: "Cart", elementType: "Item", auroraId: "ID_CART", categories: ["Mounts & Vehicles"], weight: 200, excludeEncumbrance: true, container: { detached: true } },
  { id: "rope", name: "Rope", elementType: "Item", auroraId: "ID_ROPE", categories: ["Adventuring Gear"], weight: 5 },
  { id: "ingot", name: "Gold Ingot", elementType: "Item", auroraId: "ID_INGOT", categories: ["Trade Goods"], weight: 1, stackable: true },
];
const catalog = new Map(items.map((i) => [i.id, i]));

const entry = (id: string, elementId: string, more: Partial<InventoryEntry> = {}): InventoryEntry => ({ id, elementId, quantity: 1, ...more });
const inv = (...entries: InventoryEntry[]): Inventory => ({ items: entries, coins: {} });

function facts(scores: Partial<Record<"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA", number>>, stats: Record<string, number> = {}, has: string[] = []): CharacterFacts {
  return {
    mod: (a) => Math.floor(((scores[a] ?? 10) - 10) / 2),
    proficiencyBonus: 3,
    stat: (n) => stats[n],
    statNames: Object.keys(stats),
    has: new Set(has),
  };
}

describe("names", () => {
  it("formats a magic item on its base like Aurora", () => {
    expect(displayName(entry("a", "weapon+1", { baseElementId: "longsword" }), catalog.get("weapon+1"), catalog.get("longsword"))).toBe("Longsword +1");
    expect(displayName(entry("b", "flametongue", { baseElementId: "rapier" }), catalog.get("flametongue"), catalog.get("rapier"))).toBe("Flame Tongue Rapier");
  });
  it("prefers the player's own name", () => {
    expect(displayName(entry("a", "longsword", { name: "Oathkeeper" }), catalog.get("longsword"))).toBe("Oathkeeper");
  });
});

describe("weight", () => {
  it("counts items, quantities and coins (50 to the pound)", () => {
    const w = weight({ items: [entry("r", "rope", { quantity: 2 }), entry("s", "longsword")], coins: { gp: 100 } }, catalog, 10);
    expect(w.carried).toBe(15);
    expect(w.coins).toBe(2);
    expect(w.capacity).toBe(150);
    expect(w.pushDragLift).toBe(300);
    expect(w.encumbered).toBe(false);
  });

  it("counts a backpack and what is in it", () => {
    const w = weight(inv(entry("p", "backpack"), entry("r", "rope", { containerId: "p", quantity: 2 })), catalog, 10);
    expect(w.carried).toBe(15);
    expect(w.contents.get("p")).toBe(10);
  });

  it("lets a Bag of Holding weigh only itself, however deep things are inside it", () => {
    const w = weight(inv(entry("b", "bag"), entry("p", "backpack", { containerId: "b" }), entry("i", "ingot", { containerId: "p", quantity: 40 })), catalog, 10);
    expect(w.carried).toBe(15);
  });

  it("leaves out mounts and vehicles and what is loaded on them, and stored things", () => {
    const w = weight(inv(entry("c", "cart"), entry("i", "ingot", { containerId: "c", quantity: 100 }), entry("r", "rope", { stored: true })), catalog, 10);
    expect(w.carried).toBe(0);
  });

  it("flags containers holding more than they can", () => {
    const w = weight(inv(entry("p", "backpack"), entry("i", "ingot", { containerId: "p", quantity: 31 })), catalog, 20);
    expect(w.overfull).toEqual(["p"]);
  });

  it("says when the character is over their carrying capacity", () => {
    expect(weight(inv(entry("i", "ingot", { quantity: 151 })), catalog, 10).encumbered).toBe(true);
  });

  it("uses a homebrew item's own weight", () => {
    const w = weight(inv({ id: "h", name: "Anvil", quantity: 1, custom: { weight: 100 } }), catalog, 10);
    expect(w.carried).toBe(100);
  });
});

describe("equipping and attunement", () => {
  it("offers the slots Aurora would", () => {
    expect(equipSlots(resolve(entry("a", "longsword"), catalog))).toEqual(["Main Hand", "Off Hand", "Two-Handed"]);
    expect(equipSlots(resolve(entry("a", "glaive"), catalog))).toEqual(["Two-Handed"]);
    expect(equipSlots(resolve(entry("a", "chain"), catalog))).toEqual(["Armor"]);
    expect(equipSlots(resolve(entry("a", "shield"), catalog))).toEqual(["Off Hand"]);
    expect(equipSlots(resolve(entry("a", "cloak"), catalog))).toEqual(["Worn"]);
    expect(equipSlots(resolve(entry("a", "rope"), catalog))).toEqual([]);
    expect(equipSlots(resolve(entry("a", "weapon+1", { baseElementId: "rapier" }), catalog))).toEqual(["Main Hand", "Off Hand"]);
  });

  it("counts an item that needs attunement as active only while attuned", () => {
    expect(isActive(resolve(entry("c", "cloak", { equipped: "Worn" }), catalog))).toBe(false);
    expect(isActive(resolve(entry("c", "cloak", { equipped: "Worn", attuned: true }), catalog))).toBe(true);
    expect(isActive(resolve(entry("s", "longsword", { equipped: "Main Hand" }), catalog))).toBe(true);
  });

  it("warns about hands, armor and attunement", () => {
    const problems = equipProblems(
      inv(
        entry("g", "glaive", { equipped: "Two-Handed" }),
        entry("s", "shield", { equipped: "Off Hand" }),
        entry("a", "chain", { equipped: "Armor" }),
        entry("b", "leather", { equipped: "Armor" }),
        entry("c1", "cloak", { attuned: true }),
        entry("c2", "cloak", { attuned: true }),
        entry("c3", "cloak", { attuned: true }),
        entry("c4", "cloak", { attuned: true }),
      ),
      catalog,
    );
    expect(problems.hands).toBe(3);
    expect(problems.messages).toHaveLength(3);
  });

  it("takes the attunement limit from attunement:max (artificers), else 3", () => {
    expect(attunementMax({ stat: () => undefined })).toBe(3);
    expect(attunementMax({ stat: (n) => (n === "attunement:max" ? 5 : undefined) })).toBe(5);
  });
});

describe("armor class", () => {
  it("is 10 + DEX without armor", () => {
    expect(armorClass(inv(), catalog, facts({ DEX: 14 })).total).toBe(12);
  });

  it("adds all of DEX to light armor, at most 2 to medium, none to heavy", () => {
    expect(armorClass(inv(entry("a", "leather", { equipped: "Armor" })), catalog, facts({ DEX: 18 })).total).toBe(15);
    expect(armorClass(inv(entry("a", "breastplate", { equipped: "Armor" })), catalog, facts({ DEX: 18 })).total).toBe(16);
    expect(armorClass(inv(entry("a", "breastplate", { equipped: "Armor" })), catalog, facts({ DEX: 18 }, { "ac:armored:dexterity:cap": 3 })).total).toBe(17);
    const heavy = armorClass(inv(entry("a", "chain", { equipped: "Armor" })), catalog, facts({ DEX: 18 }));
    expect(heavy.total).toBe(16);
    expect(heavy.stealthDisadvantage).toBe(true);
  });

  it("does not count armor that is only carried", () => {
    expect(armorClass(inv(entry("a", "chain")), catalog, facts({ DEX: 12 })).total).toBe(11);
  });

  it("adds a shield, and magic from the statistics of active items", () => {
    const ac = armorClass(
      inv(entry("a", "chain", { equipped: "Armor" }), entry("s", "shield", { equipped: "Off Hand" })),
      catalog,
      facts({}, { "ac:armored:enhancement": 1, "ac:shield": 1, "ac:misc": 1 }),
    );
    expect(ac.total).toBe(16 + 1 + 2 + 1 + 1);
    expect(ac.parts.map((p) => p.label)).toEqual(["Chain Mail", "Magic armor", "Shield", "Magic shield", "Other bonuses"]);
  });

  it("uses the best unarmored calculation a feature gives (Draconic Resilience)", () => {
    expect(armorClass(inv(), catalog, facts({ DEX: 12 }, { "ac:draconic-resilience": 14 })).total).toBe(14);
    // worn armor replaces it
    expect(armorClass(inv(entry("a", "leather", { equipped: "Armor" })), catalog, facts({ DEX: 12 }, { "ac:draconic-resilience": 14 })).total).toBe(12);
  });

  it("drops monk-style unarmored defense when a shield is carried", () => {
    const stats = { "ac:unarmored-defense-monk": 17 };
    expect(armorClass(inv(), catalog, facts({ DEX: 16 }, stats)).total).toBe(17);
    expect(armorClass(inv(entry("s", "shield", { equipped: "Off Hand" })), catalog, facts({ DEX: 16 }, stats)).total).toBe(13 + 2);
  });
});

describe("attacks", () => {
  const proficient = ["ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_WEAPONS", "ID_PROFICIENCY_WEAPON_PROFICIENCY_SIMPLE_WEAPONS"];

  it("matches Aurora's glaive line, except reach: 10 ft by the rules where Aurora prints 5 ft (STR 14, proficiency +3)", () => {
    const [glaive] = attacks(inv(entry("g", "glaive", { equipped: "Two-Handed" })), catalog, facts({ STR: 14 }, {}, ["ID_PROFICIENCY_WEAPON_PROFICIENCY_GLAIVE"]));
    expect(glaive).toMatchObject({ name: "Glaive", range: "10 ft", attack: "+5 vs AC", damage: "1d10+2 slashing" });
    expect(glaive.properties.join(", ")).toBe("Heavy, Reach, Two-Handed");
  });

  it("uses DEX for ranged weapons and the better of STR and DEX for finesse", () => {
    const list = attacks(inv(entry("b", "longbow"), entry("r", "rapier")), catalog, facts({ STR: 8, DEX: 16 }, {}, proficient));
    expect(list.find((a) => a.name === "Longbow")).toMatchObject({ attack: "+6 vs AC", damage: "1d8+3 piercing", range: "150/600" });
    expect(list.find((a) => a.name === "Rapier")).toMatchObject({ attack: "+6 vs AC", damage: "1d8+3 piercing", range: "5 ft" });
  });

  it("leaves out proficiency the character does not have", () => {
    const [sword] = attacks(inv(entry("s", "longsword")), catalog, facts({ STR: 14 }));
    expect(sword.attack).toBe("+2 vs AC");
    expect(sword.proficient).toBe(false);
  });

  it("uses versatile dice two-handed, and no positive modifier on off-hand damage", () => {
    const list = attacks(inv(entry("a", "longsword", { equipped: "Two-Handed" }), entry("b", "dagger", { equipped: "Off Hand" })), catalog, facts({ STR: 16 }, {}, proficient));
    expect(list.find((a) => a.entryId === "a")!.damage).toBe("1d10+3 slashing");
    expect(list.find((a) => a.entryId === "b")).toMatchObject({ damage: "1d4 piercing", range: "20/60" });
  });

  it("adds a magic weapon's +1 to attack and damage, with the base weapon's figures", () => {
    const [sword] = attacks(inv(entry("m", "weapon+1", { baseElementId: "longsword", equipped: "Main Hand" })), catalog, facts({ STR: 16 }, {}, proficient));
    expect(sword).toMatchObject({ name: "Longsword +1", attack: "+7 vs AC", damage: "1d8+4 slashing" });
  });

  it("lists equipped weapons first and leaves out stored ones", () => {
    const list = attacks(inv(entry("a", "dagger"), entry("b", "longsword", { equipped: "Main Hand" }), entry("c", "rapier", { stored: true })), catalog, facts({}));
    expect(list.map((a) => a.name)).toEqual(["Longsword", "Dagger"]);
  });
});

describe("grouping for the Equipment tab", () => {
  it("puts things where they are, containers with their contents and whether those are with the character", () => {
    const g = groupInventory(
      inv(
        entry("s", "longsword", { equipped: "Main Hand" }),
        entry("p", "backpack"),
        entry("r", "rope", { containerId: "p", quantity: 2 }),
        entry("c", "cart"),
        entry("i", "ingot", { containerId: "c", quantity: 10 }),
        entry("b", "bag", { stored: true }),
        entry("d", "dagger", { stored: true }),
      ),
      catalog,
    );
    expect(g.equipped.map((r) => r.entry.id)).toEqual(["s"]);
    expect(g.carried.map((r) => r.entry.id)).toEqual(["p", "c"]);
    expect(g.stored.map((r) => r.entry.id)).toEqual(["b", "d"]);
    const byId = new Map(g.containers.map((c) => [c.container.entry.id, c]));
    expect(byId.get("p")).toMatchObject({ contents: 10, capacity: 30, away: false });
    expect(byId.get("c")).toMatchObject({ contents: 10, away: true });
    expect(byId.get("b")).toMatchObject({ contents: 0, capacity: 500, away: true });
  });
});
