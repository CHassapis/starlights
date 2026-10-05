import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { BuilderChoice } from "@/lib/api/builder";
import { useItemCatalog } from "@/lib/api/items";
import { useSpellIndex } from "@/lib/api/magic";
import type { CharacterFacts, Inventory } from "@/lib/rules/items";
import { EMPTY_MAGIC, type KnownSpell, type MagicState, type Spellcasting } from "@/lib/rules/magic";
import { summarizeProficiencies, type Proficiencies } from "@/lib/rules/proficiencies";
import {
  sheetArmor,
  sheetAttackLines,
  sheetEquipment,
  sheetItemCards,
  sheetSpellPages,
  type ItemText,
  type SheetArmor,
  type SheetAttackLine,
  type SheetEquipment,
  type SheetItemCard,
  type SheetSpellPage,
} from "@/lib/sheet-model";

interface AbilityScore {
  abilityScoreId: string;
  name: string;
  abbreviation: string;
  baseScore: number;
  additionalScore: number;
  calculatedScore: number;
  calculatedModifier: number;
}
interface Bonus {
  name: string;
  abilityScoreAbbreviation: string;
  abilityScoreModifier: number;
  additionalBonus: number;
  calculatedBonus: number;
}
interface Registration {
  registrationId: string;
  name: string;
  type: string;
  associatedElementId: string;
  parentRegistrationId?: string;
  children?: Registration[];
}
interface StatisticGroup {
  groupName: string;
  totalValue: number;
}
interface BatchEntry {
  id: string;
  auroraId?: string | null;
  name: string;
  type: string;
  source: string | null;
  description: string;
  setters: Record<string, string>;
  spellcasting: { name: string; ability: string } | null;
  sheet: { display: boolean; alt: string | null; action: string | null; usage: string | null; descriptions: { level: number; usage: string | null; text: string }[] } | null;
}

export type Proficiency = "none" | "proficient" | "expertise";

export interface Defenses {
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
}

export interface SheetFeature {
  title: string;
  action?: string | null;
  usage?: string | null;
  text: string;
}

export interface SheetSpell {
  name: string;
  level: number;
  school: string;
  time: string;
  range: string;
  duration: string;
  components: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  origin: string;
  source: string;
}

export interface SheetSpellcasting {
  name: string;
  ability: string;
  attackBonus: number;
  saveDc: number;
  prepare: number | null;
  slots: Record<number, number>;
  spells: SheetSpell[];
}

export interface SheetData {
  name: string;
  player: string;
  portraitUrl?: string | null;
  level: number;
  classLine: string;
  background: string;
  alignment: string;
  deity: string;
  /** the (first) subclass, e.g. "Death Domain" */
  subclass: string;
  proficiencyBonus: number;
  abilities: AbilityScore[];
  saves: (Bonus & { proficiency: Proficiency })[];
  skills: (Bonus & { proficiency: Proficiency })[];
  passivePerception: number;
  initiative: number;
  speeds: { walk: number; fly: number; climb: number; swim: number };
  vision: string[];
  armorClass: number;
  armor: SheetArmor;
  attacks: SheetAttackLine[];
  equipment: SheetEquipment;
  itemCards: SheetItemCard[];
  spellPages: SheetSpellPage[];
  /** the character's own spells for the spell cards (not the whole class list) */
  cardSpells: SheetSpell[];
  proficiencySummary: Proficiencies;
  /** the same in the order the character gained them, for the sheet's box */
  proficienciesInOrder: Proficiencies;
  /** attacks in one Attack action: 2 with Extra Attack, more for a high-level fighter */
  attacksPerAction: number;
  /** damage resistances, immunities and vulnerabilities, for the sheet's box */
  defenses: Defenses;
  hitDice: string;
  /** the primary class's hit die (8 for a d8), for short rests */
  hitDie: number | null;
  /** the rules the primary class comes from: 2024 for a revised Player's Handbook class, else 2014 */
  edition: "2014" | "2024";
  hitPoints: number | null;
  proficiencies: { armor: string[]; weapons: string[]; tools: string[] };
  languages: string[];
  speciesTraits: SheetFeature[];
  features: SheetFeature[];
  backgroundFeature: SheetFeature | null;
  spellcasting: SheetSpellcasting[];
  otherSpells: SheetSpell[];
  story: Record<string, string>;
}

const ABILITY_NAMES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];

