/**
 * Items: the books' items and item groups, the mundane base items, the generic magic variants ("+1 Weapon") and
 * the specific items made from them ("+1 Longsword"), which many {@item} links point to. The specific items are
 * made at build time after 5etools' rules (Renderer.item in its render.js, MIT licence, © TheGiddyLimit and
 * contributors): which base items a variant applies to, and what it changes.
 */
import { join } from "node:path";
import { entryKey } from "../src/lib/lore/keys.ts";
import type { ItemRow, LoreEntry } from "../src/lib/lore/types.ts";
import { resolveCopies } from "./copy.ts";
import { baseRow, fluffByKey, readJson, str, withFluff, type Context, type Json } from "./common.ts";

const keyOf = (e: Json) => entryKey(str(e.name) ?? "", str(e.source) ?? "");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (v: unknown) => String(v ?? "").split("|")[0];

const DMG: Record<string, string> = { A: "acid", B: "bludgeoning", C: "cold", F: "fire", O: "force", L: "lightning", N: "necrotic", P: "piercing", I: "poison", Y: "psychic", R: "radiant", S: "slashing", T: "thunder" };

/** {=baseName}, {=bonusWeapon}, {=dmgType/l}, {=baseName/a} … in a variant's text. */
export function applyProperties(value: unknown, props: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{=([^}/]+)(?:\/([a-z]+))?\}/g, (whole, path: string, mods = "") => {
      const v = props[path];
      if (v == null) return whole;
      let s = String(v);
      for (const m of mods as string) {
        if (m === "l") s = s.toLowerCase();
        else if (m === "u") s = s.toUpperCase();
        else if (m === "t") s = s.replace(/\b\w/g, (c) => c.toUpperCase());
        else if (m === "a") s = /^[aeiou]/i.test(s) ? "an" : "a";
      }
      return s;
    });
  }
  if (Array.isArray(value)) return value.map((v) => applyProperties(v, props));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, applyProperties(v, props)]));
  return value;
}

function matches(candidate: Json, requirements: Json | undefined, every: boolean): boolean {
  if (!requirements) return false;
  for (const [k, req] of Object.entries(requirements)) {
    const val = candidate[k];
    let ok: boolean;
    if (Array.isArray(req)) ok = Array.isArray(val) ? val.some((x) => req.includes(x)) : req.includes(val);
    else if (req && typeof req === "object") ok = val && typeof val === "object" ? matches(val as Json, req as Json, every) : false;
    else ok = Array.isArray(val) ? val.includes(req) : val === req;
    if (every && !ok) return false;
    if (!every && ok) return true;
  }
  return every;
}

function editionMatch(base: Json, variant: Json): boolean {
  if (base.edition === variant.edition) return true;
  if (base.edition === "classic") return false;
  if (base.edition == null) return true;
  return variant.edition !== "classic";
}

/** A generic variant shows its own inherited fields (rarity, bonus, text). */
function inheritToSelf(v: Json): Json {
  const out = clone(v);
  const inh = (v.inherits ?? {}) as Json;
  for (const [k, val] of Object.entries(inh)) {
    if (["entries", "propertyAdd", "namePrefix", "nameSuffix", "propertyRemove"].includes(k)) continue;
    if (val == null) delete out[k];
    else if (Array.isArray(out[k]) && Array.isArray(val)) out[k] = [...(out[k] as unknown[]), ...val];
    else out[k] = val;
  }
  if (!out.entries && inh.entries) out.entries = applyProperties(inh.entries, inh);
  if (inh.propertyAdd) out.property = [...((out.property as unknown[]) ?? []), ...(inh.propertyAdd as unknown[])];
  return out;
}

function specificVariant(base: Json, generic: Json): Json {
  const inh = (generic.inherits ?? {}) as Json;
  const out = clone(base);
  for (const k of ["value", "srd", "srd52", "basicRules", "basicRules2024", "page", "reprintedAs", "referenceSources", "hasFluff", "hasFluffImages"]) delete out[k];
  const props = { ...inh, baseName: base.name, dmgType: base.dmgType ? DMG[String(base.dmgType)] : null };
  const ordered = Object.entries(inh).sort(([a], [b]) => Number(b.includes("Remove")) - Number(a.includes("Remove")));
  for (const [k, val] of ordered) {
    switch (k) {
      case "namePrefix":
        out.name = `${String(val)}${String(out.name)}`;
        break;
      case "nameSuffix":
        out.name = `${String(out.name)}${String(val)}`;
        break;
      case "nameRemove":
        out.name = String(out.name).split(String(val)).join("");
        break;
      case "entries":
        out.entries = [...(applyProperties(val, props) as unknown[]), ...((base.entries as unknown[]) ?? [])];
        break;
      case "propertyAdd":
        out.property = [...((out.property as unknown[]) ?? []), ...(val as unknown[]).filter((p) => !((out.property as unknown[]) ?? []).includes(p))];
        break;
      case "propertyRemove":
        out.property = ((out.property as unknown[]) ?? []).filter((p) => !(val as unknown[]).includes(p));
        break;
      case "conditionImmune":
      case "vulnerable":
      case "resist":
      case "immune":
        out[k] = [...new Set([...((out[k] as unknown[]) ?? []), ...(val as unknown[])])];
        break;
      case "weightExpression":
      case "valueExpression":
      case "barding":
        break;
      default:
        out[k] = val;
    }
  }
  out._baseItem = { name: base.name, source: base.source };
  out._genericVariant = { name: generic.name, source: generic.source };
  return out;
}

