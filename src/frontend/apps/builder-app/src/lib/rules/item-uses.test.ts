import { describe, expect, it } from "vitest";
import { itemUses } from "./item-uses";

const opts = { consumable: false, edition: "2024" as const, castsSpells: false };

describe("what a magic item does on a turn", () => {
  it("puts each use under its action, with its charges and dice", () => {
    const prayer = itemUses("<p>This item has 3 charges and regains 1 charge at dawn.</p><p>As a bonus action, spend 1 charge for one of these: gain 1d6 temporary hit points, or add 1d4 to your next saving throw.</p>", opts);
    expect(prayer.map((u) => [u.slot, u.kind, u.label, u.charges])).toEqual([
      ["Bonus Action", "tempHp", "Gain 1d6 temporary hit points", 1],
      ["Bonus Action", "saveBonus", "Add 1d4 to a saving throw", 1],
    ]);
    const brooch = itemUses("<p>This brooch has 3 charges and regains 1d3 charges at dawn.</p><p>When an ally takes damage, you can use your reaction and spend 1 charge to reduce that damage by 1d8.</p>", opts);
    expect(brooch).toHaveLength(1);
    expect(brooch[0]).toMatchObject({ slot: "Reaction", kind: "reduceDamage", charges: 1, roll: { dice: [{ count: 1, sides: 8 }] } });
  });

  it("drinks a potion as a bonus action in 2024 and an action in 2014", () => {
    const potion = "<p>You regain 2d4 + 2 hit points when you drink this potion.</p>";
    expect(itemUses(potion, { ...opts, consumable: true })[0]).toMatchObject({ slot: "Bonus Action", kind: "heal", consumes: true });
    expect(itemUses(potion, { ...opts, consumable: true, edition: "2014" })[0].slot).toBe("Action");
  });

  it("leaves casting to the item's spells, and offers anything else as a plain use", () => {
    expect(itemUses("<p>As an action, you can expend 1 charge to cast Fireball from it.</p>", { ...opts, castsSpells: true })).toEqual([]);
    const lantern = itemUses("<p>As an action, you can light or douse the lantern.</p>", opts);
    expect(lantern).toEqual([expect.objectContaining({ slot: "Action", kind: "other", charges: 0 })]);
    expect(itemUses("<p>While lit, invisible undead within its light show as silhouettes.</p>", opts)).toEqual([]);
  });
});
