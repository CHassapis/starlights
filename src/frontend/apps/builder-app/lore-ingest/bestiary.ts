/**
 * The bestiary: every creature with copies, templates and versions resolved, its lair actions and regional effects
 * (legendary group) attached, and its lore and pictures. List rows carry the filters (challenge, size, type,
 * environment, alignment, movement, defenses and the rest).
 */
import { join } from "node:path";
import { entryKey } from "../src/lib/lore/keys.ts";
import { alignmentAxes, crString, crValue, damageTypes, mainTypes, speedKinds, typeText } from "../src/lib/lore/monster-text.ts";
import type { BestiaryRow, LoreEntry } from "../src/lib/lore/types.ts";
import { expandVersions, resolveCopies } from "./copy.ts";
import { baseRow, fluffByKey, list, readIndexed, readJson, str, withFluff, type Context, type Json } from "./common.ts";

const keyOf = (e: Json) => entryKey(str(e.name) ?? "", str(e.source) ?? "");

export function ingestBestiary(ctx: Context) {
  const folder = join(ctx.data, "bestiary");
  const raw = list(readIndexed(folder), "monster");
  const templateFile = readJson(join(folder, "template.json"));
  const templates = new Map<string, Json>();
  for (const t of (templateFile.monsterTemplate as Json[] | undefined) ?? []) templates.set(`${String(t.name).toLowerCase()}|${String(t.source).toLowerCase()}`, t);
  const problem = (m: string) => ctx.report.problem(`bestiary ${m}`);

  const resolved = resolveCopies(raw, keyOf, { templates, problem });
  const versions = resolved.flatMap((m) => (m._versions || (Array.isArray(m.variant) && (m.variant as Json[]).some((v) => v._version)) ? expandVersions(m, { templates, problem }) : []));
  const monsters = [...resolved, ...versions];

  const groups = new Map<string, Json>();
  for (const g of resolveCopies(((readJson(join(folder, "legendarygroups.json")).legendaryGroup as Json[]) ?? []), keyOf, { problem })) groups.set(keyOf(g), g);
  const fluff = fluffByKey(list(readIndexed(folder, "fluff-index.json"), "monsterFluff"), ctx.report);

  const rows: BestiaryRow[] = [];
  const chunks: Record<string, Record<string, LoreEntry>> = {};
  const seen = new Set<string>();
  for (const m of monsters) {
    const base = baseRow(ctx, m);
    if (seen.has(base.k)) continue;
    seen.add(base.k);
    const lg = m.legendaryGroup as Json | undefined;
    const group = lg ? groups.get(keyOf(lg)) : undefined;
    if (lg && !group) problem(`legendary group ${String(lg.name)} (${String(lg.source)}) not found for ${base.name}`);
    const versionOf = m._versionOf as Json | undefined;
    // a version shows its parent's lore and pictures
    const lore = fluff.get(base.k) ?? (versionOf ? fluff.get(keyOf(versionOf)) : undefined);
    const misc = [
      ...(m.legendary ? ["legendary"] : []),
      ...(m.mythic ? ["mythic"] : []),
      ...(group ? ["lair"] : []),
      ...(m.spellcasting ? ["spellcaster"] : []),
      ...((m.type as Json | undefined)?.swarmSize ? ["swarm"] : []),
      ...(m.isNamedCreature ? ["named"] : []),
      ...(versionOf ? ["version"] : []),
    ];
    const immune = damageTypes(m.immune, "immune");
    const resist = damageTypes(m.resist, "resist");
    const vuln = damageTypes(m.vulnerable, "vulnerable");
    const condImm = Array.isArray(m.conditionImmune) ? (m.conditionImmune as unknown[]).flatMap((c) => (typeof c === "string" ? [c] : Array.isArray((c as Json).conditionImmune) ? ((c as Json).conditionImmune as string[]) : [])) : [];
    rows.push({
      ...base,
      cr: crString(m.cr) || "—",
      crn: crValue(m.cr),
      size: Array.isArray(m.size) ? (m.size as string[]) : [],
      type: mainTypes(m.type),
      typeText: typeText(m.type),
      ...(Array.isArray(m.environment) ? { env: (m.environment as string[]).map((e) => e.split(",")[0].trim()) } : {}),
      ...(m.alignment ? { align: alignmentAxes(m.alignment) } : {}),
      ...(speedKinds(m.speed).length ? { speed: speedKinds(m.speed) } : {}),
      ...(misc.length ? { misc } : {}),
      ...(immune.length ? { immune } : {}),
      ...(resist.length ? { resist } : {}),
      ...(vuln.length ? { vuln } : {}),
      ...(condImm.length ? { condImm } : {}),
    });
    const entry = withFluff(m, lore);
    if (group) entry._legendaryGroup = group;
    delete entry._versions;
    (chunks[base.src] ??= {})[base.k] = entry;
    ctx.report.count("bestiary", base.src);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.src.localeCompare(b.src));
  return { rows, chunks };
}
