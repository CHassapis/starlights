/**
 * Classes and subclasses, with every feature put in place: a class's features level by level, each subclass's
 * features, and the features that other features point to (fighting styles and the like) written in where they
 * are referenced. Subclasses are entries of their own (and listed on their class).
 */
import { join } from "node:path";
import { entryKey } from "../src/lib/lore/keys.ts";
import type { ClassRow, LoreEntry } from "../src/lib/lore/types.ts";
import { resolveCopies } from "./copy.ts";
import { baseRow, fluffByKey, list, readIndexed, withFluff, type Context, type Json } from "./common.ts";

const low = (v: unknown) => String(v ?? "").toLowerCase();
const DEFAULT_SOURCE = "PHB";

export function subclassKey(name: string, className: string, classSource: string, source: string): string {
  return entryKey(`${name} (${className} ${classSource})`, source);
}

const classFeatureKey = (f: Json) => [f.name, f.className, f.classSource, f.level, f.source].map(low).join("|");
const subclassFeatureKey = (f: Json) => [f.name, f.className, f.classSource, f.subclassShortName, f.subclassSource, f.level, f.source].map(low).join("|");

function parseClassFeatureRef(ref: string): string {
  const [name, className, classSource, level, source] = ref.split("|");
  const cs = classSource || DEFAULT_SOURCE;
  return [name, className, cs, level, source || cs].map(low).join("|");
}

function parseSubclassFeatureRef(ref: string): string {
  const [name, className, classSource, shortName, subSource, level, source] = ref.split("|");
  const cs = classSource || DEFAULT_SOURCE;
  const ss = subSource || DEFAULT_SOURCE;
  return [name, className, cs, shortName, ss, level, source || ss].map(low).join("|");
}

export function ingestClasses(ctx: Context) {
  const folder = join(ctx.data, "class");
  const files = readIndexed(folder);
  const problem = (m: string) => ctx.report.problem(`classes ${m}`);
  const classes = list(files, "class");
  const subclasses = resolveCopies(list(files, "subclass"), (s) => [s.shortName, s.source, s.className, s.classSource].map(low).join("|"), { problem });
  const classFeatures = new Map<string, Json>();
  for (const f of resolveCopies(list(files, "classFeature"), classFeatureKey, { problem })) classFeatures.set(classFeatureKey(f), f);
  const subFeatures = new Map<string, Json>();
  for (const f of resolveCopies(list(files, "subclassFeature"), subclassFeatureKey, { problem })) subFeatures.set(subclassFeatureKey(f), f);
  const fluffFiles = readIndexed(folder, "fluff-index.json");
  const classFluff = fluffByKey(list(fluffFiles, "classFluff"), ctx.report);
  const subFluff = fluffByKey(list(fluffFiles, "subclassFluff"), ctx.report);

  /** Feature references inside a feature's text, written in (a few levels deep at most). */
  const inline = (entries: unknown, depth = 0): unknown => {
    if (Array.isArray(entries)) return entries.map((e) => inline(e, depth));
    if (!entries || typeof entries !== "object") return entries;
    const e = entries as Json;
    if ((e.type === "refClassFeature" || e.type === "refSubclassFeature") && depth < 4) {
      const ref = String(e.classFeature ?? e.subclassFeature ?? "");
      const f = e.type === "refClassFeature" ? classFeatures.get(parseClassFeatureRef(ref)) : subFeatures.get(parseSubclassFeatureRef(ref));
      if (!f) {
        problem(`feature ${ref} not found`);
        return { type: "entries", name: ref.split("|")[0], entries: [] };
      }
      return { type: "entries", name: f.name, entries: inline(f.entries, depth + 1) };
    }
    if (e.type === "refOptionalfeature") {
      const [name, source] = String(e.optionalfeature ?? "").split("|");
      return `{@optfeature ${name}${source ? `|${source}` : ""}}`;
    }
    return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, k === "entries" || k === "items" ? inline(v, depth) : v]));
  };

  const feature = (f: Json | undefined, ref: string, extra: Json = {}) => {
    if (!f) {
      problem(`feature ${ref} not found`);
      return null;
    }
    return { name: f.name, level: f.level, source: f.source, entries: inline(f.entries), ...extra };
  };

  const rows: ClassRow[] = [];
  const chunks: Record<string, Record<string, LoreEntry>> = {};
  for (const c of classes) {
    const base = baseRow(ctx, c);
    const features = ((c.classFeatures as unknown[]) ?? []).map((ref) => {
      const r = typeof ref === "string" ? ref : String((ref as Json).classFeature);
      return feature(classFeatures.get(parseClassFeatureRef(r)), r, typeof ref === "object" && (ref as Json).gainSubclassFeature ? { gainSubclassFeature: true } : {});
    });
    const own = subclasses.filter((s) => low(s.className) === low(c.name) && low(s.classSource) === low(c.source));
    const entry = withFluff(c, classFluff.get(base.k));
    entry._features = features.filter(Boolean);
    entry._subclasses = own
      .map((s) => ({ name: s.name, shortName: s.shortName, source: s.source, key: subclassKey(String(s.name), String(c.name), String(c.source), String(s.source)) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    rows.push({ ...base, kind: "class", cls: base.name });
    (chunks[base.src] ??= {})[base.k] = entry;
    ctx.report.count("classes", base.src);

    for (const s of own) {
      const key = subclassKey(String(s.name), String(c.name), String(c.source), String(s.source));
      const sBase = baseRow(ctx, s);
      const sEntry = withFluff(s, subFluff.get(entryKey(String(s.name), String(s.source))));
      sEntry._features = ((s.subclassFeatures as unknown[]) ?? [])
        .map((ref) => {
          const r = String(ref);
          return feature(subFeatures.get(parseSubclassFeatureRef(r)), r);
        })
        .filter(Boolean);
      sEntry._class = { name: c.name, source: c.source, key: base.k };
      rows.push({ ...sBase, k: key, kind: "subclass", cls: base.name });
      (chunks[sBase.src] ??= {})[key] = sEntry;
      ctx.report.count("classes", sBase.src);
    }
  }
  rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "class" ? -1 : 1) || a.name.localeCompare(b.name) || a.src.localeCompare(b.src));
  return { rows, chunks };
}
