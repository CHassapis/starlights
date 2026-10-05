/**
 * The categories that are lists of entries with a little filtering information each: feats, backgrounds, class
 * options, conditions, rules, actions, deities, languages, supernatural gifts, objects, traps and hazards,
 * vehicles, tables, decks, bastion facilities, psionics, recipes and other character options. Species (with their
 * subraces made into whole entries) are here too.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { entryKey } from "../src/lib/lore/keys.ts";
import type { LoreEntry, SimpleRow } from "../src/lib/lore/types.ts";
import { expandVersions, resolveCopies } from "./copy.ts";
import { baseRow, fluffByKey, readJson, str, withFluff, type Context, type Json } from "./common.ts";

const keyOf = (e: Json) => entryKey(str(e.name) ?? "", str(e.source) ?? "");

interface Spec {
  id: string;
  /** file and list key, and the kind the entries are shown as (when a category mixes kinds) */
  lists: { file: string; key: string; kind?: string }[];
  fluff?: { file: string; key: string }[];
  /** filter values: group (the main filter) and group2 (a second one) */
  row?: (e: Json, ctx: Context) => Pick<SimpleRow, "group" | "group2">;
  /** a different key (deities are keyed with their pantheon, as their tags are) */
  key?: (e: Json) => string;
  /** extra preparation of the whole list (decks get their cards) */
  prepare?: (entries: Json[], files: Json[]) => Json[];
}

const FEAT_CATEGORY: Record<string, string> = { G: "General", O: "Origin", FS: "Fighting Style", "FS:P": "Fighting Style (Paladin)", "FS:R": "Fighting Style (Ranger)", EB: "Epic Boon", D: "Dragonmark" };
const LANG_TYPE: Record<string, string> = { standard: "Standard", exotic: "Exotic", rare: "Rare", secret: "Secret", dead: "Dead" };

let optionNames: Record<string, string> = {};

