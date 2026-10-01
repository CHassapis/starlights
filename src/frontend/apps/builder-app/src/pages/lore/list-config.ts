/** Each category's list: its filters, the line under each name, and its sort orders. */
import { SPELL_FACETS } from "@/lib/lore/facets";
import type { Facet } from "@/lib/lore/search";
import { SCHOOLS } from "@/lib/lore/spell-text";
import type { IndexRow, SpellRow } from "@/lib/lore/types";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LIST_CONFIG: Record<string, ListConfig<any>> = { spells };

export const DEFAULT_CONFIG: ListConfig<IndexRow> = { facets: [], summary: () => "", sorts: [NAME_SORT, SOURCE_SORT] };
