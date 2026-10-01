/**
 * Searching and filtering the compendium's lists in the browser: names match by prefix, by word start or anywhere
 * (in that order of rank), ignoring case, accents and punctuation; filters are "any of these values" per facet,
 * and all facets must match.
 */
import type { IndexRow } from "./types.ts";

const normalized = new Map<string, string>();

export function normalize(s: string): string {
  let out = normalized.get(s);
  if (out === undefined) {
    out = normalizeUncached(s);
    if (normalized.size < 100_000) normalized.set(s, out);
  }
  return out;
}

function normalizeUncached(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

/** How well a name matches the query: 0 = not at all, higher is better. */
export function matchScore(name: string, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const n = normalize(name);
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  if (` ${n}`.includes(` ${q}`)) return 2;
  if (n.includes(q)) return 1.5;
  // every word of the query starts a word of the name ("hold mon" → "Hold Monster")
  const words = q.split(" ");
  const nameWords = n.split(" ");
  if (words.length > 1 && words.every((w) => nameWords.some((nw) => nw.startsWith(w)))) return 1.2;
  return 0;
}

export interface Facet<Row> {
  id: string;
  label: string;
  /** the row's values for this facet */
  values: (row: Row) => readonly string[];
  /** the values in order, with labels; values not listed are added after, sorted */
  options?: { value: string; label: string }[];
  /** shown folded until opened */
  folded?: boolean;
}

export type Selection = Record<string, string[]>;

export function filterRows<Row extends IndexRow>(rows: Row[], query: string, facets: Facet<Row>[], selected: Selection): Row[] {
  const active = facets.filter((f) => (selected[f.id]?.length ?? 0) > 0);
  const out: { row: Row; score: number }[] = [];
  for (const row of rows) {
    if (!active.every((f) => f.values(row).some((v) => selected[f.id].includes(v)))) continue;
    const score = matchScore(row.name, query);
    if (score > 0) out.push({ row, score });
  }
  if (query.trim()) out.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return out.map((o) => o.row);
}

/** How many rows each value of a facet has, among the rows the other facets and the query leave. */
export function facetCounts<Row extends IndexRow>(rows: Row[], query: string, facets: Facet<Row>[], selected: Selection, facet: Facet<Row>): Map<string, number> {
  const others = { ...selected, [facet.id]: [] };
  const counts = new Map<string, number>();
  for (const row of filterRows(rows, query, facets, others)) for (const v of facet.values(row)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** Filters in the address: "level=1,2&school=V" ↔ {level: ["1", "2"], school: ["V"]}. */
export function selectionFromParams(params: URLSearchParams, facets: { id: string }[]): Selection {
  const out: Selection = {};
  for (const f of facets) {
    const v = params.get(f.id);
    if (v) out[f.id] = v.split(",").map(decodeURIComponent).filter(Boolean);
  }
  return out;
}

export function selectionToParams(selection: Selection, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [id, values] of Object.entries(selection)) {
    if (values.length) next.set(id, values.map(encodeURIComponent).join(","));
    else next.delete(id);
  }
  return next;
}
