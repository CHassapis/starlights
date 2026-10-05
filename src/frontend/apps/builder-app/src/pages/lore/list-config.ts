/** Each category's list: its filters, the line under each name, and its sort orders. */
import { BESTIARY_FACETS, ITEM_FACETS, SPELL_FACETS } from "@/lib/lore/facets";
import { SIZES } from "@/lib/lore/monster-text";
import type { Facet } from "@/lib/lore/search";
import { SCHOOLS } from "@/lib/lore/spell-text";
import type { BestiaryRow, ClassRow, IndexRow, ItemRow, SimpleRow, SpellRow } from "@/lib/lore/types";

export interface SortOption<Row> {
  id: string;
  label: string;
  compare: (a: Row, b: Row) => number;
}

export interface ListConfig<Row extends IndexRow> {
  facets: Facet<Row>[];
  /** the short line under the name */
  summary: (row: Row) => string;
  sorts: SortOption<Row>[];
}

const byName = (a: IndexRow, b: IndexRow) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src);
const NAME_SORT: SortOption<IndexRow> = { id: "name", label: "Name", compare: byName };
const SOURCE_SORT: SortOption<IndexRow> = { id: "source", label: "Book", compare: (a, b) => a.src.localeCompare(b.src) || byName(a, b) };

const LEVEL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

const spells: ListConfig<SpellRow> = {
  facets: SPELL_FACETS,
  summary: (r) => [r.lvl === 0 ? `${SCHOOLS[r.school] ?? r.school} cantrip` : `${LEVEL[r.lvl]}-level ${(SCHOOLS[r.school] ?? r.school).toLowerCase()}`, r.time, r.range, r.conc ? "concentration" : "", r.ritual ? "ritual" : ""].filter(Boolean).join(" · "),
  sorts: [NAME_SORT, { id: "level", label: "Level", compare: (a, b) => a.lvl - b.lvl || byName(a, b) }, SOURCE_SORT],
};

const bestiary: ListConfig<BestiaryRow> = {
  facets: BESTIARY_FACETS,
  summary: (r) => `${r.size.map((s) => SIZES[s] ?? s).join("/")} ${r.typeText} · CR ${r.cr}`,
  sorts: [NAME_SORT, { id: "cr", label: "Challenge", compare: (a, b) => a.crn - b.crn || byName(a, b) }, SOURCE_SORT],
};

const RARITY_ORDER = ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact"];
const items: ListConfig<ItemRow> = {
  facets: ITEM_FACETS,
  summary: (r) => [r.type, r.rarity !== "none" ? r.rarity : "", r.attune ? "attunement" : ""].filter(Boolean).join(" · "),
  sorts: [NAME_SORT, { id: "rarity", label: "Rarity", compare: (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || byName(a, b) }, SOURCE_SORT],
};

const classes: ListConfig<ClassRow> = {
  facets: [
    { id: "kind", label: "Class or subclass", values: (r) => [r.kind], options: [{ value: "class", label: "Classes" }, { value: "subclass", label: "Subclasses" }] },
    { id: "cls", label: "Class", values: (r) => [r.cls] },
  ],
  summary: (r) => (r.kind === "class" ? "Class" : `${r.cls} subclass`),
  sorts: [NAME_SORT, SOURCE_SORT],
};

/** The simpler categories: the labels of their filters (kind, group, group2). */
const SIMPLE: Record<string, { kind?: string; group?: string; group2?: string }> = {
  feats: { group: "Category", group2: "Prerequisite" },
  optionalfeatures: { group: "Type" },
  conditions: { kind: "Kind" },
  rules: { group: "Type" },
  deities: { group: "Pantheon", group2: "Domain" },
  languages: { group: "Type" },
  rewards: { group: "Type" },
  traps: { kind: "Kind" },
  vehicles: { group: "Type" },
  tables: { group: "Chapter" },
  bastions: { group: "Type" },
  psionics: { group: "Type" },
  recipes: { group: "Type" },
  charoptions: { group: "Type" },
  species: { group: "Size", group2: "Traits" },
};

function simple(labels: { kind?: string; group?: string; group2?: string }): ListConfig<SimpleRow> {
  const facets: Facet<SimpleRow>[] = [];
  if (labels.kind) facets.push({ id: "kind", label: labels.kind, values: (r) => (r.kind ? [r.kind] : []) });
  if (labels.group) facets.push({ id: "group", label: labels.group, values: (r) => r.group ?? [] });
  if (labels.group2) facets.push({ id: "group2", label: labels.group2, values: (r) => r.group2 ?? [] });
  return { facets, summary: (r) => [r.kind, ...(r.group ?? [])].filter(Boolean).join(" · "), sorts: [NAME_SORT, SOURCE_SORT] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LIST_CONFIG: Record<string, ListConfig<any>> = { spells, bestiary, items, classes, ...Object.fromEntries(Object.entries(SIMPLE).map(([id, labels]) => [id, simple(labels)])) };

export const DEFAULT_CONFIG: ListConfig<IndexRow> = { facets: [], summary: () => "", sorts: [NAME_SORT, SOURCE_SORT] };
