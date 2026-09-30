import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { BuilderChoice } from "@/lib/api/builder";

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
  name: string;
  type: string;
  source: string | null;
  description: string;
  setters: Record<string, string>;
  spellcasting: { name: string; ability: string } | null;
  sheet: { display: boolean; alt: string | null; action: string | null; usage: string | null; descriptions: { level: number; usage: string | null; text: string }[] } | null;
}

export type Proficiency = "none" | "proficient" | "expertise";

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
  proficiencyBonus: number;
  abilities: AbilityScore[];
  saves: (Bonus & { proficiency: Proficiency })[];
  skills: (Bonus & { proficiency: Proficiency })[];
  passivePerception: number;
  initiative: number;
  speeds: { walk: number; fly: number; climb: number; swim: number };
  vision: string[];
  armorClass: number;
  hitDice: string;
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

  const all = flatten(registrations.data?.registrations ?? []);
  const elementIds = unique(all.map((r) => r.associatedElementId));
  const batch = useQuery({
    queryKey: ["sheet", characterId, "elements", elementIds.join(",")],
    queryFn: () => apiClient.get<{ entries: BatchEntry[] }>(`/api/elements/compendium/batch?ids=${elementIds.join(",")}`),
    enabled: elementIds.length > 0,
  });

  const parts = [details, abilities, saves, skills, stats, registrations, classes, choices, story, batch];
  const error = parts.find((p) => p.error)?.error ?? null;
  const isLoading = parts.some((p) => p.isLoading);
  if (isLoading || error || !details.data || !abilities.data || !saves.data || !skills.data || !stats.data || !batch.data) return { isLoading, error };

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
    const s = entry.setters;
    const parent = r.parentRegistrationId ? byRegistration.get(r.parentRegistrationId) : undefined;
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
      origin: parent?.name ?? "",
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
    (owner ? owner.casting.spells : otherSpells).push(s);
  }
  function isUnder(registrationId: string, ancestorId: string): boolean {
    for (let a = byRegistration.get(registrationId); a; a = a.parentRegistrationId ? byRegistration.get(a.parentRegistrationId) : undefined) {
      if (a.registrationId === ancestorId) return true;
    }
    return false;
  }

  const skillList = skills.data.skills.map((s) => ({ ...s, proficiency: proficiencyOf(s, proficiencyBonus) }));
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
      proficiencyBonus,
      abilities: abilities.data.abilityScores,
      saves: saves.data.savingThrows.map((s) => ({ ...s, proficiency: proficiencyOf(s, proficiencyBonus) })),
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
      armorClass: 10 + mod("DEX"),
      hitDice: hitDie ? `${level}d${hitDie}` : "",
      hitPoints: hitDie ? hitDie + con + (level - 1) * (hitDie / 2 + 1 + con) : null,
      proficiencies: { armor: unique(proficiencies.armor), weapons: unique(proficiencies.weapons), tools: unique(proficiencies.tools) },
      languages: unique(all.filter((r) => r.type === "Language").map((r) => r.name)),
      speciesTraits: dedupe(featureList((t) => t === "Species Feature")),
      features: dedupe(featureList((t) => FEATURE_TYPES.has(t))),
      backgroundFeature: background ? feature(background) : null,
      spellcasting: casters.map((c) => c.casting),
      otherSpells,
      story: story.data?.fields ?? {},
    },
  };
}
