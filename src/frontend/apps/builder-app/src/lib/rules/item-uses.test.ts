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

  it("marks healing and temporary hit points that can go to someone else, and only those", () => {
    const tooth = itemUses("<p>The charm has 3 charges. As an action, you can expend 1 charge to touch a creature. The target regains 2d8 + 2 hit points.</p>", opts);
    expect(tooth).toEqual([expect.objectContaining({ kind: "heal", charges: 1, forOthers: true })]);
    const scarf = itemUses("<p>As an action, you can tear off a scale, and you or a creature you touch regains 4d4 hit points.</p>", opts);
    expect(scarf[0]).toMatchObject({ kind: "heal", forOthers: true });
    const salve = itemUses("<p>As an action, one dose can be eaten or rubbed on. The creature that receives it regains 2d8 + 2 hit points.</p>", opts);
    expect(salve[0]).toMatchObject({ kind: "heal", forOthers: true });
    const ward = itemUses("<p>As a bonus action, you or one creature of your choice within 30 feet gains 2d6 temporary hit points.</p>", opts);
    expect(ward[0]).toMatchObject({ kind: "tempHp", forOthers: true });
    // a potion can be given to someone else with the same action
    expect(itemUses("<p>You regain 2d4 + 2 hit points when you drink this potion.</p>", { ...opts, consumable: true })[0].forOthers).toBe(true);
    // only the user
    expect(itemUses("<p>While holding the blade, you can use an action to give yourself 1d4 + 4 temporary hit points.</p>", opts)[0].forOthers).toBe(false);
    expect(itemUses("<p>While wearing this amulet, you can take the Magic action to regain 2d4 + 2 hit points.</p>", opts)[0].forOthers).toBe(false);
    // what the fight state can't hold stays rolled and shown, never applied to someone else
    const brooch = itemUses("<p>When an ally takes damage, you can use your reaction and spend 1 charge to reduce that damage by 1d8.</p>", opts);
    expect(brooch[0]).toMatchObject({ kind: "reduceDamage", forOthers: false });
    const prayer = itemUses("<p>As a bonus action, spend 1 charge: gain 1d6 temporary hit points, or add 1d4 to your next saving throw.</p>", opts);
    expect(prayer.map((u) => [u.kind, u.forOthers])).toEqual([
      ["tempHp", false],
      ["saveBonus", false],
    ]);
  });

  it("leaves casting to the item's spells, and offers anything else as a plain use", () => {
    expect(itemUses("<p>As an action, you can expend 1 charge to cast Fireball from it.</p>", { ...opts, castsSpells: true })).toEqual([]);
    const lantern = itemUses("<p>As an action, you can light or douse the lantern.</p>", opts);
    expect(lantern).toEqual([expect.objectContaining({ slot: "Action", kind: "other", charges: 0 })]);
    expect(itemUses("<p>While lit, invisible undead within its light show as silhouettes.</p>", opts)).toEqual([]);
    expect(itemUses("<p>While wearing this armor, you can't take reactions.</p>", opts)).toEqual([]);
    expect(itemUses("<p>Its reaction time is slow, and it has no other powers.</p>", opts)).toEqual([]);
    expect(itemUses("<p>The shield remains animate for 1 minute, until you take a Bonus Action to end this effect.</p>", opts)).toEqual([]);
    expect(itemUses("<p>Other creatures can open the hatch as an action with a successful check.</p>", opts)).toEqual([]);
  });
});
