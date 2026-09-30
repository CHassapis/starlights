import { describe, expect, it } from "vitest";
import { summarizeProficiencies, type ProficiencyRegistration } from "./proficiencies";

let n = 0;
function reg(name: string, type: string, parent?: ProficiencyRegistration): ProficiencyRegistration {
  n++;
  return { registrationId: `r${n}`, name, type, associatedElementId: `e-${name}`, parentRegistrationId: parent?.registrationId ?? null };
}

/** Elorin's shape: an elf rogue with the criminal background, and a Phantom's feature. */
function elorin() {
  const creation = reg("Standard Character", "Character Creation");
  const origin = reg("Origin Selection", "Rule", creation);
  const elf = reg("Elf", "Species", origin);
  const keen = reg("Keen Senses", "Species Feature", elf);
  const rogue = reg("Rogue", "Class", reg("Class Selection", "Rule", creation));
  const cant = reg("Level 1: Thieves’ Cant", "Class Feature", rogue);
  const expertise = reg("Level 1: Expertise", "Class Feature", rogue);
  const archetype = reg("Level 3: Roguish Archetype", "Class Feature", rogue);
  const phantom = reg("Phantom", "SubClass", archetype);
  const whispers = reg("Whispers of the Dead", "Archetype Feature", phantom);
  const criminal = reg("Criminal", "Background", origin);
  const simple = reg("Weapon Proficiency (Simple Weapons)", "Proficiency", rogue);
  const simpleMelee = reg("Weapon Proficiency (Simple Melee Weapons)", "Proficiency", simple);
  const light = reg("Armor Proficiency (Light Armor)", "Proficiency", rogue);
  return [
    creation, origin, elf, keen, rogue, cant, expertise, archetype, phantom, whispers, criminal, simple, simpleMelee, light,
    reg("Weapon Proficiency (Dagger)", "Proficiency", simpleMelee),
    reg("Armor Proficiency (Leather)", "Proficiency", light),
    reg("Weapon Proficiency (Rapier)", "Proficiency", rogue),
    reg("Tool Proficiency (Thieves’ tools)", "Proficiency", rogue),
    reg("Tool Proficiency (Thieves’ tools)", "Proficiency", criminal),
    reg("Survival", "Proficiency", keen),
    reg("Stealth", "Proficiency", criminal),
    reg("Skill Expertise (Stealth)", "Proficiency", expertise),
    reg("Persuasion", "Proficiency", whispers),
    reg("Saving Throw Proficiency (Dexterity)", "Proficiency", rogue),
    reg("Elvish", "Language", elf),
    reg("Common", "Language", elf),
    reg("Thieves’ Cant", "Language", cant),
  ];
}

describe("proficiencies and languages", () => {
  it("lists groups, not what is inside them", () => {
    const p = summarizeProficiencies(elorin());
    expect(p.weapons.map((w) => w.name)).toEqual(["Rapier", "Simple Weapons"]);
    expect(p.armor.map((a) => a.name)).toEqual(["Light Armor"]);
  });

  it("says where each comes from, once per name", () => {
    const p = summarizeProficiencies(elorin());
    expect(p.tools).toEqual([{ name: "Thieves’ tools", elementId: "e-Tool Proficiency (Thieves’ tools)", sources: ["Rogue", "Criminal"] }]);
    expect(p.languages.map((l) => [l.name, l.sources])).toEqual([
      ["Common", ["Elf"]],
      ["Elvish", ["Elf"]],
      ["Thieves’ Cant", ["Rogue (Thieves’ Cant)"]],
    ]);
    expect(p.skills.find((s) => s.name === "Survival")?.sources).toEqual(["Elf (Keen Senses)"]);
    expect(p.skills.find((s) => s.name === "Persuasion")?.sources).toEqual(["Rogue (Phantom)"]);
    expect(p.savingThrows.map((s) => s.name)).toEqual(["Dexterity"]);
  });

  it("marks expertise on the skill", () => {
    const stealth = summarizeProficiencies(elorin()).skills.find((s) => s.name === "Stealth");
    expect(stealth).toMatchObject({ expertise: true, sources: ["Criminal", "Rogue (Expertise)"] });
  });

  it("credits a feat, even one taken at a class level, and an item by its name", () => {
    const rogue = reg("Rogue", "Class");
    const linguist = reg("Linguist", "Feat", reg("Level 4: Ability Score Improvement", "Class Feature", rogue));
    const cap = reg("Helm of Comprehending Languages", "Magic Item");
    const p = summarizeProficiencies([rogue, linguist, cap, reg("Dwarvish", "Language", linguist), reg("Tool Proficiency (Navigator’s tools)", "Proficiency", cap)]);
    expect(p.languages[0].sources).toEqual(["Linguist"]);
    expect(p.tools[0].sources).toEqual(["Helm of Comprehending Languages"]);
  });

  it("reads names with brackets inside", () => {
    const fighter = reg("Fighter", "Class");
    const p = summarizeProficiencies([fighter, reg("Weapon Proficiency (Rifle, Hunting)", "Proficiency", fighter), reg("Tool Proficiency (Gaming Set (Dice))", "Proficiency", fighter)]);
    expect(p.weapons.map((w) => w.name)).toEqual(["Rifle, Hunting"]);
    expect(p.tools.map((t) => t.name)).toEqual(["Gaming Set (Dice)"]);
  });
});
