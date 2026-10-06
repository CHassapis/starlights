import { describe, expect, it } from "vitest";
import { itemSpells, type FindSpell } from "./item-spells";

const LEVELS: Record<string, number> = { "magic missile": 1, fireball: 3, "burning hands": 1, "wall of fire": 4, "cure wounds": 1, "lesser restoration": 2, "mass cure wounds": 5, "lightning bolt": 3, "arcane lock": 2, light: 0, "ray of frost": 0, "sleet storm": 3, banishment: 4, blink: 3, "dancing lights": 0, "faerie fire": 1, "magic circle": 3, "planar binding": 5, "animal friendship": 1, fear: 3, "speak with animals": 1 };
const find: FindSpell = (name) => {
  const key = name.toLowerCase();
  return key in LEVELS ? { id: key, name, level: LEVELS[key] } : undefined;
};
const brief = (html: string) => itemSpells(html, find).map((s) => [s.spellId, s.cost, s.level, s.upcast, s.maxCost, s.dc]);

describe("itemSpells", () => {
  it("reads a 2014 wand: 1 or more charges, a level higher for each extra one, no cap", () => {
    expect(brief("<p>Five charges. Spend 1 or more of them to cast the <em>magic missile</em> spell through the rod. One charge gives the 1st-level version; each additional charge raises the slot level by one.</p>")).toEqual([["magic missile", 1, 1, true, null, null]]);
  });

  it("reads a 2024 wand: no more than 3 charges, the item's save DC", () => {
    expect(brief("<p>Six charges. You may expend no more than 3 charges to cast <i>Fireball</i> (save DC 15) through it: 1 charge for the level 3 version, one level higher per additional charge.</p>")).toEqual([["fireball", 1, 3, true, 3, 15]]);
  });

  it("reads a 2014 staff's list, with your own spell save DC", () => {
    expect(brief("<p>Holding the cane, you can cast one of the following spells with your spell save DC: <em>burning hands</em> (1 charge), <em>fireball</em> (3 charges), or <em>wall of fire</em> (4 charges).</p>")).toEqual([
      ["burning hands", 1, 1, false, null, null],
      ["fireball", 3, 3, false, null, null],
      ["wall of fire", 4, 4, false, null, null],
    ]);
  });

  it("reads a 2024 table, a higher-level version, a charge per spell level and free spells", () => {
    const html = `<p>You can cast a spell from the table below with it, using your spell save DC.</p>
      <table><thead><tr><td>Spell</td><td>Charge Cost</td></tr></thead>
      <tr><td><i>Arcane Lock</i></td><td>0</td></tr>
      <tr><td><i>Fireball (level 7 version)</i></td><td>7</td></tr>
      <tr><td><i>Cure Wounds</i></td><td>1 per spell level (maximum 4)</td></tr></table>`;
    expect(brief(html)).toEqual([
      ["arcane lock", 0, 2, false, null, null],
      ["fireball", 7, 7, false, null, null],
      ["cure wounds", 1, 1, true, 4, null],
    ]);
  });

  it("finds spells written without italics, and cantrips cast at will", () => {
    expect(brief("<p>Nine charges. As an action, cast one of these from it: banishment (4 charges) or blink (3 charges).</p>")).toEqual([
      ["banishment", 4, 4, false, null, null],
      ["blink", 3, 3, false, null, null],
    ]);
    expect(brief("<p>The band lets you cast <em>dancing lights</em> and <em>light</em> at will.</p><p><strong><em>Faerie Fire.</em></strong> Spend 1 charge to cast <em>faerie fire</em> from the band.</p>")).toEqual([
      ["dancing lights", 0, 0, false, null, null],
      ["light", 0, 0, false, null, null],
      ["faerie fire", 1, 1, false, null, null],
    ]);
  });

  it("reads a bulleted list under 'cast one of the following spells'", () => {
    expect(brief("<p>Spend 1 charge to cast one of the following spells (save DC 13) from the collar:</p><ul><li><i>Animal Friendship</i></li><li><i>Fear</i> (beasts only)</li><li><i>Speak with Animals</i></li></ul>")).toEqual([
      ["animal friendship", 1, 1, false, null, 13],
      ["fear", 1, 3, false, null, 13],
      ["speak with animals", 1, 1, false, null, 13],
    ]);
  });

  it("leaves out spells the item only changes, and the cast-at level of a cantrip", () => {
    expect(brief("<p>Whenever you cast <i>Magic Circle</i> while carrying the tome, it counts as level 9.</p>")).toEqual([]);
    expect(brief("<p>Cast one of the following spells from the icicle: <em>ray of frost</em> (no charges, or 1 charge to cast at 5th level; +5 to hit), <em>sleet storm</em> (3 charges; spell save DC15).</p>").map((s) => s.slice(0, 3))).toEqual([
      ["ray of frost", 0, 0],
      ["sleet storm", 3, 3],
    ]);
  });
});
