import { describe, expect, it } from "vitest";
import { attackRoll, failChanceWith, health, inOrder, monsterStats, nextTurn, proficiencyOf, targetSave, type Fight } from "./encounter";

const roll = (target: string[], o: Partial<Parameters<typeof attackRoll>[0]> = {}) =>
  attackRoll({ melee: true, within5: true, manual: "normal", ownDisadvantage: [], ownInvisible: false, target, ...o });

describe("attackRoll", () => {
  it("gives advantage against a Restrained or Faerie Fire-lit target, nothing for a Frightened one", () => {
    expect(roll(["Restrained"]).advantage).toBe("advantage");
    expect(roll(["Faerie Fire"]).advantage).toBe("advantage");
    expect(roll(["Frightened"]).advantage).toBe("normal");
    expect(roll(["Poisoned", "Charmed", "Grappled"]).advantage).toBe("normal");
  });

  it("Prone: advantage within 5 ft, disadvantage from farther away", () => {
    expect(roll(["Prone"]).advantage).toBe("advantage");
    expect(roll(["Prone"], { within5: false, melee: false }).advantage).toBe("disadvantage");
  });

  it("one advantage and one disadvantage make a normal roll", () => {
    const r = roll(["Restrained"], { ownDisadvantage: ["Poisoned"] });
    expect(r.advantage).toBe("normal");
    expect(r.for).toHaveLength(1);
    expect(r.against).toHaveLength(1);
  });

  it("Faerie Fire cancels Invisible; Dodging gives disadvantage", () => {
    expect(roll(["Invisible"]).advantage).toBe("disadvantage");
    expect(roll(["Invisible", "Faerie Fire"]).advantage).toBe("advantage");
    expect(roll(["Dodging"]).advantage).toBe("disadvantage");
  });

  it("hits within 5 ft on a Paralyzed or Unconscious target are critical", () => {
    expect(roll(["Paralyzed"]).autoCrit).toBe(true);
    expect(roll(["Paralyzed"], { within5: false, melee: false }).autoCrit).toBe(false);
  });

  it("a ranged attack with the target next to you has disadvantage, unless it is incapacitated", () => {
    expect(roll([], { melee: false, within5: true }).advantage).toBe("disadvantage");
    expect(roll(["Stunned"], { melee: false, within5: true }).advantage).toBe("advantage");
  });
});

describe("targetSave", () => {
  it("Paralyzed, Stunned, Unconscious and Petrified fail Strength and Dexterity saves", () => {
    expect(targetSave(["Stunned"], "Dexterity").autoFail).toBe(true);
    expect(targetSave(["Stunned"], "Wisdom").autoFail).toBe(false);
  });

  it("Restrained has disadvantage on Dexterity saves", () => {
    expect(targetSave(["Restrained"], "Dexterity").advantage).toBe("disadvantage");
    expect(targetSave(["Restrained"], "Constitution").advantage).toBe("normal");
  });

  it("fail chances with advantage and disadvantage", () => {
    expect(failChanceWith(15, 2, "normal")).toBeCloseTo(0.6);
    expect(failChanceWith(15, 2, "disadvantage")).toBeCloseTo(1 - 0.4 * 0.4);
  });
});

describe("turns", () => {
  const fight: Fight = {
    revision: 0,
    active: true,
    round: 1,
    turn: null,
    shareStats: false,
    combatants: [
      { id: "a", kind: "pc", name: "Ash", initiative: 12, conditions: [] },
      { id: "g", kind: "monster", name: "Goblin", initiative: 18, conditions: [{ name: "Dodging" }] },
    ],
  };

  it("goes in initiative order and starts a new round after the last", () => {
    expect(inOrder(fight.combatants).map((c) => c.id)).toEqual(["g", "a"]);
    const first = nextTurn(fight);
    expect(first.turn).toBe("g");
    expect(first.combatants[1].conditions).toEqual([]);
    const second = nextTurn(first);
    expect([second.turn, second.round]).toEqual(["a", 1]);
    expect([nextTurn(second).turn, nextTurn(second).round]).toEqual(["g", 2]);
  });

  it("health in words", () => {
    expect([health(7, 7), health(4, 7), health(3, 7), health(0, 7)]).toEqual(["unhurt", "hurt", "bloodied", "down"]);
  });
});

describe("monsterStats", () => {
  it("reads hit points, armor class, initiative and saves from a stat block", () => {
    const goblin = { hp: { average: 7, formula: "2d6" }, ac: [{ ac: 15, from: ["leather armor", "shield"] }], dex: 14, wis: 8, cr: "1/4" };
    expect(monsterStats(goblin)).toMatchObject({ hp: 7, ac: 15, initiativeBonus: 2 });
    expect(monsterStats(goblin).saves.wis).toBe(-1);
    const dragon = { hp: { average: 256 }, ac: [19], dex: 10, cr: "17", initiative: { proficiency: 2 }, save: { dex: "+6" } };
    expect(monsterStats(dragon)).toMatchObject({ ac: 19, initiativeBonus: 12 });
    expect(monsterStats(dragon).saves.dex).toBe(6);
    expect(proficiencyOf("5")).toBe(3);
  });
});
