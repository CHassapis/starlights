/**
 * Entries that are "a copy of another, with changes" ({"_copy": {"name", "source", "_mod", "_templates",
 * "_preserve"}}) and entries with "versions" (one creature written once, printed as several), resolved into whole
 * entries at build time. Written for this app after the behaviour of 5etools' data (DataUtil.generic in its
 * utils.js, MIT licence, © TheGiddyLimit and contributors): which fields a copy inherits, and what each of the
 * modification modes does.
 */
import type { Json } from "./common.ts";

/** Fields a copy only inherits when its _preserve asks for them (they describe where the original was printed). */
const NEEDS_PRESERVE = new Set([
  "page",
  "otherSources",
  "referenceSources",
  "srd",
  "srd52",
  "basicRules",
  "basicRules2024",
  "reprintedAs",
  "hasFluff",
  "hasFluffImages",
  "hasToken",
  "tokenCredit",
  "tokenCustom",
  "foundryTokenScale",
  "altArt",
  "_versions",
]);

/** The parts of a creature that "*" in a _mod means. */
const ENTRY_PROPS = ["action", "bonus", "reaction", "trait", "legendary", "mythic", "variant", "spellcasting", "actionHeader", "bonusHeader", "reactionHeader", "legendaryHeader", "mythicHeader"];

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

function getPath(obj: Json, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[p];
  }
  return cur;
}

function setPath(obj: Json, path: string[], value: unknown) {
  let cur = obj;
  for (const p of path.slice(0, -1)) {
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Json;
  }
  cur[path[path.length - 1]] = value;
}

function deletePath(obj: Json, path: string[]) {
  const parent = path.length > 1 ? getPath(obj, path.slice(0, -1)) : obj;
  if (parent && typeof parent === "object") delete (parent as Json)[path[path.length - 1]];
}

/** Every string in a value, through a function; tags ({@…}) are left alone unless asked. */
function walkStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walkStrings(v, fn)]));
  return value;
}

function replaceOutsideTags(s: string, re: RegExp, withStr: string): string {
  return s
    .split(/(\{@[^}]+\})/g)
    .map((part) => (part.startsWith("{@") ? part : part.replace(re, withStr)))
    .join("");
}

// ---------------------------------------------------------------- creature arithmetic for dynamic text

const CR_NUMBER: Record<string, number> = { "0": 0, "1/8": 0.125, "1/4": 0.25, "1/2": 0.5 };
export function crNumber(cr: unknown): number | null {
  const c = typeof cr === "object" && cr ? (cr as Json).cr : cr;
  if (typeof c !== "string") return null;
  return CR_NUMBER[c] ?? (Number.isFinite(Number(c)) ? Number(c) : null);
}
export function proficiencyForCr(cr: unknown): number {
  const n = crNumber(cr);
  if (n == null) return 2;
  return n < 5 ? 2 : Math.ceil(n / 4) + 1;
}
export const abilityMod = (score: unknown) => Math.floor((Number(score) - 10) / 2);

const SKILL_ABILITY: Record<string, string> = {
  athletics: "str",
  acrobatics: "dex",
  "sleight of hand": "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  "animal handling": "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};
const SIZE_MULT: Record<string, number> = { L: 2, H: 3, G: 4 };

/** A creature's short name for its text: "the goblin", or a named creature's first name. */
export function shortName(ent: Json, titleCase = false): string {
  const name = String(ent.name ?? "");
  const prefix = ent.isNamedCreature ? "" : titleCase ? "The " : "the ";
  if (ent.shortName === true) return `${prefix}${name}`;
  if (typeof ent.shortName === "string") return `${prefix}${ent.shortName.toLowerCase()}`;
  const base = name.split(",")[0].replace(/(?:adult|ancient|young) \w+ (dragon|dracolich)/gi, "$1");
  return `${prefix}${ent.isNamedCreature ? base.split(" ")[0] : base.toLowerCase()}`;
}

function cleanMath(expression: string): number {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) return NaN;
  // only digits and arithmetic reach here
  return Math.floor(Function(`"use strict"; return (${expression});`)() as number);
}

