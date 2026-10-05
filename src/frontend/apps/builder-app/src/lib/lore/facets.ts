/** The filters of each category's list. */
import type { Facet } from "./search.ts";
import { SCHOOLS } from "./spell-text.ts";
import { SIZES, SIZE_ORDER, XP_BY_CR } from "./monster-text.ts";
import type { BestiaryRow, IndexRow, ItemRow, LoreMeta, SpellRow } from "./types.ts";

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Book, edition and free rules: on every list. The books are listed newest first. */
export function commonFacets<Row extends IndexRow>(meta: LoreMeta, rows: Row[]): Facet<Row>[] {
  const present = [...new Set(rows.map((r) => r.src))];
  present.sort((a, b) => (meta.sources[b]?.date ?? "").localeCompare(meta.sources[a]?.date ?? "") || a.localeCompare(b));
  return [
    {
      id: "ed",
      label: "Edition",
      values: (r) => [r.ed],
      options: [
        { value: "2024", label: "2024 rules" },
        { value: "2014", label: "2014 rules" },
      ],
    },
    {
      id: "src",
      label: "Book",
      values: (r) => [r.src],
      options: present.map((s) => ({ value: s, label: meta.sources[s]?.name ?? s })),
      folded: true,
    },
    { id: "srd", label: "Free rules", values: (r) => [r.srd ? "yes" : "no"], options: [{ value: "yes", label: "In the free rules (SRD)" }], folded: true },
  ];
}

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

export const SPELL_FACETS: Facet<SpellRow>[] = [
  { id: "level", label: "Level", values: (r) => [String(r.lvl)], options: ORDINAL.map((l, i) => ({ value: String(i), label: l })) },
  { id: "school", label: "School", values: (r) => [r.school], options: Object.entries(SCHOOLS).map(([value, label]) => ({ value, label })) },
  { id: "class", label: "Class", values: (r) => r.classes },
  {
    id: "other",
    label: "Concentration and ritual",
    values: (r) => [...(r.conc ? ["conc"] : []), ...(r.ritual ? ["ritual"] : []), ...(!r.conc ? ["noconc"] : [])],
    options: [
      { value: "conc", label: "Concentration" },
      { value: "noconc", label: "No concentration" },
      { value: "ritual", label: "Ritual" },
    ],
  },
  {
    id: "time",
    label: "Casting time",
    values: (r) => [r.timeUnit],
    options: ["action", "bonus", "reaction", "minute", "hour"].map((v) => ({ value: v, label: v === "bonus" ? "Bonus action" : title(v) })),
    folded: true,
  },
  { id: "dmg", label: "Damage type", values: (r) => r.dmg ?? [], folded: true },
  { id: "save", label: "Saving throw", values: (r) => r.save ?? [], options: ABILITIES.map((a) => ({ value: a, label: title(a) })), folded: true },
  { id: "cond", label: "Condition inflicted", values: (r) => r.cond ?? [], folded: true },
];

const CR_OPTIONS = Object.keys(XP_BY_CR).map((cr) => ({ value: cr, label: `CR ${cr}` }));
const TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];

export const BESTIARY_FACETS: Facet<BestiaryRow>[] = [
  { id: "cr", label: "Challenge", values: (r) => [r.cr], options: CR_OPTIONS },
  { id: "type", label: "Type", values: (r) => r.type, options: TYPES.map((t) => ({ value: t, label: title(t) })) },
  { id: "size", label: "Size", values: (r) => r.size, options: SIZE_ORDER.map((s) => ({ value: s, label: SIZES[s] })) },
  { id: "env", label: "Environment", values: (r) => r.env ?? [] },
  {
    id: "misc",
    label: "Legendary, lair and more",
    values: (r) => r.misc ?? [],
    options: [
      { value: "legendary", label: "Legendary" },
      { value: "mythic", label: "Mythic" },
      { value: "lair", label: "Has a lair" },
      { value: "spellcaster", label: "Spellcaster" },
      { value: "swarm", label: "Swarm" },
      { value: "named", label: "Named NPC" },
      { value: "version", label: "Version of another" },
    ],
  },
  { id: "align", label: "Alignment", values: (r) => r.align ?? [], folded: true },
  { id: "speed", label: "Movement", values: (r) => r.speed ?? [], options: ["burrow", "climb", "fly", "swim"].map((v) => ({ value: v, label: title(v) })), folded: true },
  { id: "immune", label: "Damage immunity", values: (r) => r.immune ?? [], folded: true },
  { id: "resist", label: "Damage resistance", values: (r) => r.resist ?? [], folded: true },
  { id: "vuln", label: "Damage vulnerability", values: (r) => r.vuln ?? [], folded: true },
  { id: "condImm", label: "Condition immunity", values: (r) => r.condImm ?? [], folded: true },
];

const RARITY = ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact", "varies", "unknown (magic)"];

export const ITEM_FACETS: Facet<ItemRow>[] = [
  { id: "kind", label: "Kind", values: (r) => [r.magic ? "magic" : "mundane"], options: [{ value: "magic", label: "Magic items" }, { value: "mundane", label: "Mundane" }] },
  { id: "rarity", label: "Rarity", values: (r) => [r.rarity], options: RARITY.map((v) => ({ value: v, label: v === "none" ? "Not magic" : title(v) })) },
  { id: "type", label: "Type", values: (r) => [r.type] },
  { id: "attune", label: "Attunement", values: (r) => [r.attune ? "yes" : "no"], options: [{ value: "yes", label: "Requires attunement" }, { value: "no", label: "No attunement" }] },
  {
    id: "variant",
    label: "Generic and specific",
    values: (r) => [r.kind],
    options: [
      { value: "item", label: "Named items" },
      { value: "generic", label: "Generic variants (+1 Weapon)" },
      { value: "specific", label: "Specific variants (+1 Longsword)" },
      { value: "base", label: "Base items" },
    ],
    folded: true,
  },
  { id: "weapon", label: "Weapon category", values: (r) => (r.weapon ? [r.weapon] : []), folded: true },
  { id: "props", label: "Property", values: (r) => r.props ?? [], folded: true },
  { id: "dmgType", label: "Damage type", values: (r) => (r.dmgType ? [r.dmgType] : []), folded: true },
  { id: "mastery", label: "Mastery", values: (r) => r.mastery ?? [], folded: true },
];
