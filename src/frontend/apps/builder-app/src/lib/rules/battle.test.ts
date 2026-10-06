import { describe, expect, it } from "vitest";
import {
  effectFor,
  effectiveArmorClass,
  effectiveSpeed,
  hitChanceWithDie,
  itemHealing,
  itemRiders,
  average,
  averageGreatWeapon,
  castingAction,
  critical,
  EMPTY_COMBAT,
  expectedDamage,
  findPool,
  formatRoll,
  heal,
  hitChance,
  longRest,
  newTurn,
  parseRoll,
  parseUsage,
  poolFromText,
  regainsOneOnShortRest,
  shortRest,
  spellEffect,
  takeDamage,
} from "./battle";

// spell texts below are written for these tests in the shape of the books' wording, not copied from them
const blastAt = (level: number) => ({ level: 0, description: `<p>Make a ranged spell attack. On a hit it takes 1d10 force damage.</p><p>The spell makes two beams at ${level === 1 ? "5th level" : "level 5"}, three at 11th and four at 17th.</p>` });
const burst = {
  level: 3,
  description:
    "<p>Each creature in the area must make a Dexterity saving throw, taking 8d6 fire damage on a failed save, or half as much damage on a successful one.</p><p><strong>At Higher Levels.</strong> The damage increases by 1d6 for each slot level above 3rd.</p>",
};
const mend = { level: 1, description: "<p>A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier.</p><p>Using a Higher-Level Spell Slot. The healing increases by 2d8 for each spell slot level above 1.</p>" };
const blade = {
  level: 2,
  description: "<p>Make a melee spell attack. On a hit the target takes force damage equal to 1d8 + your spellcasting ability modifier.</p><p>At Higher Levels. The damage increases by 1d8 for every two slot levels above the 2nd.</p>",
};
const firebolt = { level: 0, description: "<p>Make a ranged spell attack, 1d10 fire damage on a hit.</p><p>Cantrip Upgrade. The damage increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10).</p>" };
const darts = { level: 1, description: "<p>You create three glowing darts. Each dart hits and deals 1d4 + 1 force damage.</p><p>At Higher Levels. The spell creates one more dart for each slot level above 1st.</p>" };

describe("dice", () => {
  it("reads damage lines as the sheet writes them", () => {
    expect(parseRoll("1d6+3 slashing")).toEqual({ dice: [{ count: 1, sides: 6 }], bonus: 3, type: "slashing" });
    expect(parseRoll("2d6 + 1d8 - 1 fire")).toEqual({ dice: [{ count: 1, sides: 8 }, { count: 2, sides: 6 }], bonus: -1, type: "fire" });
    expect(parseRoll("1d8+0 piercing")?.bonus).toBe(0);
    expect(parseRoll("nonsense")).toBeNull();
  });

  it("Great Weapon Fighting: 2024 counts 1s and 2s as 3, 2014 rerolls them once", () => {
    const greatsword = parseRoll("2d6+3 slashing")!;
    expect(averageGreatWeapon(greatsword, "2024")).toBeCloseTo(2 * 4 + 3);
    expect(averageGreatWeapon(greatsword, "2014")).toBeCloseTo(2 * (25 / 6) + 3);
  });

  it("averages, doubles dice on a critical hit, and formats", () => {
    const r = parseRoll("2d6+3 slashing")!;
    expect(average(r)).toBe(10);
    expect(formatRoll(critical(r))).toBe("4d6+3 slashing");
    expect(average(critical(r))).toBe(17);
  });
});

describe("hitting", () => {
  it("a 20 always hits and a 1 always misses", () => {
    expect(hitChance(5, 15).hit).toBeCloseTo(0.55);
    expect(hitChance(30, 10).hit).toBeCloseTo(0.95);
    expect(hitChance(-5, 30).hit).toBeCloseTo(0.05);
    expect(hitChance(5, 15, "advantage").hit).toBeCloseTo(1 - 0.45 ** 2);
    expect(hitChance(5, 15, "disadvantage").hit).toBeCloseTo(0.55 ** 2);
  });

  it("expected damage counts critical hits' extra dice", () => {
    const r = parseRoll("1d8+3 piercing")!; // 7.5 average, 12 on a critical hit
    expect(expectedDamage(5, 15, r)).toBeCloseTo(0.5 * 7.5 + 0.05 * 12);
  });
});