/** <$name$>, <$short_name$>, <$dc__str$>, <$to_hit__dex$>, <$damage_mod__str$>, <$damage_avg__…$>, <$size_mult__…$>. */
export function resolveVariables(value: unknown, ent: Json): unknown {
  return walkStrings(value, (s) =>
    s.replace(/<\$([^$]+)\$>/g, (whole, variable: string) => {
      const [mode, detail = ""] = variable.split("__");
      const pb = proficiencyForCr(ent.cr);
      const size = (Array.isArray(ent.size) ? ent.size[0] : ent.size) as string | undefined;
      switch (mode) {
        case "name":
          return String(ent.name ?? "");
        case "short_name":
          return shortName(ent);
        case "title_short_name":
          return shortName(ent, true);
        case "dc":
        case "spell_dc":
          return String(8 + abilityMod(ent[detail]) + pb);
        case "to_hit": {
          const total = pb + abilityMod(ent[detail]);
          return total >= 0 ? `+${total}` : String(total);
        }
        case "damage_mod": {
          const total = abilityMod(ent[detail]);
          return total === 0 ? "" : total > 0 ? ` + ${total}` : ` - ${Math.abs(total)}`;
        }
        case "damage_avg": {
          const expr = detail.replace(/\b(str|dex|con|int|wis|cha)\b/gi, (_, a: string) => String(abilityMod(ent[a.toLowerCase()]))).replace(/\bsize_mult\b/g, String(SIZE_MULT[size ?? ""] ?? 1));
          const n = cleanMath(expr);
          return Number.isNaN(n) ? whole : String(n);
        }
        case "size_mult": {
          const mult = SIZE_MULT[size ?? ""] ?? 1;
          if (!detail) return String(mult);
          const n = cleanMath(`${mult} * (${detail})`);
          return Number.isNaN(n) ? whole : String(n);
        }
        default:
          return whole;
      }
    }),
  );
}

// ---------------------------------------------------------------- modification modes

type Mod = Json | string;

function itemsOf(mod: Json): unknown[] {
  return mod.items === undefined ? [] : clone(asArray(mod.items as unknown));
}

function matchesName(it: unknown, target: unknown): boolean {
  const name = it && typeof it === "object" ? (it as Json).name : undefined;
  return name !== undefined ? name === target : it === target;
}

function applySpellMods(to: Json, mod: Json, mode: string, problem: (m: string) => void) {
  const casting = Array.isArray(to.spellcasting) ? (to.spellcasting as Json[]) : null;
  if (!casting?.length) return problem(`${mode}: no spellcasting`);
  const sc = mode === "addSpells" && typeof mod.name === "string" ? casting.find((c) => c.name === mod.name) : casting[0];
  if (!sc) return problem(`${mode}: no spellcasting named ${String(mod.name)}`);
  const usesProps = ["recharge", "legendary", "charges", "rest", "restLong", "daily", "weekly", "monthly", "yearly"];
  if (mode === "addSpells") {
    for (const [level, add] of Object.entries((mod.spells as Json) ?? {})) {
      const spells = ((sc.spells ??= {}) as Json);
      if (!spells[level]) spells[level] = clone(add);
      else {
        const old = spells[level] as Json;
        for (const [k, v] of Object.entries(add as Json)) old[k] = Array.isArray(old[k]) && Array.isArray(v) ? [...(old[k] as unknown[]), ...v] : v;
      }
    }
    for (const p of ["constant", "will", "ritual"]) if (Array.isArray(mod[p])) sc[p] = [...((sc[p] as unknown[]) ?? []), ...(mod[p] as unknown[])];
    for (const p of usesProps) {
      for (const [k, spells] of Object.entries((mod[p] as Json) ?? {})) {
        const bucket = ((sc[p] ??= {}) as Json);
        bucket[k] = [...((bucket[k] as unknown[]) ?? []), ...asArray(spells as unknown)];
      }
    }
  } else if (mode === "replaceSpells") {
    const replace = (list: unknown[], meta: Json) => {
      const ix = list.indexOf(meta.replace);
      if (ix >= 0) list.splice(ix, 1, ...asArray(meta.with as unknown));
      else problem(`replaceSpells: ${String(meta.replace)} not found`);
    };
    for (const [level, metas] of Object.entries((mod.spells as Json) ?? {})) {
      const list = ((sc.spells as Json | undefined)?.[level] as Json | undefined)?.spells as unknown[] | undefined;
      if (list) asArray(metas as Json[]).forEach((m) => replace(list, m));
    }
    for (const [k, metas] of Object.entries((mod.daily as Json) ?? {})) {
      const list = (sc.daily as Json | undefined)?.[k] as unknown[] | undefined;
      if (list) asArray(metas as Json[]).forEach((m) => replace(list, m));
    }
  } else if (mode === "removeSpells") {
    for (const [level, remove] of Object.entries((mod.spells as Json) ?? {})) {
      const slot = (sc.spells as Json | undefined)?.[level] as Json | undefined;
      if (slot && Array.isArray(slot.spells)) slot.spells = (slot.spells as unknown[]).filter((s) => !(remove as unknown[]).includes(s));
    }
    for (const p of ["constant", "will", "ritual"]) if (Array.isArray(mod[p]) && Array.isArray(sc[p])) sc[p] = (sc[p] as unknown[]).filter((s) => !(mod[p] as unknown[]).includes(s));
    for (const p of usesProps) {
      for (const [k, spells] of Object.entries((mod[p] as Json) ?? {})) {
        const bucket = sc[p] as Json | undefined;
        if (bucket && Array.isArray(bucket[k])) bucket[k] = (bucket[k] as unknown[]).filter((s) => !(spells as unknown[]).includes(s));
      }
    }
  }
}

