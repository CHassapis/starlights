/**
 * What a character is proficient in and the languages it speaks, each with where it comes from, the way Aurora's
 * sheet lists them: a group such as "Martial Weapons" stands for the weapons under it, and a proficiency gained
 * twice (thieves' tools from both Rogue and Criminal) is listed once with both sources.
 */

export interface ProficiencyRegistration {
  registrationId: string;
  name: string;
  type: string;
  associatedElementId: string;
  parentRegistrationId?: string | null;
  children?: ProficiencyRegistration[];
}

export interface ProficiencyEntry {
  name: string;
  elementId: string;
  /** "Rogue", "Elf (Keen Senses)", "Artificer (Artillerist)", an item or extra's name */
  sources: string[];
  /** skills only: expertise (double proficiency) */
  expertise?: boolean;
}

export interface Proficiencies {
  savingThrows: ProficiencyEntry[];
  skills: ProficiencyEntry[];
  armor: ProficiencyEntry[];
  weapons: ProficiencyEntry[];
  tools: ProficiencyEntry[];
  languages: ProficiencyEntry[];
  /** proficiencies of no known kind (vehicles, homebrew) */
  other: ProficiencyEntry[];
}

export const SKILLS = [
  "Acrobatics",
  "Animal Handling",
  "Arcana",
  "Athletics",
  "Deception",
  "History",
  "Insight",
  "Intimidation",
  "Investigation",
  "Medicine",
  "Nature",
  "Perception",
  "Performance",
  "Persuasion",
  "Religion",
  "Sleight of Hand",
  "Stealth",
  "Survival",
];

/** The element types a proficiency is credited to: what the player picked, not the feature in between. */
const OWNERS = new Set(["Species", "Race", "Sub Race", "Class", "Background", "Feat", "Deity"]);
const FEATURES = /Feature$/;

const levelless = (name: string) => name.replace(/^Level \d+:\s*/, "");
// "Armor Proficiency (Light Armor)" -> "Light Armor"
const inner = (name: string) => name.match(/\(([^()]+(?:\([^()]*\))?[^()]*)\)\s*$/)?.[1] ?? name;

export function flattenRegistrations(registrations: ProficiencyRegistration[]): ProficiencyRegistration[] {
  return registrations.flatMap((r) => [r, ...flattenRegistrations(r.children ?? [])]);
}

/**
 * Where a registration comes from: the species, class, background or feat above it, with the subclass or feature
 * in between ("Cleric (Protector)"); an item's or extra's own name when it hangs under nothing.
 */
export function sourceOf(registration: ProficiencyRegistration, byId: Map<string, ProficiencyRegistration>): string {
  const up: ProficiencyRegistration[] = [];
  for (let a = registration.parentRegistrationId ? byId.get(registration.parentRegistrationId) : undefined; a; a = a.parentRegistrationId ? byId.get(a.parentRegistrationId) : undefined) {
    up.push(a);
  }
  const ownerAt = up.findIndex((a) => OWNERS.has(a.type));
  if (ownerAt < 0) {
    // an item or an extra added outside the build: the top of the chain names it
    const root = up.filter((a) => a.type !== "Proficiency").at(-1);
    return root ? levelless(root.name) : "";
  }
  const owner = up[ownerAt];
  const between = up.slice(0, ownerAt).filter((a) => a.type !== "Proficiency");
  const detail = between.find((a) => a.type === "SubClass") ?? between.find((a) => FEATURES.test(a.type));
  return detail ? `${levelless(owner.name)} (${levelless(detail.name)})` : levelless(owner.name);
}

/** By name (the builder's card), or in the order the character gained them (Aurora's sheet). */
export function summarizeProficiencies(registrations: ProficiencyRegistration[], order: "name" | "gained" = "name"): Proficiencies {
  const all = flattenRegistrations(registrations);
  const byId = new Map(all.map((r) => [r.registrationId, r]));
  const groups: Proficiencies = { savingThrows: [], skills: [], armor: [], weapons: [], tools: [], languages: [], other: [] };

  const firstSeen = new Map<ProficiencyEntry, string>();
  function add(list: ProficiencyEntry[], name: string, r: ProficiencyRegistration, expertise = false) {
    const source = sourceOf(r, byId);
    const existing = list.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (r.registrationId < (firstSeen.get(existing) ?? "\uffff")) firstSeen.set(existing, r.registrationId);
      if (source && !existing.sources.includes(source)) existing.sources.push(source);
      if (expertise) existing.expertise = true;
      return;
    }
    const entry: ProficiencyEntry = { name, elementId: r.associatedElementId, sources: source ? [source] : [], ...(expertise ? { expertise: true } : {}) };
    firstSeen.set(entry, r.registrationId);
    list.push(entry);
  }

  for (const r of all) {
    if (r.type === "Language") {
      add(groups.languages, r.name, r);
      continue;
    }
    if (r.type !== "Proficiency") continue;
    // a proficiency inside a group ("Leather" under "Light Armor") is covered by the group
    if (r.parentRegistrationId && byId.get(r.parentRegistrationId)?.type === "Proficiency") continue;

    const name = r.name;
    if (SKILLS.includes(name)) add(groups.skills, name, r);
    else if (/^Skill Expertise\b/.test(name)) add(groups.skills, inner(name), r, true);
    else if (/^Skill Proficiency\b/.test(name)) add(groups.skills, inner(name), r);
    else if (/^Saving ?Throw Proficiency\b/i.test(name)) add(groups.savingThrows, inner(name), r);
    else if (/^Armor Proficiency\b/.test(name)) add(groups.armor, inner(name), r);
    else if (/^Weapon Proficiency\b/.test(name)) add(groups.weapons, inner(name), r);
    else if (/^Tool Proficiency\b/.test(name)) add(groups.tools, inner(name), r);
    else add(groups.other, inner(name), r);
  }

  if (order === "gained") {
    // registration ids are time-ordered (UUIDv7): the first registration of each entry says when it was gained
    const gained = (a: ProficiencyEntry, b: ProficiencyEntry) => (firstSeen.get(a) ?? "").localeCompare(firstSeen.get(b) ?? "");
    for (const list of Object.values(groups)) list.sort(gained);
    return groups;
  }
  const byName = (a: ProficiencyEntry, b: ProficiencyEntry) => a.name.localeCompare(b.name);
  for (const list of Object.values(groups)) list.sort(byName);
  // Common first, as on Aurora's sheet
  groups.languages.sort((a, b) => Number(b.name === "Common") - Number(a.name === "Common") || a.name.localeCompare(b.name));
  return groups;
}