describe("spells", () => {
  it("cantrips grow with the character, Eldritch Blast in beams", () => {
    expect(formatRoll(spellEffect(firebolt, 0, 4, 3).damage[0])).toBe("1d10 fire");
    expect(formatRoll(spellEffect(firebolt, 0, 11, 3).damage[0])).toBe("3d10 fire");
    for (const wording of [1, 2]) {
      const e = spellEffect(blastAt(wording), 0, 17, 3);
      expect([formatRoll(e.damage[0]), e.beams, e.attack]).toEqual(["1d10 force", 4, "ranged"]);
    }
  });

  it("saving throw spells and upcasting", () => {
    const at3 = spellEffect(burst, 3, 5, 3);
    expect([at3.save, at3.halfOnSave, formatRoll(at3.damage[0])]).toEqual(["Dexterity", true, "8d6 fire"]);
    expect(formatRoll(spellEffect(burst, 5, 9, 3).damage[0])).toBe("10d6 fire");
  });

  it("healing adds the modifier and its own upcast dice", () => {
    expect(formatRoll(spellEffect(mend, 1, 1, 3).healing!, false)).toBe("2d8+3");
    expect(formatRoll(spellEffect(mend, 3, 5, 3).healing!, false)).toBe("6d8+3");
  });

  it("damage 'equal to' dice plus the modifier, growing every two slot levels", () => {
    expect(formatRoll(spellEffect(blade, 2, 3, 4).damage[0])).toBe("1d8+4 force");
    expect(formatRoll(spellEffect(blade, 3, 5, 4).damage[0])).toBe("1d8+4 force");
    expect(formatRoll(spellEffect(blade, 4, 7, 4).damage[0])).toBe("2d8+4 force");
  });

  it("counts darts, one more per slot level", () => {
    expect(spellEffect(darts, 1, 1, 0).beams).toBe(3);
    expect(spellEffect(darts, 3, 5, 0).beams).toBe(5);
  });

  it("casting times in both editions' wording", () => {
    expect(castingAction("1 action")).toBe("Action");
    expect(castingAction("Action or Ritual")).toBe("Action");
    expect(castingAction("1 bonus action")).toBe("Bonus Action");
    expect(castingAction("Reaction, which you take when you are hit")).toBe("Reaction");
    expect(castingAction("1 minute")).toBe("Other");
  });
});