function applyMod(to: Json, prop: string | null, mod: Mod, problem: (m: string) => void) {
  const path = prop ? prop.split(".") : [];
  if (typeof mod === "string") {
    if (mod === "remove" && prop) deletePath(to, path);
    else problem(`unknown modification "${mod}"`);
    return;
  }
  const mode = String(mod.mode);
  const existing = path.length ? getPath(to, path) : undefined;
  const list = Array.isArray(existing) ? (existing as unknown[]) : undefined;
  switch (mode) {
    case "appendStr":
      setPath(to, path, existing ? `${String(existing)}${String(mod.joiner ?? "")}${String(mod.str)}` : mod.str);
      break;
    case "prependArr":
      setPath(to, path, [...itemsOf(mod), ...(list ?? [])]);
      break;
    case "appendArr":
      setPath(to, path, [...(list ?? []), ...itemsOf(mod)]);
      break;
    case "appendIfNotExistsArr": {
      const add = itemsOf(mod).filter((it) => !(list ?? []).some((x) => JSON.stringify(x) === JSON.stringify(it)));
      setPath(to, path, [...(list ?? []), ...add]);
      break;
    }
    case "replaceArr":
    case "replaceOrAppendArr": {
      const r = mod.replace as unknown;
      const ix = !list
        ? -1
        : r && typeof r === "object" && (r as Json).regex
          ? list.findIndex((it) => {
              const re = new RegExp(String((r as Json).regex), String((r as Json).flags ?? ""));
              const name = it && typeof it === "object" ? (it as Json).name : it;
              return typeof name === "string" && re.test(name);
            })
          : r && typeof r === "object" && (r as Json).index != null
            ? Number((r as Json).index)
            : list.findIndex((it) => matchesName(it, r));
      if (list && ix >= 0) list.splice(ix, 1, ...itemsOf(mod));
      else if (mode === "replaceOrAppendArr") setPath(to, path, [...(list ?? []), ...itemsOf(mod)]);
      else problem(`replaceArr: "${JSON.stringify(r)}" not found in ${prop}`);
      break;
    }
    case "insertArr":
      if (!list) problem(`insertArr: no ${prop}`);
      else list.splice(Number(mod.index) >= 0 ? Number(mod.index) : list.length, 0, ...itemsOf(mod));
      break;
    case "removeArr":
      if (!list) {
        if (!mod.force) problem(`removeArr: no ${prop}`);
        break;
      }
      for (const n of mod.names !== undefined ? asArray(mod.names as unknown) : asArray(mod.items as unknown)) {
        const ix = mod.names !== undefined ? list.findIndex((it) => it && typeof it === "object" && (it as Json).name === n) : list.indexOf(n);
        if (ix >= 0) list.splice(ix, 1);
        else if (!mod.force) problem(`removeArr: "${String(n)}" not in ${prop}`);
      }
      break;
    case "renameArr":
      for (const r of asArray(mod.renames as Json)) {
        const it = list?.find((x) => x && typeof x === "object" && (x as Json).name === r.rename) as Json | undefined;
        if (it) it.name = r.with;
        else problem(`renameArr: "${String(r.rename)}" not in ${prop}`);
      }
      break;
    case "replaceTxt":
    case "replaceName": {
      if (!list) break;
      const re = new RegExp(String(mod.replace), `g${String(mod.flags ?? "")}`);
      const fn = (s: string) => (mod.tagInsensitive ? s.replace(re, String(mod.with)) : replaceOutsideTags(s, re, String(mod.with)));
      if (mode === "replaceName") {
        for (const it of list) if (it && typeof it === "object" && typeof (it as Json).name === "string") (it as Json).name = fn((it as Json).name as string);
        break;
      }
      const props = (mod.props as (string | null)[] | undefined) ?? [null, "entries", "headerEntries", "footerEntries"];
      if (props.includes(null)) setPath(to, path, list.map((it) => (typeof it === "string" ? fn(it) : it)));
      const after = getPath(to, path) as unknown[];
      for (const it of after) {
        if (!it || typeof it !== "object") continue;
        for (const p of props) if (p && (it as Json)[p]) (it as Json)[p] = walkStrings((it as Json)[p], fn);
      }
      break;
    }
    case "setProp": {
      const full = [...path.filter((p) => p !== "*"), ...(mod.prop ? String(mod.prop).split(".") : [])];
      setPath(to, full, clone(mod.value));
      break;
    }
    case "prefixSuffixStringProp": {
      const full = [...path.filter((p) => p !== "*"), ...(mod.prop ? String(mod.prop).split(".") : [])];
      const s = getPath(to, full);
      if (typeof s === "string") setPath(to, full, `${String(mod.prefix ?? "")}${s}${String(mod.suffix ?? "")}`);
      break;
    }
    case "scalarAddProp":
    case "scalarMultProp": {
      const target = mod.prop === "*" ? (existing as Json) : (getPath(to, [...path, String(mod.prop)]) as unknown);
      const apply = (v: unknown) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return v;
        const out = mode === "scalarAddProp" ? n + Number(mod.scalar) : n * Number(mod.scalar);
        const rounded = mod.floor ? Math.floor(out) : out;
        return typeof v === "string" && v.startsWith("+") ? `+${rounded}` : typeof v === "string" ? String(rounded) : rounded;
      };
      if (mod.prop === "*" && target && typeof target === "object") for (const k of Object.keys(target)) (target as Json)[k] = apply((target as Json)[k]);
      else if (target !== undefined) setPath(to, [...path, String(mod.prop)], apply(target));
      break;
    }
    case "addSkills": {
      const skills = ((to.skill ??= {}) as Json);
      for (const [skill, level] of Object.entries((mod.skills as Json) ?? {})) {
        const total = Number(level) * proficiencyForCr(to.cr) + abilityMod(to[SKILL_ABILITY[skill] ?? "wis"]);
        if (skills[skill] === undefined || Number(skills[skill]) < total) skills[skill] = total >= 0 ? `+${total}` : String(total);
      }
      break;
    }
    case "addSaves":
    case "addAllSaves": {
      const saves = ((to.save ??= {}) as Json);
      const which = mode === "addAllSaves" ? Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((a) => [a, mod.saves])) : ((mod.saves as Json) ?? {});
      for (const [ability, level] of Object.entries(which)) {
        const total = Number(level) * proficiencyForCr(to.cr) + abilityMod(to[ability]);
        if (saves[ability] === undefined || Number(saves[ability]) < total) saves[ability] = total >= 0 ? `+${total}` : String(total);
      }
      break;
    }
    case "addSenses": {
      const senses = (Array.isArray(to.senses) ? to.senses : []) as string[];
      for (const s of asArray(mod.senses as Json)) {
        const text = `${String(s.type)} ${String(s.range)} ft.`;
        const ix = senses.findIndex((x) => x.toLowerCase().startsWith(String(s.type).toLowerCase()));
        if (ix < 0) senses.push(text);
      }
      to.senses = senses;
      break;
    }
    case "addSpells":
    case "replaceSpells":
    case "removeSpells":
      applySpellMods(to, mod, mode, problem);
      break;
    case "maxSize": {
      const order = ["F", "D", "T", "S", "M", "L", "H", "G", "C", "V"];
      const max = order.indexOf(String(mod.max));
      if (Array.isArray(to.size)) to.size = (to.size as string[]).map((s) => (order.indexOf(s) > max ? String(mod.max) : s));
      break;
    }
    case "scalarAddHit":
    case "scalarAddDc": {
      if (!list) break;
      const re = mode === "scalarAddHit" ? /\{@hit ([-+]?\d+)\}/g : /\{@dc (\d+)(?:\|[^}]+)?\}/g;
      const scalar = Number(mod.scalar);
      setPath(
        to,
        path,
        walkStrings(list, (s) => s.replace(re, (_, n: string) => (mode === "scalarAddHit" ? `{@hit ${Number(n) + scalar}}` : `{@dc ${Number(n) + scalar}}`))),
      );
      break;
    }
    case "scalarMultXp":
    case "calculateProp":
      // display-only arithmetic (experience, derived values): leave as printed
      break;
    default:
      problem(`unknown modification mode "${mode}"`);
  }
}

