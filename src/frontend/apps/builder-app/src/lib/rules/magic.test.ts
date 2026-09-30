import { describe, expect, it } from "vitest";
import {
  casterLevelShare,
  EMPTY_MAGIC,
  expendSlot,
  highestSlotLevel,
  isCastable,
  longRest,
  nextLevelSummary,
  pactSlots,
  prepareProblem,
  preparedCount,
  restoreSlot,
  setSpent,
  shortRest,
  spellSlots,
  stalePrepared,
  togglePrepared,
  usesMulticlassTable,
  type Caster,
  type KnownSpell,
  type MagicState,
} from "./magic";

const spell = (name: string, level: number, kind: KnownSpell["kind"]): KnownSpell => ({
  registrationId: `r-${name}`,
  elementId: name,
  name,
  level,
  kind,
  origin: "",
});

function caster(over: Partial<Caster>): Caster {
  return {
    name: "Cleric",
    ability: "Wisdom",
    abilityModifier: 4,
    attack: 7,
    dc: 15,
    attackBonus: 0,
    dcBonus: 0,
    prepares: false,
    knowsWholeList: false,
    spellbook: false,
    allowReplace: false,
    lists: [],
    className: null,
    classLevel: 1,
    multiclass: "Full",
    edition: "2024",
    slots: {},
    pact: null,
    prepareMax: null,
    spells: [],
    preparable: [],
    nextLevel: null,
    ...over,
  };
}

describe("multiclass spell slots", () => {
  it("uses a single class's own table", () => {
    const paladin = caster({ name: "Paladin", multiclass: "Half", classLevel: 5, slots: { 1: 4, 2: 2 } });
    expect(spellSlots([paladin])).toEqual({ 1: 4, 2: 2 });
    expect(usesMulticlassTable([paladin])).toBe(false);
  });

  it("combines two casters on the multiclass table, not by adding their tables", () => {
    // wizard 3 + cleric 2 = caster level 5: 4/3/2 (the class tables added would be 4+3 1st, 2 2nd)
    const wizard = caster({ name: "Wizard", classLevel: 3, slots: { 1: 4, 2: 2 } });
    const cleric = caster({ name: "Cleric", classLevel: 2, slots: { 1: 3 } });
    expect(spellSlots([wizard, cleric])).toEqual({ 1: 4, 2: 3, 3: 2 });
    expect(usesMulticlassTable([wizard, cleric])).toBe(true);
    expect(highestSlotLevel([wizard, cleric])).toBe(3);
  });

  it("rounds half casters down in 2014 and up in 2024", () => {
    expect(casterLevelShare({ multiclass: "Half", classLevel: 5, edition: "2014" })).toBe(2);
    expect(casterLevelShare({ multiclass: "Half", classLevel: 5, edition: "2024" })).toBe(3);
    expect(casterLevelShare({ multiclass: "HalfUp", classLevel: 3, edition: "2014" })).toBe(2);
    expect(casterLevelShare({ multiclass: "Third", classLevel: 8, edition: "2024" })).toBe(2);
    expect(casterLevelShare({ multiclass: "Solo", classLevel: 5, edition: "2024" })).toBe(0);
    expect(casterLevelShare({ multiclass: null, classLevel: 5, edition: "2024" })).toBe(0);
    // paladin 3 (2014) + sorcerer 1: caster level 1 + 1 = 2 -> three 1st-level slots
    const paladin = caster({ name: "Paladin", multiclass: "Half", edition: "2014", classLevel: 3, slots: { 1: 3 } });
    const sorcerer = caster({ name: "Sorcerer", classLevel: 1, slots: { 1: 2 } });
    expect(spellSlots([paladin, sorcerer])).toEqual({ 1: 3 });
    // the same in 2024: 2 + 1 = 3 -> 4/2
    expect(spellSlots([{ ...paladin, edition: "2024" }, sorcerer])).toEqual({ 1: 4, 2: 2 });
  });

  it("keeps pact magic apart", () => {
    const warlock = caster({ name: "Warlock", multiclass: "Solo", classLevel: 5, pact: { level: 3, count: 2 } });
    const sorcerer = caster({ name: "Sorcerer", classLevel: 3, slots: { 1: 4, 2: 2 } });
    expect(spellSlots([warlock, sorcerer])).toEqual({ 1: 4, 2: 2 });
    expect(usesMulticlassTable([warlock, sorcerer])).toBe(false);
    expect(pactSlots([warlock, sorcerer])).toEqual({ level: 3, count: 2 });
    expect(highestSlotLevel([warlock])).toBe(3);
  });

  it("adds a homebrew spellcasting's own slots", () => {
    const vesper = caster({ name: "Dead Three", multiclass: null, classLevel: 3, slots: { 1: 2 } });
    expect(spellSlots([vesper])).toEqual({ 1: 2 });
    const wizard = caster({ name: "Wizard", classLevel: 1, slots: { 1: 2 } });
    const cleric = caster({ name: "Cleric", classLevel: 1, slots: { 1: 2 } });
    expect(spellSlots([wizard, cleric, vesper])).toEqual({ 1: 5 });
  });
});

