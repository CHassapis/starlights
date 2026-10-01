/**
 * The Compendium of Lore's generated data, as the ingest script writes it and the app reads it. The files live
 * outside the repository (they hold the books' text) and are served from /lore-data/<version>/.
 */

export type Edition = "2014" | "2024";

export interface SourceInfo {
  abbr: string;
  name: string;
  /** the short form 5etools shows ("PHB'24") */
  short: string;
  /** publication date, yyyy-mm-dd */
  date: string | null;
  edition: Edition;
  /** "core", "supplement", "setting", … (books.json) */
  group: string;
  kind: "book" | "adventure" | "other";
  /** cover picture path in the image repository */
  cover?: string;
}

export interface CategoryMeta {
  id: string;
  count: number;
  /** entries per source */
  sources: Record<string, number>;
}

export interface LoreMeta {
  version: string;
  built: string;
  /** where the pictures are (the 5etools image repository), joined with a picture's path */
  imageBase: string;
  sources: Record<string, SourceInfo>;
  /** each tag's book when the tag names none, from the release's own renderer */
  tagDefaults: Record<string, string>;
  categories: Record<string, CategoryMeta>;
  /** old key → current key per category, for links to entries that were renamed or reprinted */
  redirects: Record<string, Record<string, string>>;
}

/** What every list row has; each category adds the fields its filters need. */
export interface IndexRow {
  /** key: name and source in 5etools' hash format */
  k: string;
  name: string;
  src: string;
  page?: number;
  ed: Edition;
  /** in the free rules (SRD 5.1 / 5.2 or the Basic Rules) */
  srd?: boolean;
}

export interface SpellRow extends IndexRow {
  lvl: number;
  school: string;
  classes: string[];
  conc?: boolean;
  ritual?: boolean;
  time: string;
  timeUnit: string;
  range: string;
  comp: string;
  dur: string;
  dmg?: string[];
  save?: string[];
  cond?: string[];
}

export interface CategoryIndex<Row extends IndexRow = IndexRow> {
  rows: Row[];
}

/** A source's file of entries for one category: the full data, by key. */
export interface CategoryChunk {
  entries: Record<string, LoreEntry>;
}

/** An entry as 5etools has it (resolved copies, fluff merged in as _fluff). */
export interface LoreEntry {
  name: string;
  source: string;
  page?: number;
  _fluff?: Fluff;
  [field: string]: unknown;
}

export interface Fluff {
  entries?: unknown[];
  images?: unknown[];
}
