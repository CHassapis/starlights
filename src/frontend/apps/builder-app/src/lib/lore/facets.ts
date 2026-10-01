/** The filters of each category's list. */
import type { Facet } from "./search.ts";
import { SCHOOLS } from "./spell-text.ts";
import type { IndexRow, LoreMeta, SpellRow } from "./types.ts";

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