describe("limited uses and rests", () => {
  const features = [
    { title: "Second Wind", usage: "1/Short Rest" },
    { title: "Channel Divinity", usage: "2/Short Rest" },
    { title: "Turn Undead", usage: "Channel Divinity" },
    { title: "Lucky", usage: "3/Long Rest" },
    { title: "Sneak Attack", usage: "1/Turn" },
    { title: "Wild Form", usage: "1/1d4 Long Rests" },
  ];

  it("reads usage lines", () => {
    expect(parseUsage("2/Long Rest")).toEqual({ kind: "count", max: 2, recharge: "long" });
    expect(parseUsage("1/Short or Long Rest")).toEqual({ kind: "count", max: 1, recharge: "short" });
    expect(parseUsage("1/Day")).toEqual({ kind: "count", max: 1, recharge: "long" });
    expect(parseUsage("1/Turn")).toEqual({ kind: "count", max: 1, recharge: "turn" });
    expect(parseUsage("1/1d4 Long Rests")).toEqual({ kind: "count", max: 1, recharge: "long" });
    expect(parseUsage("Channel Divinity")).toEqual({ kind: "pool", pool: "Channel Divinity" });
    expect(parseUsage("2 Sorcery Points")).toEqual({ kind: "pool", pool: "Sorcery Point", cost: 2 });
    expect(parseUsage("{{unfilled}}/Long Rest")).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(findPool(features, "Channel Divinity")?.title).toBe("Channel Divinity");
  });

  it("damage takes temporary hit points first; healing ends death saves", () => {
    const hurt = takeDamage({ ...EMPTY_COMBAT, temporaryHitPoints: 5 }, 8, 20);
    expect([hurt.temporaryHitPoints, hurt.damage]).toEqual([0, 3]);
    expect(takeDamage(EMPTY_COMBAT, 99, 20).damage).toBe(20);
    expect(heal({ ...EMPTY_COMBAT, damage: 20, deathSaveFailures: 2 }, 4)).toMatchObject({ damage: 16, deathSaveFailures: 0 });
  });

  it("turns, short and long rests give back what they should", () => {
    const used = { ...EMPTY_COMBAT, damage: 12, hitDiceSpent: 3, exhaustion: 2, concentration: "Bless", uses: { "Second Wind": 1, "Channel Divinity": 2, Lucky: 3, "Sneak Attack": 1 } };
    expect(newTurn(used, features).uses).toEqual({ "Second Wind": 1, "Channel Divinity": 2, Lucky: 3 });
    const short = shortRest(used, features, 7, 1);
    expect([short.uses, short.damage, short.hitDiceSpent]).toEqual([{ Lucky: 3 }, 5, 4]);
    const long14 = longRest(used, features, 5, "2014");
    expect([long14.uses, long14.damage, long14.hitDiceSpent, long14.exhaustion, long14.concentration]).toEqual([{}, 0, 1, 1, null]);
    expect(longRest(used, features, 5, "2024").hitDiceSpent).toBe(0);
  });

  it("dice pools, pools stated in a feature's text, and one use back on a short rest", () => {
    expect(parseUsage("4d6/Long Rest")).toEqual({ kind: "count", max: 4, recharge: "long" });
    expect(findPool([{ title: "Psionic Power", usage: "4d6/Long Rest" }], "Psionic Energy Die")?.title).toBe("Psionic Power");
    expect(poolFromText(["You have 4 Sorcery Points. You regain them when you finish a Long Rest."], "Sorcery Point")).toEqual({ max: 4, recharge: "long" });
    expect(poolFromText(["You have four superiority dice, which are d8s. You regain them when you finish a Short or Long Rest."], "Superiority Die")).toEqual({ max: 4, recharge: "short" });
    expect(regainsOneOnShortRest("You regain one expended use when you finish a Short Rest.")).toBe(true);
    expect(regainsOneOnShortRest("You regain all expended uses when you finish a Long Rest.")).toBe(false);
    expect(regainsOneOnShortRest("You regain one expended Channel Divinity use when you finish a Short Rest.")).toBe(true);
    expect(regainsOneOnShortRest("You regain one of your expended Psionic Energy Dice when you finish a Short Rest.")).toBe(true);
    expect(regainsOneOnShortRest("You regain one expended use of your Wild Shape when you finish a Short Rest.")).toBe(true);
    const wind = [{ title: "Second Wind", usage: "3/Long Rest", regainOnShort: true }];
    expect(shortRest({ ...EMPTY_COMBAT, uses: { "Second Wind": 2 } }, wind, 0, 0).uses).toEqual({ "Second Wind": 1 });
    expect(longRest({ ...EMPTY_COMBAT, uses: { "Second Wind": 2 } }, wind, 4, "2024").uses).toEqual({});
  });
});

describe("magic items", () => {
  // item texts below follow the books' wording patterns; they are written for these tests
  it("reads a switch-on power, target-dependent damage, always-on damage and critical-only damage", () => {
    const [ablaze] = itemRiders("<p>While the blade is ablaze, it deals an extra 2d6 fire damage to any target it hits.</p>");
    expect([ablaze.label, formatRoll(ablaze.roll), ablaze.always]).toEqual(["While the blade is ablaze", "2d6 fire", false]);
    const [undead] = itemRiders("<p>When you hit a fiend or an undead with it, that creature takes an extra 2d10 radiant damage.</p>");
    expect([undead.label, formatRoll(undead.roll)]).toEqual(["Against fiend or undead", "2d10 radiant"]);
    const [cold] = itemRiders("<p>When you hit with an attack using this sword, the target takes an extra 1d6 cold damage.</p>");
    expect(cold.always).toBe(true);
    const [slayer] = itemRiders("<p>When you hit a dragon with this weapon, it takes an extra 3d6 damage of the weapon's type.</p>", "slashing");
    expect(formatRoll(slayer.roll)).toBe("3d6 slashing");
    const [vicious] = itemRiders("<p>When you roll a 20 on your attack roll, your critical hit deals an extra 2d6 damage of the weapon's type.</p>", "piercing");
    expect(vicious.critOnly).toBe(true);
  });

  it("reads what a potion heals", () => {
    expect(formatRoll(itemHealing("<p>You regain 2d4 + 2 hit points when you drink this potion.</p>")!, false)).toBe("2d4+2");
    expect(itemHealing("<p>A pleasant smell.</p>")).toBeNull();
  });
});