/** Parser.OPT_FEATURE_TYPE_TO_FULL from js/parser.js: "EI" → "Eldritch Invocation". */
function readOptionNames(root: string): Record<string, string> {
  const js = readFileSync(join(root, "js", "parser.js"), "utf8");
  const start = js.indexOf("Parser.OPT_FEATURE_TYPE_TO_FULL = {");
  if (start < 0) return {};
  const block = js.slice(start, js.indexOf("};", start));
  return Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

export const SPECS: Spec[] = [
  {
    id: "feats",
    lists: [{ file: "feats.json", key: "feat" }],
    fluff: [{ file: "fluff-feats.json", key: "featFluff" }],
    row: (e) => ({ group: asList(e.category).map((c) => FEAT_CATEGORY[c] ?? c), group2: [e.prerequisite ? "Has a prerequisite" : "No prerequisite"] }),
  },
  { id: "backgrounds", lists: [{ file: "backgrounds.json", key: "background" }], fluff: [{ file: "fluff-backgrounds.json", key: "backgroundFluff" }] },
  {
    id: "optionalfeatures",
    lists: [{ file: "optionalfeatures.json", key: "optionalfeature" }],
    fluff: [{ file: "fluff-optionalfeatures.json", key: "optionalfeatureFluff" }],
    row: (e) => ({ group: asList(e.featureType).map((t) => optionNames[t] ?? t) }),
  },
  {
    id: "conditions",
    lists: [
      { file: "conditionsdiseases.json", key: "condition", kind: "Condition" },
      { file: "conditionsdiseases.json", key: "disease", kind: "Disease" },
      { file: "conditionsdiseases.json", key: "status", kind: "Status" },
    ],
    fluff: [{ file: "fluff-conditionsdiseases.json", key: "conditionFluff" }],
  },
  { id: "rules", lists: [{ file: "variantrules.json", key: "variantrule" }], row: (e) => ({ group: e.ruleType ? [({ C: "Core", O: "Optional", V: "Variant", VO: "Variant optional", VV: "Variant variant", U: "Unknown" } as Record<string, string>)[String(e.ruleType)] ?? String(e.ruleType)] : [] }) },
  { id: "actions", lists: [{ file: "actions.json", key: "action" }] },
  {
    id: "deities",
    lists: [{ file: "deities.json", key: "deity" }],
    key: (e) => entryKey(`${String(e.name)} (${String(e.pantheon ?? "")})`, String(e.source)),
    row: (e) => ({ group: e.pantheon ? [String(e.pantheon)] : [], group2: asList(e.domains) }),
  },
  { id: "languages", lists: [{ file: "languages.json", key: "language" }], fluff: [{ file: "fluff-languages.json", key: "languageFluff" }], row: (e) => ({ group: e.type ? [LANG_TYPE[String(e.type)] ?? String(e.type)] : [] }) },
  {
    id: "rewards",
    lists: [
      { file: "rewards.json", key: "reward" },
      { file: "cultsboons.json", key: "cult", kind: "Cult" },
      { file: "cultsboons.json", key: "boon", kind: "Demonic boon" },
    ],
    fluff: [{ file: "fluff-rewards.json", key: "rewardFluff" }],
    row: (e) => ({ group: [String(e.type ?? e._kind ?? "Other")] }),
  },
  { id: "objects", lists: [{ file: "objects.json", key: "object" }], fluff: [{ file: "fluff-objects.json", key: "objectFluff" }] },
  {
    id: "traps",
    lists: [
      { file: "trapshazards.json", key: "trap", kind: "Trap" },
      { file: "trapshazards.json", key: "hazard", kind: "Hazard" },
    ],
    fluff: [
      { file: "fluff-trapshazards.json", key: "trapFluff" },
      { file: "fluff-trapshazards.json", key: "hazardFluff" },
    ],
  },
  { id: "vehicles", lists: [{ file: "vehicles.json", key: "vehicle" }], fluff: [{ file: "fluff-vehicles.json", key: "vehicleFluff" }], row: (e) => ({ group: e.vehicleType ? [({ SHIP: "Ship", SPELLJAMMER: "Spelljammer ship", INFWAR: "Infernal war machine", CREATURE: "Creature", OBJECT: "Object", ELEMENTAL_AIRSHIP: "Elemental airship" } as Record<string, string>)[String(e.vehicleType)] ?? String(e.vehicleType)] : [] }) },
  {
    id: "tables",
    lists: [
      { file: "tables.json", key: "table" },
      // the tables printed in the books and adventures, collected by the release
      { file: "generated/gendata-tables.json", key: "table" },
      { file: "generated/gendata-tables.json", key: "tableGroup" },
    ],
    row: (e) => ({ group: e.chapter && typeof e.chapter === "object" ? [String((e.chapter as Json).name)] : [] }),
  },
  {
    id: "decks",
    lists: [{ file: "decks.json", key: "deck" }],
    prepare: (decks, files) => {
      const cards = files.flatMap((f) => (Array.isArray(f.card) ? (f.card as Json[]) : []));
      return decks.map((d) => ({ ...d, _cards: cards.filter((c) => c.set === d.name && c.source === d.source) }));
    },
  },
  { id: "bastions", lists: [{ file: "bastions.json", key: "facility" }], fluff: [{ file: "fluff-bastions.json", key: "facilityFluff" }], row: (e) => ({ group: e.facilityType ? [String(e.facilityType) === "basic" ? "Basic" : "Special"] : [] }) },
  { id: "psionics", lists: [{ file: "psionics.json", key: "psionic" }], row: (e) => ({ group: e.type ? [String(e.type) === "D" ? "Discipline" : "Talent"] : [] }) },
  { id: "recipes", lists: [{ file: "recipes.json", key: "recipe" }], fluff: [{ file: "fluff-recipes.json", key: "recipeFluff" }], row: (e) => ({ group: e.type ? [String(e.type)] : [] }) },
  { id: "charoptions", lists: [{ file: "charcreationoptions.json", key: "charoption" }], fluff: [{ file: "fluff-charcreationoptions.json", key: "charoptionFluff" }], row: (e) => ({ group: asList(e.optionType) }) },
];

function readList(ctx: Context, file: string, key: string): { list: Json[]; json: Json } {
  const path = join(ctx.data, file);
  if (!existsSync(path)) {
    ctx.report.problem(`missing file ${file}`);
    return { list: [], json: {} };
  }
  const json = readJson(path);
  return { list: Array.isArray(json[key]) ? (json[key] as Json[]) : [], json };
}

function build(ctx: Context, spec: Spec, entries: Json[], fluffEntries: Json[]) {
  const fluff = fluffByKey(fluffEntries, ctx.report);
  const rows: SimpleRow[] = [];
  const chunks: Record<string, Record<string, LoreEntry>> = {};
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.name || !e.source) continue;
    const base = baseRow(ctx, e);
    const k = spec.key ? spec.key(e) : base.k;
    if (seen.has(k)) continue;
    seen.add(k);
    const extra = spec.row?.(e, ctx) ?? {};
    rows.push({
      ...base,
      k,
      ...(e._kind ? { kind: String(e._kind) } : {}),
      ...(extra.group?.length ? { group: extra.group } : {}),
      ...(extra.group2?.length ? { group2: extra.group2 } : {}),
    });
    (chunks[base.src] ??= {})[k] = withFluff(e, fluff.get(keyOf(e)));
    ctx.report.count(spec.id, base.src);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src));
  return { rows, chunks };
}