const FEATURE_TYPES = new Set(["Class Feature", "Archetype Feature", "Feat", "Feat Feature"]);

function flatten(registrations: Registration[]): Registration[] {
  return registrations.flatMap((r) => [r, ...flatten(r.children ?? [])]);
}

function proficiencyOf(bonus: Bonus, proficiencyBonus: number): Proficiency {
  if (proficiencyBonus > 0 && bonus.additionalBonus >= proficiencyBonus * 2) return "expertise";
  return proficiencyBonus > 0 && bonus.additionalBonus >= proficiencyBonus ? "proficient" : "none";
}

// "Armor Proficiency (Light Armor)" -> "Light Armor"
const inner = (name: string) => name.match(/\(([^)]+)\)\s*$/)?.[1] ?? name;
const unique = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));

/**
 * Maximum hit points: the hit die at level 1, then Aurora's rolls for the levels after when the character came from
 * Aurora with them (its level elements' rndhp, kept by the importer), otherwise the fixed average; the Constitution
 * modifier each level, and bonuses such as Draconic Resilience (the "hp" statistic).
 */
export function hitPointsFor(hitDie: number, level: number, con: number, bonus: number, rolls?: string): number {
  const rolled = (rolls ?? "").split(",").map((r) => Number(r.trim())).filter((n) => n > 0);
  const dice = rolled.length >= level ? rolled.slice(0, level).reduce((a, b) => a + b, 0) : hitDie + (level - 1) * (hitDie / 2 + 1);
  return dice + level * con + bonus;
}

/** Aurora statistic names to the Starlights convention (same as the importer). */
function statisticName(auroraName: string): string {
  let name = auroraName.trim().toLowerCase();
  name = name.replace(/^(strength|dexterity|constitution|intelligence|wisdom|charisma):save\b/, "$1-saving-throw").replace(/ /g, "-");
  return name.replace(/^level:(?!half\b)([a-z][a-z-]*)(:.*)?$/, "$1:level$2");
}

function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
export const spellLevelLine = (s: SheetSpell) =>
  s.level === 0 ? `${s.school} Cantrip` : `${ORDINAL[s.level]}-level ${s.school.toLowerCase()}${s.ritual ? " (ritual)" : ""}`;

/**
 * Everything the classic character sheet shows. What the engine does not calculate yet is worked out here:
 * hit points (hit die from the class's Aurora setters), unarmored AC, initiative and passive perception; the
 * {{statistic}} placeholders in Aurora's sheet texts are filled from the character's statistics.
 */
