/**
 * Builds the Compendium of Lore's data from a 5etools-src checkout:
 *
 *   node lore-ingest/ingest.ts --src <5etools-src folder> --out <output folder> [--image-base URL] [--force]
 *
 * Writes <out>/<version>/ (meta.json, index/<category>.json, data/<category>/<source>.json, each with a .gz) and
 * then <out>/current.json naming that version, so the site switches over in one step. The version is the release's
 * own plus its commit and this script's format, so running it again on the same data does nothing (unless --force),
 * and pulling a newer release and running it again is the whole update. Older versions are removed, but the one
 * before stays for pages still open. The data holds the books' text: the output folder must stay private.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CategoryMeta, LoreMeta } from "../src/lib/lore/types.ts";
import { readJson, Report, Writer, type Context } from "./common.ts";
import { readSources } from "./sources.ts";
import { ingestBestiary } from "./bestiary.ts";
import { ingestSpells } from "./spells.ts";

/** Goes up whenever the generated files change shape, so the app never reads old files with new code. */
const FORMAT = 2;
const DEFAULT_IMAGE_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/";

/** 5etools page names of the redirect table → our categories. */
const REDIRECT_PAGES: Record<string, string> = { "spells.html": "spells", "bestiary.html": "bestiary" };

function args() {
  const a = process.argv.slice(2);
  const get = (name: string) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const src = get("src");
  const out = get("out");
  if (!src || !out) {
    console.error("usage: node lore-ingest/ingest.ts --src <5etools-src folder> --out <output folder> [--image-base URL] [--force]");
    process.exit(2);
  }
  return { src: resolve(src), out: resolve(out), imageBase: get("image-base") ?? DEFAULT_IMAGE_BASE, force: a.includes("--force") };
}

function commit(src: string): string {
  try {
    const head = readFileSync(join(src, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 7);
    const ref = head.slice(5);
    const loose = join(src, ".git", ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim().slice(0, 7);
    const packed = readFileSync(join(src, ".git", "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
    return packed ? packed.slice(0, 7) : "nogit";
  } catch {
    return "nogit";
  }
}

function main() {
  const { src, out, imageBase, force } = args();
  const data = join(src, "data");
  if (!existsSync(join(data, "books.json"))) {
    console.error(`${src} does not look like a 5etools-src checkout (no data/books.json)`);
    process.exit(1);
  }
  const release = String((readJson(join(src, "package.json")) as { version?: string }).version ?? "0");
  const version = `${release}-${commit(src)}-f${FORMAT}`;
  const target = join(out, version);
  if (existsSync(join(target, "meta.json")) && !force) {
    console.log(`${version} is already built; nothing to do (--force builds it again)`);
    return;
  }

  const started = Date.now();
  const report = new Report();
  const { sources, tagDefaults, problems } = readSources(src);
  problems.forEach((p) => report.problem(p));
  const ctx: Context = { data, sources, report };

  const building = `${target}.building`;
  rmSync(building, { recursive: true, force: true });
  const writer = new Writer(building);
  const categories: Record<string, CategoryMeta> = {};

  const write = (id: string, built: { rows: unknown[]; chunks: Record<string, Record<string, unknown>> }) => {
    writer.write(`index/${id}.json`, { rows: built.rows });
    for (const [source, entries] of Object.entries(built.chunks)) writer.write(`data/${id}/${source.toLowerCase()}.json`, { entries });
    categories[id] = { id, count: built.rows.length, sources: report.counts[id] ?? {} };
  };
  write("spells", ingestSpells(ctx));
  write("bestiary", ingestBestiary(ctx));

  const redirectTable = readJson(join(data, "generated", "gendata-tag-redirects.json")) as Record<string, Record<string, string>>;
  const redirects: Record<string, Record<string, string>> = {};
  for (const [page, category] of Object.entries(REDIRECT_PAGES)) if (redirectTable[page]) redirects[category] = redirectTable[page];

  const meta: LoreMeta = { version, built: new Date().toISOString(), imageBase, sources, tagDefaults, categories, redirects };
  writer.write("meta.json", meta);
  writer.write("report.json", { counts: report.counts, problems: report.problems });

  rmSync(target, { recursive: true, force: true });
  renameSync(building, target);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "current.json.tmp"), JSON.stringify({ version }));
  renameSync(join(out, "current.json.tmp"), join(out, "current.json"));

  // keep this version and the one before it (for pages still open), drop the rest
  const versions = readdirSync(out, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== version && !d.name.endsWith(".building"))
    .map((d) => ({ name: d.name, at: existsSync(join(out, d.name, "meta.json")) ? (readJson(join(out, d.name, "meta.json")) as { built?: string }).built ?? "" : "" }))
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const old of versions.slice(1)) rmSync(join(out, old.name), { recursive: true, force: true });

  const total = Object.values(categories).reduce((n, c) => n + c.count, 0);
  console.log(`built ${version}: ${total.toLocaleString()} entries in ${writer.files} files (${(writer.bytes / 1e6).toFixed(1)} MB before compression) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const c of Object.values(categories)) console.log(`  ${c.id}: ${c.count} from ${Object.keys(c.sources).length} sources`);
  console.log(`${report.problems.length} problems (in report.json)`);
  report.problems.slice(0, 15).forEach((p) => console.log(`  ${p}`));
}

main();