export function ingestSimple(ctx: Context, root: string) {
  optionNames = readOptionNames(root);
  const out: Record<string, ReturnType<typeof build>> = {};
  for (const spec of SPECS) {
    const files: Json[] = [];
    let entries: Json[] = [];
    for (const l of spec.lists) {
      const { list, json } = readList(ctx, l.file, l.key);
      files.push(json);
      entries.push(...list.map((e) => (l.kind ? { ...e, _kind: l.kind } : e)));
    }
    const problem = (m: string) => ctx.report.problem(`${spec.id} ${m}`);
    entries = resolveCopies(entries, spec.key ?? keyOf, { problem });
    entries = [...entries, ...entries.flatMap((e) => (e._versions ? expandVersions(e, { problem }) : []))];
    if (spec.prepare) entries = spec.prepare(entries, files);
    const fluffEntries = (spec.fluff ?? []).flatMap((f) => readList(ctx, f.file, f.key).list);
    out[spec.id] = build(ctx, spec, entries, fluffEntries);
  }
  return out;
}

/** Species: races, and each subrace made whole with its race ("Elf (High)"), with versions. */
export function ingestSpecies(ctx: Context) {
  const problem = (m: string) => ctx.report.problem(`species ${m}`);
  const { list: races, json } = readList(ctx, "races.json", "race");
  const subraces = Array.isArray(json.subrace) ? (json.subrace as Json[]) : [];
  const resolved = resolveCopies(races, keyOf, { problem });
  const all: Json[] = [...resolved, ...resolved.flatMap((r) => (r._versions ? expandVersions(r, { problem }) : []))];
  const byKey = new Map(resolved.map((r) => [keyOf(r), r]));
  for (const sub of subraces) {
    if (!sub.name) continue;
    const race = byKey.get(entryKey(String(sub.raceName), String(sub.raceSource)));
    if (!race) {
      problem(`subrace ${String(sub.name)}: race ${String(sub.raceName)} (${String(sub.raceSource)}) not found`);
      continue;
    }
    const entries = [...((race.entries as unknown[]) ?? [])];
    for (const e of (sub.entries as unknown[]) ?? []) {
      const overwrite = e && typeof e === "object" ? ((e as Json).data as Json | undefined)?.overwrite : undefined;
      const ix = overwrite ? entries.findIndex((x) => x && typeof x === "object" && (x as Json).name === overwrite) : -1;
      if (ix >= 0) entries[ix] = e;
      else entries.push(e);
    }
    const merged: Json = { ...race, ...sub, name: `${String(race.name)} (${String(sub.name)})`, source: sub.source ?? race.source, entries, _race: { name: race.name, source: race.source } };
    const ra = race.ability as Json[] | undefined;
    const sa = sub.ability as Json[] | undefined;
    if (ra?.length === 1 && sa?.length === 1 && !ra[0].choose && !sa[0].choose) merged.ability = [{ ...ra[0], ...sa[0] }];
    delete merged.raceName;
    delete merged.raceSource;
    delete merged._versions;
    all.push(merged);
  }
  const fluffList = readList(ctx, "fluff-races.json", "raceFluff").list;
  const spec: Spec = {
    id: "species",
    lists: [],
    row: (e) => ({
      group: asList(e.size).map((s) => ({ T: "Tiny", S: "Small", M: "Medium", L: "Large" } as Record<string, string>)[s] ?? s),
      group2: [
        ...(e.darkvision ? ["Darkvision"] : []),
        ...(e.speed && typeof e.speed === "object" && (e.speed as Json).fly ? ["Flying speed"] : []),
        ...(e.speed && typeof e.speed === "object" && (e.speed as Json).swim ? ["Swimming speed"] : []),
        ...(e._race ? ["Subrace"] : []),
        ...(e._versionOf ? ["Version"] : []),
      ],
    }),
  };
  const built = build(ctx, spec, all, fluffList);
  // a subrace or version without lore of its own shows its race's
  const fluffAll = fluffByKey(fluffList, ctx.report);
  for (const chunk of Object.values(built.chunks)) {
    for (const entry of Object.values(chunk)) {
      const parent = (entry._race ?? entry._versionOf) as Json | undefined;
      if (!entry._fluff && parent) {
        const f = fluffAll.get(keyOf(parent));
        if (f) entry._fluff = f;
      }
    }
  }
  return built;
}