export function useSheetData(characterId: string): { data?: SheetData; isLoading: boolean; error: Error | null } {
  const base = `/api/characters/${characterId}`;
  const q = <T,>(key: string, url: string) => useQuery({ queryKey: ["sheet", characterId, key], queryFn: () => apiClient.get<T>(url) });
  const details = q<{ character: { name: string; level: number; portraitUrl?: string; playerName?: string } }>("details", base);
  const abilities = q<{ abilityScores: AbilityScore[] }>("abilities", `${base}/ability-scores`);
  const saves = q<{ savingThrows: Bonus[] }>("saves", `${base}/saving-throws`);
  const skills = q<{ skills: Bonus[] }>("skills", `${base}/skills`);
  const stats = q<{ statistics: StatisticGroup[] }>("statistics", `${base}/statistics`);
  const registrations = q<{ registrations: Registration[] }>("registrations", `${base}/registrations`);
  const classes = q<{ classes: { name: string; level: number; isPrimary: boolean; registrationId: string }[] }>("classes", `${base}/classes`);
  const choices = q<{ choices: BuilderChoice[] }>("choices", `${base}/builder/choices`);
  const story = q<{ fields: Record<string, string> }>("story", `${base}/story`);
  const inventory = q<Inventory>("inventory", `${base}/inventory`);
  const casting = q<Spellcasting>("spellcasting", `${base}/spellcasting`);
  const magic = q<MagicState>("magic", `${base}/magic`);
  const defenses = q<Defenses>("defenses", `${base}/defenses`);
  const catalog = useItemCatalog();
  const spellIndex = useSpellIndex();

  const all = flatten(registrations.data?.registrations ?? []);
  const elementIds = unique(all.map((r) => r.associatedElementId));
  const batch = useQuery({
    queryKey: ["sheet", characterId, "elements", elementIds.join(",")],
    queryFn: () => apiClient.get<{ entries: BatchEntry[] }>(`/api/elements/compendium/batch?ids=${elementIds.join(",")}`),
    enabled: elementIds.length > 0,
  });

  // the items' and prepared spells' own texts, for item cards, descriptions and spell cards
  const textIds = unique([
    ...(inventory.data?.items ?? []).flatMap((e) => [e.elementId ?? "", e.baseElementId ?? ""]),
    ...Object.values(magic.data?.prepared ?? {}).flat(),
  ].filter((id) => id && !elementIds.includes(id)));
  const texts = useQuery({
    queryKey: ["sheet", characterId, "texts", textIds.join(",")],
    queryFn: () => apiClient.get<{ entries: BatchEntry[] }>(`/api/elements/compendium/batch?ids=${textIds.join(",")}`),
    enabled: textIds.length > 0,
  });

  const parts = [details, abilities, saves, skills, stats, registrations, classes, choices, story, batch, inventory, casting, magic, catalog, spellIndex, ...(textIds.length ? [texts] : [])];
  const error = parts.find((p) => p.error)?.error ?? null;
  const isLoading = parts.some((p) => p.isLoading);
  if (isLoading || error || !details.data || !abilities.data || !saves.data || !skills.data || !stats.data || !batch.data || !inventory.data || !casting.data || !catalog.data)
    return { isLoading, error };

  const entries = new Map(batch.data.entries.map((e) => [e.id, e]));
  const statistics = new Map(stats.data.statistics.map((s) => [s.groupName, s.totalValue]));
  const stat = (name: string) => statistics.get(name);
  const proficiencyBonus = stat("proficiency") ?? 2;
  const mod = (abbreviation: string) => abilities.data.abilityScores.find((a) => a.abbreviation === abbreviation)?.calculatedModifier ?? 0;
  const top = (section: string) => choices.data?.choices.find((c) => c.section === section && c.depth === 0)?.selected?.name ?? "";
  const level = details.data.character.level || 1;
  const byRegistration = new Map(all.map((r) => [r.registrationId, r]));

  // spellcasting: every registered element that carries Aurora's <spellcasting> (a class's or subclass's feature)
  const casters = all
    .map((r) => ({ registration: r, entry: entries.get(r.associatedElementId) }))
    .filter((c) => c.entry?.spellcasting)
    .map(({ registration, entry }) => {
      const name = entry!.spellcasting!.name;
      const slug = statisticName(name);
      const castingMod = mod(entry!.spellcasting!.ability.slice(0, 3).toUpperCase());
      const slots: Record<number, number> = {};
      for (let l = 1; l <= 9; l++) {
        const n = stat(`${slug}:spellcasting:slots:${l}`);
        if (n) slots[l] = n;
      }
      return {
        registrationId: registration.registrationId,
        casting: {
          name,
          ability: entry!.spellcasting!.ability,
          attackBonus: proficiencyBonus + castingMod,
          saveDc: 8 + proficiencyBonus + castingMod,
          prepare: stat(`${slug}:spellcasting:prepare`) ?? null,
          slots,
          spells: [] as SheetSpell[],
        } satisfies SheetSpellcasting,
      };
    });

  // placeholders in sheet texts: statistics, plus the spellcasting numbers the engine does not calculate
  function fill(text: string): string {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, raw: string) => {
      const name = statisticName(raw);
      const caster = casters.find((c) => name.startsWith(`${statisticName(c.casting.name)}:spellcasting:`));
      if (caster && name.endsWith(":dc")) return String(caster.casting.saveDc);
      if (caster && name.endsWith(":attack")) return `+${caster.casting.attackBonus}`;
      if (name === "proficiency") return String(proficiencyBonus);
      const value = stat(name);
      return value === undefined ? "" : String(value);
    });
  }

  function feature(r: Registration): SheetFeature | null {
    const entry = entries.get(r.associatedElementId);
    if (entry?.sheet && !entry.sheet.display) return null;
    const described = entry?.sheet?.descriptions.filter((d) => d.level <= level).sort((a, b) => b.level - a.level)[0];
    const text = described?.text ?? plainText(entry?.description ?? "").slice(0, 600);
    return {
      title: entry?.sheet?.alt ?? r.name.replace(/^Level \d+: /, ""),
      action: entry?.sheet?.action,
      usage: described?.usage ? fill(described.usage) : entry?.sheet?.usage ? fill(entry.sheet.usage) : null,
      text: fill(text),
    };
  }

  function spell(r: Registration): SheetSpell | null {
    const entry = entries.get(r.associatedElementId);
    if (!entry) return null;
    const parent = r.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined;
    return spellFromEntry(entry, parent?.name ?? "");
  }

  function spellFromEntry(entry: BatchEntry, origin: string): SheetSpell {
    const s = entry.setters;
    const components = [s.hasVerbalComponent === "true" && "V", s.hasSomaticComponent === "true" && "S", s.hasMaterialComponent === "true" && `M (${s.materialComponent ?? "…"})`]
      .filter(Boolean)
      .join(", ");
    return {
      name: entry.name,
      level: Number(s.level) || 0,
      school: s.school ?? "",
      time: s.time ?? "",
      range: s.range ?? "",
      duration: s.duration ?? "",
      components,
      concentration: s.isConcentration === "true",
      ritual: s.isRitual === "true",
      description: entry.description,
      origin,
      source: entry.source ?? "",
    };
  }

  // a spell belongs to the spellcasting whose feature (or the class/subclass above it) it hangs under
  const otherSpells: SheetSpell[] = [];
  for (const r of all.filter((r) => r.type === "Spell")) {
    const s = spell(r);
    if (!s) continue;
    let owner: (typeof casters)[number] | undefined;
    for (let a = r.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined; a && !owner; a = a.parentRegistrationId ? byRegistration.get(a.parentRegistrationId) : undefined) {
      owner = casters.find((c) => c.registrationId === a!.registrationId) ?? (a.type === "Class" || a.type === "SubClass" ? casters.find((c) => isUnder(c.registrationId, a!.registrationId)) : undefined);
    }
    // where it comes from, the way Aurora labels it: "Level 1: Spellcasting (Cleric)", "Wisdom (High Elf)"
    const parent = r.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined;
    const grandparent = parent?.parentRegistrationId ? byRegistration.get(parent.parentRegistrationId) : undefined;
    if (owner && s.origin && !s.origin.includes(owner.casting.name)) s.origin = `${s.origin} (${owner.casting.name})`;
    else if (!owner && grandparent && ABILITY_NAMES.includes(s.origin)) s.origin = `${s.origin} (${grandparent.name})`;
    (owner ? owner.casting.spells : otherSpells).push(s);
  }
  function isUnder(registrationId: string, ancestorId: string): boolean {
    for (let a = byRegistration.get(registrationId); a; a = a.parentRegistrationId ? byRegistration.get(a.parentRegistrationId) : undefined) {
      if (a.registrationId === ancestorId) return true;
    }
    return false;
  }

  // proficiency and expertise from what the character has, not from the size of a bonus (a cleric Thaumaturge's
  // Wisdom on Arcana checks is no proficiency)
  const owned = summarizeProficiencies(registrations.data?.registrations ?? []);
  const skillOwned = new Map(owned.skills.map((x) => [x.name.toLowerCase(), x]));
  const saveOwned = new Set(owned.savingThrows.map((x) => x.name.toLowerCase()));
  const skillProficiency = (b: Bonus): Proficiency => {
    const own = skillOwned.get(b.name.toLowerCase());
    return own ? (own.expertise ? "expertise" : "proficient") : registrations.data ? "none" : proficiencyOf(b, proficiencyBonus);
  };
  const saveProficiency = (b: Bonus): Proficiency => {
    const ability = ABILITY_NAMES.find((a) => a.slice(0, 3).toUpperCase() === b.abilityScoreAbbreviation) ?? b.name;
    return saveOwned.has(ability.toLowerCase()) ? "proficient" : registrations.data ? "none" : proficiencyOf(b, proficiencyBonus);
  };
  const skillList = skills.data.skills.map((s) => ({ ...s, proficiency: skillProficiency(s) }));
  const perception = skillList.find((s) => s.name === "Perception")?.calculatedBonus ?? mod("WIS");

  const primary = classes.data?.classes.find((c) => c.isPrimary) ?? classes.data?.classes[0];
  const classEntry = entries.get(all.find((r) => r.registrationId === primary?.registrationId)?.associatedElementId ?? "");
  const subclass = all.find((r) => r.type === "SubClass")?.name;
  const hitDie = Number(classEntry?.setters.hd?.replace(/\D/g, "")) || null;
  const con = mod("CON");

  const proficiencies = { armor: [] as string[], weapons: [] as string[], tools: [] as string[] };
  // "Martial Weapons" grants every martial weapon; the sheet lists the group, like Aurora
  const underGroup = (r: Registration) => byRegistration.get(r.parentRegistrationId ?? "")?.type === "Proficiency";
  for (const r of all.filter((r) => r.type === "Proficiency" && !underGroup(r))) {
    if (r.name.startsWith("Armor Proficiency")) proficiencies.armor.push(inner(r.name));
    else if (r.name.startsWith("Weapon Proficiency")) proficiencies.weapons.push(inner(r.name));
    else if (r.name.startsWith("Tool Proficiency")) proficiencies.tools.push(inner(r.name));
  }

  const featureList = (types: (t: string) => boolean) =>
    all.filter((r) => types(r.type)).map(feature).filter((f): f is SheetFeature => f !== null);
  const seen = new Set<string>();
  const dedupe = (list: SheetFeature[]) => list.filter((f) => (seen.has(f.title) ? false : (seen.add(f.title), true)));
  const background = all.find((r) => r.type === "Background Feature");

  // equipment and attacks, by the same rules as the Equipment tab
  const statistics2 = stats.data.statistics;
  const facts: CharacterFacts & { strength: number } = {
    mod: (a: string) => mod(a),
    proficiencyBonus,
    stat: (n: string) => stat(n),
    statNames: statistics2.map((x) => x.groupName),
    has: new Set(batch.data.entries.map((e) => e.auroraId).filter((id): id is string => !!id)),
    strength: abilities.data.abilityScores.find((a) => a.abbreviation === "STR")?.calculatedScore ?? 10,
  };
  const levelless = (name: string) => name.replace(/^Level \d+:\s*/, "");
  const slug = (name: string) => levelless(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ancestors = (r: Registration) => {
    const list: Registration[] = [];
    for (let a = r.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined; a; a = a.parentRegistrationId ? byRegistration.get(a.parentRegistrationId) : undefined) list.push(a);
    return list;
  };
  // "ac:draconic-resilience" -> "Draconic Resilience (Sorcerer)": the feature and its class, as Aurora names it
  const featureOf = (statistic: string) => {
    const feature = all.find((r) => slug(r.name) === statistic.replace(/^ac:/, ""));
    if (!feature) return undefined;
    const owner = ancestors(feature).find((a) => a.type === "Class");
    return owner ? `${levelless(feature.name)} (${owner.name})` : levelless(feature.name);
  };
  const itemTexts = new Map<string, ItemText>(
    [...batch.data.entries, ...(texts.data?.entries ?? [])].map((e) => [e.id, { name: e.name, description: e.description, source: e.source, setters: e.setters }]),
  );
  const armor = sheetArmor(inventory.data, catalog.data.byId, facts, featureOf);

  // spellcasting pages from the spellcasting worked out by the server
  const magicState = { ...EMPTY_MAGIC, ...(magic.data ?? {}) };
  const order = new Map(all.map((r, i) => [r.registrationId, i]));
  const subclassOf = (c: { className: string | null }) => {
    const owner = all.find((r) => r.type === "Class" && r.name === c.className);
    return owner ? all.find((r) => r.type === "SubClass" && ancestors(r).includes(owner))?.name : undefined;
  };
  // Aurora labels another spell by the species, lineage or feature that gives it ("Tiefling", "High Elf", "Wizard")
  const otherLabel = (s: KnownSpell) => {
    const r = byRegistration.get(s.registrationId);
    let node = r?.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined;
    // a lineage's spellcasting ability ("Wisdom" under High Elf) gives way to the lineage; a feat's ("Charisma") stays
    while (node && node.type === "Species Feature" && ABILITY_NAMES.includes(node.name) && node.parentRegistrationId) node = byRegistration.get(node.parentRegistrationId);
    if (!node) return "";
    const up = node.parentRegistrationId ? byRegistration.get(node.parentRegistrationId) : undefined;
    return node.type === "Species Feature" && up && (up.type === "Species" || up.type === "Race") ? up.name : levelless(node.name);
  };
  const spellName = (id: string) => {
    const f = spellIndex.byId?.get(id);
    return f ? { name: f.name, level: f.level ?? 0 } : undefined;
  };
  const spellPages = sheetSpellPages(casting.data, magicState, spellName, { subclassOf, otherLabel, order: (s) => order.get(s.registrationId) ?? 0 });

  // spell cards: every spell the character has (with the origins worked out above) and the ones it has prepared
  const cardSpells: SheetSpell[] = [];
  const carded = new Set<string>();
  for (const sp of [...casters.flatMap((c) => c.casting.spells), ...otherSpells]) {
    if (carded.has(`${sp.name}|${sp.level}`)) continue;
    carded.add(`${sp.name}|${sp.level}`);
    cardSpells.push(sp);
  }
  for (const c of casting.data.casters) {
    for (const id of magicState.prepared[c.name] ?? []) {
      const entry = entries.get(id) ?? texts.data?.entries.find((e) => e.id === id);
      if (!entry) continue;
      const sp = spellFromEntry(entry, `Prepared (${c.name})`);
      if (carded.has(`${sp.name}|${sp.level}`)) continue;
      carded.add(`${sp.name}|${sp.level}`);
      cardSpells.push(sp);
    }
  }
  cardSpells.sort((x, y) => x.level - y.level || x.name.localeCompare(y.name));

  return {
    isLoading: false,
    error: null,
    data: {
      name: details.data.character.name,
      player: details.data.character.playerName ?? "",
      portraitUrl: details.data.character.portraitUrl,
      level,
      classLine: `Level ${level} ${top("Species")} ${primary?.name ?? ""}${subclass ? `, ${subclass}` : ""}`.replace(/\s+/g, " ").trim(),
      background: top("Background"),
      alignment: top("Alignment"),
      deity: top("Deity"),
      subclass: subclass ?? "",
      proficiencyBonus,
      abilities: abilities.data.abilityScores,
      saves: saves.data.savingThrows.map((s) => ({ ...s, proficiency: saveProficiency(s) })),
      skills: skillList,
      passivePerception: 10 + perception,
      initiative: mod("DEX") + (stat("initiative") ?? 0),
      speeds: {
        walk: stat("innate-speed") ?? stat("speed") ?? 30,
        fly: stat("innate-speed:fly") ?? 0,
        climb: stat("innate-speed:climb") ?? 0,
        swim: stat("innate-speed:swim") ?? 0,
      },
      vision: unique(all.filter((r) => r.type === "Vision").map((r) => r.name)),
      armorClass: armor.total,
      armor,
      attacks: sheetAttackLines(inventory.data, catalog.data.byId, facts),
      equipment: sheetEquipment(inventory.data, catalog.data.byId, facts, itemTexts),
      itemCards: sheetItemCards(inventory.data, catalog.data.byId, itemTexts),
      spellPages,
      cardSpells,
      proficiencySummary: owned,
      proficienciesInOrder: summarizeProficiencies(registrations.data?.registrations ?? [], "gained"),
      attacksPerAction: Math.max(
        1,
        ...all.map((r) => {
          const name = r.name.replace(/^Level \d+:\s*/, "");
          if (/^Extra Attack$/i.test(name)) return 2;
          const n = name.match(/^Extra Attack \((\d)\)$/i)?.[1] ?? { Two: "2", Three: "3" }[name.match(/^(Two|Three) Extra Attacks$/i)?.[1] ?? ""];
          return n ? 1 + Number(n) : 1;
        }),
      ),
      defenses: defenses.data ?? { resistances: [], immunities: [], vulnerabilities: [] },
      hitDice: hitDie ? `${level}d${hitDie}` : "",
      hitDie,
      edition: /\((2024|2025)\)/.test(classEntry?.source ?? "") ? "2024" : "2014",
      hitPoints: hitDie ? hitPointsFor(hitDie, level, con, stat("hp") ?? 0, story.data?.fields.hitPointRolls) : null,
      proficiencies: { armor: unique(proficiencies.armor), weapons: unique(proficiencies.weapons), tools: unique(proficiencies.tools) },
      languages: unique(all.filter((r) => r.type === "Language").map((r) => r.name)),
      speciesTraits: dedupe(
        all
          .filter((r) => r.type === "Species Feature" && ancestors(r).some((a) => a.type === "Species" || a.type === "Race"))
          .map(feature)
          .filter((f): f is SheetFeature => f !== null),
      ),
      features: dedupe(featureList((t) => FEATURE_TYPES.has(t))),
      backgroundFeature: background ? feature(background) : null,
      spellcasting: casters.map((c) => c.casting),
      otherSpells,
      story: story.data?.fields ?? {},
    },
  };
}
