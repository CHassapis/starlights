/** Reading the 5etools data folder, and writing the generated files (each as .json and a precompressed .json.gz). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { entryKey } from "../src/lib/lore/keys.ts";
import { resolveCopies } from "./copy.ts";
import type { Edition, Fluff, IndexRow, LoreEntry, SourceInfo } from "../src/lib/lore/types.ts";

export type Json = Record<string, unknown>;

export interface Context {
  data: string;
  sources: Record<string, SourceInfo>;
  report: Report;
}

export class Report {
  counts: Record<string, Record<string, number>> = {};
  problems: string[] = [];
  private seen = new Set<string>();

  count(category: string, source: string) {
    const c = (this.counts[category] ??= {});
    c[source] = (c[source] ?? 0) + 1;
  }

  /** A problem worth reading once; the same message is not repeated. */
  problem(message: string) {
    if (!this.seen.has(message)) {
      this.seen.add(message);
      this.problems.push(message);
    }
  }
}

export function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

/** Every file a folder's index.json lists ({"PHB": "spells-phb.json", …}), as parsed JSON. */
export function readIndexed(folder: string, index = "index.json"): Json[] {
  const path = join(folder, index);
  if (!existsSync(path)) return [];
  return Object.values(readJson(path) as Record<string, string>).map((file) => readJson(join(folder, file)));
}

export function list(files: Json[], key: string): Json[] {
  return files.flatMap((f) => (Array.isArray(f[key]) ? (f[key] as Json[]) : []));
}

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The fields every list row has. */
export function baseRow(ctx: Context, e: Json): IndexRow {
  const name = str(e.name) ?? "";
  const source = str(e.source) ?? "";
  const info = ctx.sources[source];
  if (!info) ctx.report.problem(`unknown source ${source} (on ${name})`);
  const edition: Edition = info?.edition ?? "2014";
  return {
    k: entryKey(name, source),
    name,
    src: source,
    ...(typeof e.page === "number" ? { page: e.page } : {}),
    ed: edition,
    ...(e.srd || e.srd52 || e.basicRules || e.basicRules2024 ? { srd: true } : {}),
  };
}

/** Fluff (descriptions and pictures) by key; fluff that copies other fluff (with changes) is resolved. */
export function fluffByKey(entries: Json[], report: Report): Map<string, Fluff> {
  const resolved = resolveCopies(entries, (f) => entryKey(str(f.name) ?? "", str(f.source) ?? ""), { problem: (m) => report.problem(`fluff ${m}`) });
  const out = new Map<string, Fluff>();
  for (const f of resolved) {
    const fluff: Fluff = { ...(Array.isArray(f.entries) ? { entries: f.entries } : {}), ...(Array.isArray(f.images) ? { images: f.images } : {}) };
    if (fluff.entries || fluff.images) out.set(entryKey(str(f.name) ?? "", str(f.source) ?? ""), fluff);
  }
  return out;
}

/** An entry for its source's file: as 5etools has it, with its fluff. */
export function withFluff(e: Json, fluff: Fluff | undefined): LoreEntry {
  return { ...(e as LoreEntry), ...(fluff ? { _fluff: fluff } : {}) };
}

export class Writer {
  files = 0;
  bytes = 0;
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  write(rel: string, value: unknown) {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    const json = JSON.stringify(value);
    writeFileSync(path, json);
    writeFileSync(`${path}.gz`, gzipSync(json, { level: 9 }));
    this.files++;
    this.bytes += json.length;
  }
}