describe("active effects", () => {
  const ctx = (edition: "2014" | "2024", scores: Record<string, number> = {}) => ({ edition, mod: (a: string) => scores[a] ?? 0, proficiencyBonus: 3, rageDamage: 2 });
  const fx = (keys: string[], edition: "2014" | "2024" = "2024", scores: Record<string, number> = { DEX: 3, INT: 4 }) => keys.map((k) => effectFor(k, ctx(edition, scores))!);
  const unarmored = { total: 13, base: 13, armorKind: null, shield: false }; // 10 + Dex 3
  const chain = { total: 16, base: 16, armorKind: "Heavy", shield: false };
  const leatherShield = { total: 16, base: 11, armorKind: "Light", shield: true }; // 11 + Dex 3 + shield 2

  it("Shield adds 5; Mage Armor makes the base 13 + Dex only without armor", () => {
    expect(effectiveArmorClass(unarmored, fx(["Shield"])).total).toBe(18);
    expect(effectiveArmorClass(unarmored, fx(["Mage Armor"])).total).toBe(16);
    expect(effectiveArmorClass(chain, fx(["Mage Armor"])).total).toBe(16);
    expect(effectiveArmorClass(unarmored, fx(["Mage Armor", "Shield"])).total).toBe(21);
  });

  it("Bladesong adds Intelligence (at least 1) only in light or no armor and without a shield", () => {
    expect(effectiveArmorClass(unarmored, fx(["Bladesong"])).total).toBe(17);
    expect(effectiveArmorClass(leatherShield, fx(["Bladesong"])).total).toBe(16);
    expect(effectiveArmorClass(unarmored, fx(["Bladesong"], "2024", { DEX: 3, INT: -1 })).total).toBe(14);
    expect(effectiveArmorClass(chain, fx(["Bladesong"])).total).toBe(16);
  });

  it("Barkskin sets a floor by edition; Haste and Slow change AC and speed", () => {
    expect(effectiveArmorClass(unarmored, fx(["Barkskin"], "2014")).total).toBe(16);
    expect(effectiveArmorClass(unarmored, fx(["Barkskin"], "2024")).total).toBe(17);
    expect(effectiveArmorClass({ ...chain, total: 19 }, fx(["Barkskin"])).total).toBe(19);
    expect(effectiveArmorClass(chain, fx(["Haste"])).total).toBe(18);
    expect(effectiveSpeed(30, fx(["Haste"]))).toBe(60);
    expect(effectiveSpeed(30, fx(["Slow"]))).toBe(15);
    expect(effectiveSpeed(30, fx(["Bladesong", "Longstrider"]))).toBe(50);
  });

  it("Bless raises the chance to hit by its die; Aid by slot level", () => {
    const plain = hitChanceWithDie(5, 15, "normal", null).hit;
    const blessed = hitChanceWithDie(5, 15, "normal", { sides: 4, sign: 1 }).hit;
    expect(plain).toBeCloseTo(0.55);
    expect(blessed).toBeCloseTo(0.55 + 2.5 * 0.05);
    expect(effectFor("Aid@2", ctx("2024"))!.maxHpBonus).toBe(5);
    expect(effectFor("Aid@4", ctx("2024"))!.maxHpBonus).toBe(15);
    expect(effectFor("Fireball", ctx("2024"))).toBeNull();
  });
});

