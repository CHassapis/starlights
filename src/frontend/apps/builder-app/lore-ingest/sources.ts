/**
 * The books and other sources of the 5etools data: names, abbreviations and publication dates, read from the
 * release itself (its books.json and adventures.json, and the source tables in js/parser.js) so a newer release
 * brings its new books along. A source is "2014" when it was published before the 2024 Player's Handbook, as
 * 5etools itself decides it (SourceUtil.isClassicSource).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Edition, SourceInfo } from "../src/lib/lore/types.ts";

const PHB_2024 = "XPHB";

interface BookEntry {
  id: string;
  source?: string;
  name: string;
  group?: string;
  published?: string;
  cover?: { path?: string };
  author?: string;
}

/**
 * Parser.SRC_X = "Abc"; and Parser.SOURCE_JSON_TO_*[Parser.SRC_X] = "…"; from js/parser.js. Values may be template
 * strings built from other constants (`${Parser.SRC_MCVX_PREFIX}2DC`), which are expanded.
 */
export function parserTables(parserJs: string) {
  const named = new Map<string, string>();
  const literal = /^(?:"([^"]*)"|`([^`]*)`)$/;
  const expand = (raw: string): string | null => {
    const ref = raw.trim().match(/^Parser\.([A-Za-z0-9_]+)$/);
    if (ref) return named.get(ref[1]) ?? null;
    const m = raw.trim().match(literal);
    if (!m) return null;
    if (m[1] !== undefined) return m[1];
    let ok = true;
    const out = m[2].replace(/\$\{Parser\.([A-Za-z0-9_]+)\}/g, (_, name: string) => {
      const v = named.get(name);
      if (v === undefined) ok = false;
      return v ?? "";
    });
    return ok ? out : null;
  };
  // constants first (several passes, as some are built from others)
  const assignments = [...parserJs.matchAll(/^Parser\.([A-Za-z0-9_]+)\s*=\s*("[^"\n]*"|`[^`\n]*`|Parser\.[A-Za-z0-9_]+);/gm)];
  for (let pass = 0; pass < 4; pass++) {
    for (const [, name, raw] of assignments) {
      if (named.has(name)) continue;
      const v = expand(raw);
      if (v !== null) named.set(name, v);
    }
  }
  const constants = new Map<string, string>();
  for (const [name, value] of named) if (name.startsWith("SRC_")) constants.set(name.slice(4), value);
  const table = (name: string) => {
    const out = new Map<string, string>();
    for (const m of parserJs.matchAll(new RegExp(`^Parser\\.${name}\\[Parser\\.SRC_([A-Za-z0-9_]+)\\]\\s*=\\s*("[^"\\n]*"|\`[^\`\\n]*\`|Parser\\.[A-Za-z0-9_]+);`, "gm"))) {
      const abbr = constants.get(m[1]);
      const value = expand(m[2]);
      if (abbr && value !== null) out.set(abbr, value);
    }
    return out;
  };
  return { constants, full: table("SOURCE_JSON_TO_FULL"), abbreviation: table("SOURCE_JSON_TO_ABV"), date: table("SOURCE_JSON_TO_DATE") };
}

/** Each tag's book when the tag names none ({@spell fireball} is the PHB's), from js/render.js. */
export function tagDefaultSources(renderJs: string, constants: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of renderJs.matchAll(/tagName\s*=\s*"(\w+)";\s*defaultSource\s*=\s*Parser\.SRC_([A-Za-z0-9_]+);/g)) {
    const source = constants.get(m[2]);
    if (source) out[m[1]] = source;
  }
  return out;
}

export function readSources(root: string): { sources: Record<string, SourceInfo>; tagDefaults: Record<string, string>; problems: string[] } {
  const parserJs = readFileSync(join(root, "js", "parser.js"), "utf8");
  const renderJs = readFileSync(join(root, "js", "render.js"), "utf8");
  const tables = parserTables(parserJs);
  const books = (JSON.parse(readFileSync(join(root, "data", "books.json"), "utf8")).book ?? []) as BookEntry[];
  const adventures = (JSON.parse(readFileSync(join(root, "data", "adventures.json"), "utf8")).adventure ?? []) as BookEntry[];
  const problems: string[] = [];

  const threshold = tables.date.get(PHB_2024) ?? books.find((b) => b.id === PHB_2024)?.published ?? "2024-09-17";
  const sources: Record<string, SourceInfo> = {};
  const add = (abbr: string, info: Partial<SourceInfo>) => {
    const date = info.date ?? tables.date.get(abbr) ?? null;
    const edition: Edition = date && date >= threshold ? "2024" : "2014";
    sources[abbr] = {
      abbr,
      name: info.name ?? tables.full.get(abbr) ?? abbr,
      short: tables.abbreviation.get(abbr) ?? abbr,
      date,
      edition,
      group: info.group ?? "other",
      kind: info.kind ?? "other",
      ...(info.cover ? { cover: info.cover } : {}),
    };
  };
  for (const [abbr, name] of tables.full) add(abbr, { name });
  for (const [list, kind] of [[books, "book"], [adventures, "adventure"]] as const) {
    for (const b of list) {
      const abbr = b.source ?? b.id;
      add(abbr, { name: b.name, group: b.group, kind, date: b.published ?? tables.date.get(abbr) ?? null, cover: b.cover?.path });
    }
  }
  for (const s of Object.values(sources)) if (!s.date) problems.push(`source ${s.abbr} has no publication date (counted as 2014)`);
  return { sources, tagDefaults: tagDefaultSources(renderJs, tables.constants), problems };
}