describe("preparing spells", () => {
  const cleric = caster({
    prepares: true,
    knowsWholeList: true,
    prepareMax: 2,
    spells: [spell("Guidance", 0, "cantrip"), spell("False Life", 1, "always")],
    preparable: ["Bless", "Aid", "Command"],
  });

  it("counts chosen spells against the limit, never the always-prepared ones", () => {
    let state: MagicState = { ...EMPTY_MAGIC, prepared: { Cleric: ["False Life"] } };
    expect(preparedCount(cleric, state)).toEqual({ count: 0, max: 2 });
    state = togglePrepared(cleric, state, "Bless");
    state = togglePrepared(cleric, state, "Aid");
    expect(preparedCount(cleric, state)).toEqual({ count: 2, max: 2 });
    expect(prepareProblem(cleric, state, "Command")).toMatch(/most/);
    expect(togglePrepared(cleric, state, "Command")).toBe(state);
    // unpreparing is always allowed
    state = togglePrepared(cleric, state, "Aid");
    expect(preparedCount(cleric, state).count).toBe(1);
    expect(prepareProblem(cleric, state, "Command")).toBeNull();
  });

  it("only prepares what the list or spellbook allows", () => {
    expect(prepareProblem(cleric, EMPTY_MAGIC, "Fireball")).toMatch(/can prepare/);
    expect(prepareProblem(cleric, EMPTY_MAGIC, "False Life")).toBe("Always prepared.");
    const wizard = caster({ name: "Wizard", prepares: true, spellbook: true, prepareMax: 4, preparable: ["Shield"] });
    expect(prepareProblem(wizard, EMPTY_MAGIC, "Sleep")).toMatch(/spellbook/);
    const sorcerer = caster({ name: "Sorcerer" });
    expect(prepareProblem(sorcerer, EMPTY_MAGIC, "Shield")).toMatch(/known/);
  });

  it("keeps a prepared spell that no longer fits, and says so", () => {
    const state = { ...EMPTY_MAGIC, prepared: { Cleric: ["Bless", "Revivify"] } };
    expect(stalePrepared(cleric, state)).toEqual(["Revivify"]);
    expect(preparedCount(cleric, state).count).toBe(2);
  });

  it("knows what can be cast", () => {
    const state = { ...EMPTY_MAGIC, prepared: { Cleric: ["Bless"] } };
    expect(isCastable(cleric, state, spell("Guidance", 0, "cantrip"))).toBe(true);
    expect(isCastable(cleric, state, spell("False Life", 1, "always"))).toBe(true);
    const wizard = caster({ name: "Wizard", prepares: true, spellbook: true, prepareMax: 4, preparable: ["Shield", "Sleep"] });
    const wizardState = { ...EMPTY_MAGIC, prepared: { Wizard: ["Shield"] } };
    expect(isCastable(wizard, wizardState, spell("Shield", 1, "spellbook"))).toBe(true);
    expect(isCastable(wizard, wizardState, spell("Sleep", 1, "spellbook"))).toBe(false);
  });
});

describe("spending slots", () => {
  it("spends and gets back slots within the total", () => {
    let state = expendSlot(EMPTY_MAGIC, 1, 2);
    state = expendSlot(state, 1, 2);
    expect(expendSlot(state, 1, 2)).toBe(state);
    expect(state.expendedSlots).toEqual({ 1: 2 });
    state = restoreSlot(restoreSlot(state, 1), 1);
    expect(state.expendedSlots).toEqual({});
    expect(restoreSlot(state, 1)).toBe(state);
    expect(setSpent(EMPTY_MAGIC, 2, 9, 3).expendedSlots).toEqual({ 2: 3 });
  });

  it("gets slots back on rests: all on a long rest, pact slots on a short one", () => {
    const state: MagicState = { ...EMPTY_MAGIC, expendedSlots: { 1: 2, 3: 1 }, expendedPactSlots: 2 };
    expect(shortRest(state)).toEqual({ ...state, expendedPactSlots: 0 });
    expect(longRest(state)).toEqual({ ...state, expendedSlots: {}, expendedPactSlots: 0 });
  });
});

describe("the next level", () => {
  it("says what the next level brings", () => {
    const sorcerer = caster({ nextLevel: { level: 5, slots: { 3: 2 }, prepare: 1, choices: ["Spell (Sorcerer) ×2"] } });
    expect(nextLevelSummary(sorcerer)).toEqual(["2 3rd-level slots", "1 more prepared spell", "Spell (Sorcerer) ×2"]);
    expect(nextLevelSummary(caster({ nextLevel: { level: 3, slots: { 1: 1 }, prepare: 0, choices: [] } }))).toEqual(["a 1st-level slot"]);
    expect(nextLevelSummary(caster({}))).toEqual([]);
  });
});