export interface CopyOptions {
  /** templates by "name|source" lower-cased (monster templates) */
  templates?: Map<string, Json>;
  problem: (message: string) => void;
}

/** An entry made whole from its original: the copy's own fields win, then the modifications are applied. */
export function applyCopy(original: Json, copy: Json, options: CopyOptions): Json {
  const meta = (copy._copy ?? {}) as Json;
  const out: Json = clone(copy);
  const from = clone(original);
  const label = `${String(copy.name)} (${String(copy.source)})`;
  const problem = (m: string) => options.problem(`copy ${label}: ${m}`);

  const mods: Record<string, Mod[]> = {};
  for (const [k, v] of Object.entries((meta._mod as Json) ?? {})) mods[k] = asArray(v as Mod);
  const templates: Json[] = [];
  for (const t of asArray((meta._templates as Json[] | undefined) ?? [])) {
    const found = options.templates?.get(`${String(t.name).toLowerCase()}|${String(t.source).toLowerCase()}`);
    if (!found) problem(`template ${String(t.name)} not found`);
    else templates.push(clone(found));
  }
  for (const t of templates) {
    for (const [k, v] of Object.entries(((t.apply as Json | undefined)?._mod as Json) ?? {})) mods[k] = [...(mods[k] ?? []), ...asArray(v as Mod)];
  }

  const preserve = (meta._preserve as Json | undefined) ?? {};
  const ownRoot = new Set(Object.keys(copy));
  for (const [k, v] of Object.entries(from)) {
    if (out[k] === null) {
      delete out[k];
      continue;
    }
    if (out[k] !== undefined) continue;
    if (NEEDS_PRESERVE.has(k) && !preserve["*"] && !preserve[k]) continue;
    out[k] = v;
  }
  for (const t of templates) for (const [k, v] of Object.entries(((t.apply as Json | undefined)?._root as Json) ?? {})) if (!ownRoot.has(k)) out[k] = clone(v);

  const order = (p: string) => (p === "_" ? 1 : p === "*" ? 2 : 0);
  for (const [prop, list] of Object.entries(mods).sort(([a], [b]) => order(a) - order(b))) {
    const resolved = resolveVariables(list, out) as Mod[];
    for (const mod of resolved) {
      if (prop === "*") for (const p of ENTRY_PROPS) applyMod(out, p, mod, () => {});
      else if (prop === "_") applyMod(out, null, mod, problem);
      else applyMod(out, prop, mod, problem);
    }
  }
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  delete out._copy;
  if (templates.length) out._templatesApplied = templates.map((t) => t.name);
  return out;
}

