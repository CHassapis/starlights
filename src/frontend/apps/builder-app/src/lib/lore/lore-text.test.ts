// Made-up samples in the data's shapes: no book text is kept in the repository.
import { describe, expect, it } from "vitest";
import { describeRoll, parseDice, roll } from "./dice";
import { entryKey, keyFromParam } from "./keys";
import { filterRows, matchScore, normalize, selectionFromParams, selectionToParams } from "./search";
import { componentsText, durationText, levelSchoolText, rangeText, timeText } from "./spell-text";
import { displayText, parseTags, plainTagText, splitArgs, stripTags, type TagNode } from "./tags";
import type { IndexRow } from "./types";

describe("keys", () => {
  it("are 5etools' hash format, and survive the router decoding them", () => {
    expect(entryKey("Fireball", "XPHB")).toBe("fireball_xphb");
    expect(entryKey("Mordenkainen's Sword", "PHB")).toBe("mordenkainen's%20sword_phb");
    expect(entryKey("Wand of the War Mage, +1", "XDMG")).toBe("wand%20of%20the%20war%20mage%2c%20%2b1_xdmg");
    expect(keyFromParam(decodeURIComponent("wand%20of%20the%20war%20mage%2c%20%2b1_xdmg"))).toBe("wand%20of%20the%20war%20mage%2c%20%2b1_xdmg");
  });
});

describe("tags", () => {
  it("parses nested tags and splits only top-level pipes", () => {
    const nodes = parseTags("Cast {@spell glimmer|ABC|the glimmer} on {@b a {@i small} target}.");
    expect(nodes).toHaveLength(5);
    const spell = nodes[1] as TagNode;
    expect(spell).toMatchObject({ tag: "spell", args: ["glimmer", "ABC", "the glimmer"] });
    expect(displayText(spell)).toBe("the glimmer");
    expect((nodes[3] as TagNode).text).toBe("a {@i small} target");
    expect(splitArgs("a {@x b|c} d|e")).toEqual(["a {@x b|c} d", "e"]);
  });

  it("keeps unclosed braces as text and strips tags to what they show", () => {
    expect(parseTags("broken {@b text")).toEqual(["broken {@b text"]);
    expect(stripTags("{@atk mw} {@hit 5} to hit. {@h}7 ({@damage 2d6}) damage, {@dc 13}, {@recharge 5}")).toBe(
      "Melee Weapon Attack: +5 to hit. Hit: 7 (2d6) damage, DC 13, (Recharge 5–6)",
    );
    expect(plainTagText({ tag: "atkr", args: ["m,r"], text: "m,r" })).toBe("Melee or Ranged Attack Roll:");
    expect(plainTagText({ tag: "actSave", args: ["wis"], text: "wis" })).toBe("Wisdom Saving Throw:");
    expect(plainTagText({ tag: "scaledamage", args: ["2d6", "1-9", "1d6"], text: "" })).toBe("1d6");
  });
});

describe("dice", () => {
  it("parses dice expressions and refuses formulas", () => {
    expect(parseDice("2d6 + 1d4 - 1")).toEqual({ dice: [{ count: 2, sides: 6, sign: 1 }, { count: 1, sides: 4, sign: 1 }], bonus: -1 });
    expect(parseDice("d20+5")).toEqual({ dice: [{ count: 1, sides: 20, sign: 1 }], bonus: 5 });
    expect(parseDice("(level - 4)d4 + 3")).toBeNull();
    expect(parseDice("1000d6")).toBeNull();
  });

  it("rolls within range", () => {
    const r = roll(parseDice("3d6+2")!, () => 0.999);
    expect(r).toEqual({ total: 20, rolls: [6, 6, 6], bonus: 2 });
    expect(describeRoll(r)).toBe("6 + 6 + 6 + 2 = 20");
    expect(roll(parseDice("1d4")!, () => 0).total).toBe(1);
  });
});

describe("search", () => {
  const row = (name: string, src = "ABC", extra: Partial<IndexRow> = {}): IndexRow => ({ k: entryKey(name, src), name, src, ed: "2024", ...extra });
  const rows = [row("Hold Person"), row("Hold Monster"), row("Household Charm"), row("Bolt of Ice", "OLD", { ed: "2014" })];

  it("ranks prefix, then word start, then anywhere", () => {
    expect(normalize("Mordenkainen’s  Sword!")).toBe("mordenkainens sword");
    expect(matchScore("Hold Person", "hold")).toBeGreaterThan(matchScore("Household Charm", "charm"));
    expect(matchScore("Hold Monster", "hold mon")).toBeGreaterThan(0);
    expect(filterRows(rows, "hold", [], {}).map((r) => r.name)).toEqual(["Hold Monster", "Hold Person", "Household Charm"]);
  });

  it("filters by facets, any of the values per facet", () => {
    const facets = [{ id: "ed", label: "Edition", values: (r: IndexRow) => [r.ed] }];
    expect(filterRows(rows, "", facets, { ed: ["2014"] }).map((r) => r.name)).toEqual(["Bolt of Ice"]);
    const params = selectionToParams({ ed: ["2014", "2024"] }, new URLSearchParams("q=x"));
    expect(params.toString()).toBe("q=x&ed=2014%2C2024");
    expect(selectionFromParams(params, facets)).toEqual({ ed: ["2014", "2024"] });
  });
});

describe("spell wording", () => {
  it("reads the spell fields", () => {
    expect(levelSchoolText(0, "V")).toBe("Evocation Cantrip");
    expect(levelSchoolText(3, "N")).toBe("Level 3 Necromancy");
    expect(timeText([{ number: 1, unit: "reaction", condition: "which you take when hit" }], true)).toBe("1 reaction, which you take when hit");
    expect(timeText([{ number: 10, unit: "minute" }])).toBe("10 minutes");
    expect(rangeText({ type: "cone", distance: { type: "feet", amount: 15 } })).toBe("Self (15-foot cone)");
    expect(rangeText({ type: "point", distance: { type: "touch" } })).toBe("Touch");
    expect(componentsText({ v: true, s: true, m: { text: "a pinch of salt", cost: 10 } }, true)).toBe("V, S, M (a pinch of salt)");
    expect(durationText([{ type: "timed", duration: { type: "minute", amount: 1 }, concentration: true }])).toBe("Concentration, up to 1 minute");
    expect(durationText([{ type: "permanent", ends: ["dispel", "trigger"] }])).toBe("Until dispelled or triggered");
  });
});