export function ingestItems(ctx: Context) {
  const problem = (m: string) => ctx.report.problem(`items ${m}`);
  const itemsFile = readJson(join(ctx.data, "items.json"));
  const baseFile = readJson(join(ctx.data, "items-base.json"));
  const variantsFile = readJson(join(ctx.data, "magicvariants.json"));
  const fluff = fluffByKey((readJson(join(ctx.data, "fluff-items.json")).itemFluff as Json[]) ?? [], ctx.report);

  const typeNames = new Map<string, string>();
  for (const t of (baseFile.itemType as Json[]) ?? []) typeNames.set(String(t.abbreviation), String(t.name));
  const propertyNames = new Map<string, string>();
  for (const p of (baseFile.itemProperty as Json[]) ?? []) {
    const name = str(p.name) ?? str(((p.entries as Json[] | undefined)?.[0] ?? {}).name);
    if (name) propertyNames.set(String(p.abbreviation), name);
  }
  const masteries = new Map<string, Json>();
  for (const m of (baseFile.itemMastery as Json[]) ?? []) masteries.set(keyOf(m), m);

  const bases = (baseFile.baseitem as Json[]) ?? [];
  // items may copy generic variants, so both are resolved together
  const rawItems = [...((itemsFile.item as Json[]) ?? []), ...((itemsFile.itemGroup as Json[]) ?? [])];
  const rawGenerics = ((variantsFile.magicvariant as Json[]) ?? []).map((g) => ({ ...g, source: g.source ?? (g.inherits as Json | undefined)?.source }));
  const together = resolveCopies([...rawItems, ...rawGenerics.map((g) => inheritToSelf(g))], keyOf, { problem });
  const items = together.slice(0, rawItems.length);
  const generics = resolveCopies(rawGenerics, keyOf, { problem }).map((g) => ({
    ...inheritToSelf(g),
    source: g.source ?? (g.inherits as Json | undefined)?.source,
    page: g.page ?? (g.inherits as Json | undefined)?.page,
  }));

  const all: { e: Json; kind: ItemRow["kind"] }[] = [
    ...items.map((e) => ({ e, kind: "item" as const })),
    ...bases.map((e) => ({ e, kind: "base" as const })),
    ...generics.map((e) => ({ e, kind: "generic" as const })),
  ];
  const known = new Set(all.map((x) => keyOf(x.e)));
  for (const base of bases) {
    if (base.packContents) continue;
    for (const g of generics) {
      if (!editionMatch(base, g)) continue;
      if (!((g.requires as Json[] | undefined) ?? []).some((r) => matches(base, r, true))) continue;
      if (matches(base, g.excludes as Json | undefined, false)) continue;
      const s = specificVariant(base, g);
      const k = keyOf(s);
      if (known.has(k)) continue;
      known.add(k);
      all.push({ e: s, kind: "specific" });
    }
  }

  const rows: ItemRow[] = [];
  const chunks: Record<string, Record<string, LoreEntry>> = {};
  const seen = new Set<string>();
  for (const { e, kind } of all) {
    if (!e.name || !e.source) continue;
    const base = baseRow(ctx, e);
    if (seen.has(base.k)) continue;
    seen.add(base.k);
    const rarity = str(e.rarity) ?? "none";
    const typeCode = code(e.type ?? e.bardingType);
    const type = typeNames.get(typeCode) ?? (e.wondrous ? "Wondrous Item" : e.poison ? "Poison" : typeCode || "Other");
    const props = ((e.property as unknown[]) ?? []).map((p) => propertyNames.get(code(typeof p === "object" && p ? (p as Json).uid : p)) ?? code(p));
    const mastery = ((e.mastery as unknown[]) ?? []).map((m) => code(typeof m === "object" && m ? (m as Json).uid : m));
    rows.push({
      ...base,
      type,
      rarity,
      ...(e.reqAttune ? { attune: true } : {}),
      ...(rarity !== "none" && rarity !== "unknown" ? { magic: true } : {}),
      kind,
      ...(e.weaponCategory ? { weapon: String(e.weaponCategory) } : {}),
      ...(props.length ? { props } : {}),
      ...(e.dmgType ? { dmgType: DMG[String(e.dmgType)] ?? String(e.dmgType) } : {}),
      ...(mastery.length ? { mastery } : {}),
    });
    const lore = fluff.get(base.k) ?? (e._genericVariant ? fluff.get(keyOf(e._genericVariant as Json)) : undefined);
    const entry = withFluff(e, lore);
    entry._type = type;
    if (props.length) entry._props = props;
    if (mastery.length) {
      entry._mastery = ((e.mastery as unknown[]) ?? []).map((m) => {
        const [name, source = "XPHB"] = String(typeof m === "object" && m ? (m as Json).uid : m).split("|");
        const def = masteries.get(entryKey(name, source));
        return { name, entries: def?.entries ?? [] };
      });
    }
    entry._kind = kind;
    (chunks[base.src] ??= {})[base.k] = entry;
    ctx.report.count("items", base.src);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src));
  return { rows, chunks };
}