/**
 * Resolves every copy in a list (copies of copies too; the original may be in another book's file of the same
 * list). Entries whose original cannot be found are kept as they are and reported.
 */
export function resolveCopies(entries: Json[], keyOf: (e: Json) => string, options: CopyOptions): Json[] {
  const byKey = new Map<string, Json>();
  for (const e of entries) if (!byKey.has(keyOf(e))) byKey.set(keyOf(e), e);
  const done = new Map<string, Json>();
  const resolving = new Set<string>();
  const resolve = (e: Json): Json => {
    const key = keyOf(e);
    if (done.has(key) && done.get(key) !== undefined && !e._copy) return e;
    if (!e._copy) return e;
    if (done.has(key)) return done.get(key)!;
    const meta = e._copy as Json;
    const originalKey = keyOf({ name: meta.name, source: meta.source } as Json);
    const original = byKey.get(originalKey);
    if (!original || resolving.has(key)) {
      options.problem(`copy ${String(e.name)} (${String(e.source)}): original ${String(meta.name)} (${String(meta.source)}) not found`);
      const kept = { ...e };
      delete kept._copy;
      done.set(key, kept);
      return kept;
    }
    resolving.add(key);
    const whole = applyCopy(resolve(original), e, options);
    resolving.delete(key);
    done.set(key, whole);
    return whole;
  };
  return entries.map((e) => (e._copy ? resolve(e) : e));
}

