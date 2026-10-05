// Made-up entries in the data's shapes (no book text in the repository).
import { describe, expect, it } from "vitest";
import { applyCopy, expandVersions, resolveCopies, resolveVariables, shortName } from "./copy";
import { applyProperties } from "./items";

const problems: string[] = [];
const opts = { problem: (m: string) => problems.push(m) };

describe("copies", () => {
  const original = {
    name: "Stone Brute",
    source: "AAA",
    page: 12,
    cr: "5",
    str: 18,
    wis: 10,
    hp: { average: 50, formula: "10d8" },
    trait: [{ name: "Heavy", entries: ["The brute is heavy. {@b Heavy} things sink."] }],
    action: [
      { name: "Slam", entries: ["{@atk mw} {@hit 5} to hit."] },
      { name: "Throw", entries: ["It throws."] },
    ],
  };

  it("inherits fields, keeps its own, and does not inherit where the original was printed", () => {
    const copy = applyCopy(original, { name: "Amber Brute", source: "BBB", _copy: { name: "Stone Brute", source: "AAA" }, hp: { average: 60, formula: "12d8" } }, opts);
    expect(copy.hp).toEqual({ average: 60, formula: "12d8" });
    expect(copy.str).toBe(18);
    expect(copy.page).toBeUndefined();
    expect(copy._copy).toBeUndefined();
  });

  it("applies the modification modes", () => {
    const copy = applyCopy(
      original,
      {
        name: "Ash Brute",
        source: "BBB",
        _copy: {
          name: "Stone Brute",
          source: "AAA",
          _mod: {
            trait: [{ mode: "replaceTxt", replace: "heavy", with: "light", flags: "i" }, { mode: "insertArr", index: 0, items: { name: "First", entries: ["x"] } }],
            action: [{ mode: "replaceArr", replace: "Slam", items: { name: "Punch", entries: ["y"] } }, { mode: "removeArr", names: "Throw" }],
            _: [{ mode: "addSkills", skills: { perception: 1 } }, { mode: "setProp", prop: "speed.fly", value: 30 }],
          },
        },
      },
      opts,
    );
    expect((copy.trait as { name: string }[]).map((t) => t.name)).toEqual(["First", "Heavy"]);
    // text inside tags is left alone
    expect((copy.trait as { entries: string[] }[])[1].entries[0]).toBe("The brute is light. {@b Heavy} things sink.");
    expect((copy.action as { name: string }[]).map((a) => a.name)).toEqual(["Punch"]);
    expect(copy.skill).toEqual({ perception: "+3" });
    expect(copy.speed).toEqual({ fly: 30 });
  });

  it("resolves copies of copies, reports missing originals, and fills in dynamic text", () => {
    const list = resolveCopies(
      [original, { name: "B", source: "X", _copy: { name: "A2", source: "X" } }, { name: "A2", source: "X", _copy: { name: "Stone Brute", source: "AAA" } }, { name: "C", source: "X", _copy: { name: "Nope", source: "X" } }],
      (e) => `${String(e.name)}|${String(e.source)}`.toLowerCase(),
      opts,
    );
    expect(list[1].str).toBe(18);
    expect(problems.some((p) => p.includes("Nope"))).toBe(true);
    expect(resolveVariables("<$short_name$> hits (DC <$dc__str$>, <$to_hit__str$>)", { name: "Stone Brute", cr: "5", str: 18 })).toBe("the stone brute hits (DC 15, +7)");
    expect(shortName({ name: "Adult Red Dragon" })).toBe("the dragon");
    expect(shortName({ name: "Strahd von Zarovich", isNamedCreature: true })).toBe("Strahd");
  });

  it("expands versions from an abstract and its implementations", () => {
    const versions = expandVersions(
      { ...original, _versions: [{ _abstract: { name: "{{color}} Brute", source: "AAA", _mod: { trait: { mode: "appendArr", items: { name: "{{color}} Skin", entries: [] } } } }, _implementations: [{ _variables: { color: "Red" } }, { _variables: { color: "Blue" } }] }] },
      opts,
    );
    expect(versions.map((v) => v.name)).toEqual(["Red Brute", "Blue Brute"]);
    expect((versions[0].trait as { name: string }[]).at(-1)!.name).toBe("Red Skin");
  });

  it("fills in a magic variant's placeholders", () => {
    expect(applyProperties(["You have a {=bonusWeapon} bonus with this {=baseName/l}, {=baseName/a} weapon."], { bonusWeapon: "+1", baseName: "Axe" })).toEqual(["You have a +1 bonus with this axe, an weapon."]);
  });
});
