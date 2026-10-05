/** Spells: the list with its filters (level, school, class, concentration, ritual, …) and each source's file. */
import { join } from "node:path";
import { entryKey } from "../src/lib/lore/keys.ts";
import { componentsText, durationText, isConcentration, rangeText, timeText, timeUnit } from "../src/lib/lore/spell-text.ts";
import type { LoreEntry, SpellRow } from "../src/lib/lore/types.ts";
import { baseRow, fluffByKey, list, readIndexed, readJson, str, withFluff, type Context, type Json } from "./common.ts";

type ClassLookup = Record<string, Record<string, { class?: Record<string, Record<string, unknown>>; classVariant?: Record<string, Record<string, unknown>> }>>;

/** The classes that have a spell, from the release's generated lookup: [{name, source}], and the names for filtering. */
function spellClasses(lookup: ClassLookup, name: string, source: string) {
  const found = lookup[source.toLowerCase()]?.[name.toLowerCase()];
  const refs: { name: string; source: string; variant?: boolean }[] = [];
  for (const [kind, variant] of [["class", false], ["classVariant", true]] as const) {
    for (const [classSource, classes] of Object.entries(found?.[kind] ?? {})) {
      for (const className of Object.keys(classes)) refs.push({ name: className, source: classSource, ...(variant ? { variant } : {}) });
    }
  }
  return refs;
}

export function ingestSpells(ctx: Context) {
  const folder = join(ctx.data, "spells");
  const spells = list(readIndexed(folder), "spell");
  const fluff = fluffByKey(list(readIndexed(folder, "fluff-index.json"), "spellFluff"), ctx.report);
  const lookup = readJson(join(ctx.data, "generated", "gendata-spell-source-lookup.json")) as unknown as ClassLookup;

  const rows: SpellRow[] = [];
  const chunks: Record<string, Record<string, LoreEntry>> = {};
  for (const s of spells) {
    const base = baseRow(ctx, s);
    const classes = spellClasses(lookup, base.name, base.src);
    const meta = (s.meta ?? {}) as Json;
    rows.push({
      ...base,
      lvl: typeof s.level === "number" ? s.level : 0,
      school: str(s.school) ?? "",
      classes: [...new Set(classes.map((c) => c.name))].sort(),
      ...(isConcentration(s.duration) ? { conc: true } : {}),
      ...(meta.ritual ? { ritual: true } : {}),
      time: timeText(s.time),
      timeUnit: timeUnit(s.time),
      range: rangeText(s.range),
      comp: componentsText(s.components),
      dur: durationText(s.duration),
      ...(Array.isArray(s.damageInflict) ? { dmg: s.damageInflict as string[] } : {}),
      ...(Array.isArray(s.savingThrow) ? { save: s.savingThrow as string[] } : {}),
      ...(Array.isArray(s.conditionInflict) ? { cond: s.conditionInflict as string[] } : {}),
    });
    (chunks[base.src] ??= {})[base.k] = { ...withFluff(s, fluff.get(entryKey(base.name, base.src))), _classes: classes };
    ctx.report.count("spells", base.src);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src));
  return { rows, chunks };
}