/** The versions an entry prints ("_versions", and variants marked as versions), each as a whole entry. */
export function expandVersions(parent: Json, options: CopyOptions): Json[] {
  const versions: Json[] = [];
  const list = [...((parent._versions as Json[] | undefined) ?? [])];
  for (const v of (parent.variant as Json[] | undefined) ?? []) {
    const ver = v._version as Json | undefined;
    if (!ver) continue;
    const add: Json = { name: ver.name ?? v.name, source: ver.source ?? v.source ?? parent.source, variant: null };
    if (ver.addAs) {
      const item = clone(v);
      delete item._version;
      delete item.type;
      delete item.source;
      delete item.page;
      add._mod = { [String(ver.addAs)]: { mode: "appendArr", items: item } };
    } else if (ver.addHeadersAs) {
      const items = ((v.entries as Json[] | undefined) ?? []).filter((e) => e && typeof e === "object" && e.name && e.entries).map((e) => {
        const c = clone(e);
        delete c.type;
        delete c.source;
        return c;
      });
      add._mod = { [String(ver.addHeadersAs)]: { mode: "appendArr", items } };
    } else continue;
    list.push(add);
  }
  for (const ver of list) {
    const concrete: Json[] =
      ver._abstract && Array.isArray(ver._implementations)
        ? (ver._implementations as Json[]).map((impl) => {
            const vars = (impl._variables as Record<string, string> | undefined) ?? {};
            const template = walkStrings(clone(ver._abstract), (s) => s.replace(/\{\{([^}]+)\}\}/g, (_, k: string) => vars[k] ?? "")) as Json;
            const own = clone(impl);
            delete own._variables;
            return { ...template, ...own };
          })
        : [clone(ver)];
    for (const c of concrete) {
      const asCopy: Json = { ...c, _copy: { _mod: c._mod, _templates: c._templates, _preserve: c._preserve ?? { "*": true } } };
      delete asCopy._mod;
      delete asCopy._templates;
      delete asCopy._preserve;
      const base = clone(parent);
      delete base._versions;
      delete base.hasToken;
      delete base.hasFluff;
      delete base.hasFluffImages;
      const whole = applyCopy(base, asCopy, options);
      whole._versionOf = { name: parent.name, source: parent.source };
      versions.push(whole);
    }
  }
  return versions;
}
