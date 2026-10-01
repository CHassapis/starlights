import { apiClient } from "@/lib/api-client";
import type { BuilderChoice } from "@/lib/api/builder";
import { shrinkImage } from "@/lib/image";

/**
 * Imports a character saved by the Aurora desktop builder (.dnd5e). Aurora stores every choice as
 * <element type="…" name="…" number="n" registered="ID_…">, nested under the element that offered it; Starlights
 * imported the same choices under the same names, so the picks are replayed slot by slot as the builder unlocks
 * them (a class's choices appear once the class is picked, a subclass once the level allows it, …).
 */

export interface AuroraImportReport {
  characterId: string;
  name: string;
  playerInFile: string;
  picked: number;
  /** picks whose element is not in the imported content (homebrew, custom sources) */
  missing: string[];
  /** picks whose choice did not come up in the Starlights build */
  unmatched: string[];
}

interface Pick {
  type: string;
  name: string;
  slot: number;
  /** level the choice comes at (Aurora's requiredLevel); tells apart e.g. the level 1 and level 4 cantrip choices */
  level: number;
  registered: string;
  /** Aurora id of the element that offers the choice; null for the top-level class/race/background/alignment */
  parent: string | null;
}

// Aurora's top-level choices and the Starlights sections they correspond to
const TOP_LEVEL: Record<string, string> = { Race: "Species", Class: "Class", Background: "Background", Alignment: "Alignment", Deity: "Deity" };

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function text(root: Element | null | undefined, selector: string): string {
  return root?.querySelector(selector)?.textContent?.trim() ?? "";
}

function idVariants(id: string): string[] {
  const variants = [id];
  if (id.includes("_ARCHETYPE_FEATURE_")) variants.push(id.replace("_ARCHETYPE_FEATURE_", "_ARCHETYPE_"));
  else if (id.includes("_ARCHETYPE_")) variants.push(id.replace("_ARCHETYPE_", "_ARCHETYPE_FEATURE_"));
  return variants;
}

function collectPicks(elements: Element): Pick[] {
  const picks: Pick[] = [];
  for (const node of Array.from(elements.querySelectorAll("element[registered]"))) {
    const registered = node.getAttribute("registered")?.trim();
    const type = node.getAttribute("type") ?? "";
    const name = node.getAttribute("name") ?? "";
    if (!registered || !name) continue;

    // the owner is the nearest ancestor that is itself a pick (its chosen element) or a granted element
    let parent: string | null = null;
    for (let a = node.parentElement; a && a !== elements; a = a.parentElement) {
      if (a.getAttribute("type") === "Level") break;
      parent = a.getAttribute("registered") || a.getAttribute("id");
      if (parent) break;
    }
    const level = Number(node.getAttribute("requiredLevel") ?? "1") || 1;
    picks.push({ type, name, slot: Number(node.getAttribute("number") ?? "1") || 1, level, registered, parent });
  }
  return picks;
}

async function settledChoices(characterId: string): Promise<BuilderChoice[]> {
  await sleep(400);
  for (let i = 0; i < 40; i++) {
    const { choices, pending } = await apiClient.get<{ choices: BuilderChoice[]; pending: boolean }>(`/api/characters/${characterId}/builder/choices`);
    if (!pending) return choices;
    await sleep(400);
  }
  return (await apiClient.get<{ choices: BuilderChoice[] }>(`/api/characters/${characterId}/builder/choices`)).choices;
}

async function base64Blob(base64: string): Promise<Blob> {
  const bytes = Uint8Array.from(atob(base64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return new Blob([bytes]);
}

export async function importAuroraCharacter(
  xmlText: string,
  player: string,
  knownSources: string[],
  onProgress?: (message: string) => void,
): Promise<AuroraImportReport> {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const character = doc.querySelector("character");
  const build = character?.querySelector(":scope > build");
  const elements = build?.querySelector(":scope > elements");
  if (!character || !build || !elements || doc.querySelector("parsererror")) {
    throw new Error("This is not an Aurora character file (.dnd5e).");
  }

  const display = character.querySelector(":scope > display-properties");
  const name = text(build, ":scope > input > name") || text(display, ":scope > name") || "Imported character";
  const level = Math.min(20, Math.max(1, Number(text(display, ":scope > level")) || Number(elements.getAttribute("level-count")) || 1));

  // Aurora keeps the switched-off sources; keep the ones that exist here
  const known = new Set(knownSources);
  const restricted = Array.from(character.querySelectorAll(":scope > sources > restricted > source"))
    .map((s) => s.textContent?.trim() ?? "")
    .filter((s) => known.has(s));

  onProgress?.(`Creating ${name}…`);
  const options = await apiClient.get<{ options: { id: string }[] }>("/api/characters/creation-options");
  const created = await apiClient.post<object, { id: string }>("/api/characters", {
    characterCreationOptionId: options.options[0].id,
    name,
    playerName: player,
    restrictedSources: restricted,
  });
  const characterId = created.id;

  const portrait = text(display, ":scope > portrait > base64");
  if (portrait) {
    try {
      const data = await shrinkImage(await base64Blob(portrait));
      await apiClient.post(`/api/characters/${characterId}/portrait`, { data });
    } catch {
      // a portrait the browser cannot read is not worth failing the import for
    }
  }

  const picks = collectPicks(elements);
  const ids = await lookupIds(picks, doc);

  const report: AuroraImportReport = { characterId, name, playerInFile: text(build, ":scope > input > player-name"), picked: 0, missing: [], unmatched: [] };
  const open = picks.filter((p) => {
    if (!ids[p.registered]) {
      report.missing.push(`${p.name}: ${p.registered}`);
      return false;
    }
    return p.parent !== null || p.type in TOP_LEVEL;
  });

  async function register(choice: BuilderChoice, elementId: string) {
    await apiClient.post(`/api/characters/${characterId}/builder/selection-rules/${choice.ruleId}/register`, {
      parentRegistration: choice.registrationId,
      elementId,
    });
    report.picked++;
  }

  // class first (its level gates the rest), then the other top-level picks, then everything they unlock
  let choices = await settledChoices(characterId);
  for (const type of ["Class", "Race", "Background", "Alignment", "Deity"]) {
    const pick = open.find((p) => p.parent === null && p.type === type);
    const slot = choices.find((c) => c.depth === 0 && c.section === TOP_LEVEL[type]);
    if (pick && slot) {
      onProgress?.(`${name}: ${TOP_LEVEL[type]}…`);
      await register(slot, ids[pick.registered]);
      open.splice(open.indexOf(pick), 1);
    }
  }
  choices = await settledChoices(characterId);

  const classes = await apiClient.get<{ classes: { characterClassId: string; level: number; isPrimary: boolean }[] }>(`/api/characters/${characterId}/classes`);
  const primary = classes.classes.find((c) => c.isPrimary) ?? classes.classes[0];
  if (primary && level > 1) {
    onProgress?.(`${name}: level ${level}…`);
    await apiClient.post(`/api/characters/${characterId}/classes/${primary.characterClassId}/level`, { newLevel: level });
  }

  const proxies = await addFeatProxies(characterId, doc, ids);
  open.push(...proxies);
  report.picked += await fillChoices(characterId, open, ids, { onlyEmpty: false, label: name, onProgress });
  report.unmatched = await unmatchedPicks(characterId, open, ids);

  // backstory, personality and appearance, under the Story tab's field names
  const story: Record<string, string> = {};
  const storyFields: [string, string][] = [
    ["input > gender", "gender"],
    ["input > backstory", "backstory"],
    ["input > background-traits", "traits"],
    ["input > background-ideals", "ideals"],
    ["input > background-bonds", "bonds"],
    ["input > background-flaws", "flaws"],
    ["input > background-trinket", "trinket"],
    ["input > background", "background"],
    ["input > experience", "experience"],
    ["input > additional-features", "features"],
    ["input > quest", "quests"],
    ["input > notes", "notes"],
    ["appearance > age", "age"],
    ["appearance > height", "height"],
    ["appearance > weight", "weight"],
    ["appearance > eyes", "eyes"],
    ["appearance > skin", "skin"],
    ["appearance > hair", "hair"],
  ];
  for (const [selector, key] of storyFields) {
    const value = text(build, `:scope > ${selector}`);
    if (value) story[key] = value;
  }
  // Aurora keeps the organization's name and the allies text under <organization> (its symbol is a path on the
  // Aurora user's own computer, so it cannot come along)
  const organization = text(build, ":scope > input > organization > name");
  const allies = text(build, ":scope > input > organization > allies");
  if (organization) story.organization = organization;
  if (allies) story.allies = allies;
  if (Object.keys(story).length > 0) {
    await apiClient.put(`/api/characters/${characterId}/story`, { fields: story });
  }

  // old Aurora-internal ability score increases (not in Aurora Legacy) were +1 to one ability each
  const internalIncreases: Record<string, number> = {};
  for (const pick of picks) {
    const ability = pick.registered.match(/^ID_INTERNAL_ASI_([A-Z]+)$/)?.[1]?.toLowerCase();
    if (ability && ABILITIES.includes(ability) && !ids[pick.registered]) {
      internalIncreases[ability] = (internalIncreases[ability] ?? 0) + 1;
      report.missing = report.missing.filter((m) => !m.endsWith(pick.registered));
    }
  }

  onProgress?.(`${name}: prepared spells…`);
  await importAuroraPreparedSpells(characterId, doc);
  onProgress?.(`${name}: equipment…`);
  await importAuroraEquipment(characterId, doc);

  onProgress?.(`${name}: ability scores…`);
  const scores = await apiClient.get<{ abilityScores: { abilityScoreId: string; name: string }[] }>(`/api/characters/${characterId}/ability-scores`);
  for (const ability of ABILITIES) {
    const value = Number(text(build, `:scope > abilities > ${ability}`)) + (internalIncreases[ability] ?? 0);
    const target = scores.abilityScores?.find((s) => s.name.toLowerCase() === ability);
    if (target && value > 0) {
      await apiClient.post(`/api/characters/${characterId}/ability-scores/${target.abilityScoreId}/base`, { value });
    }
  }

  return report;
}

/**
 * The spells prepared in an Aurora file's <magic> section, per spellcasting ("Cleric"), saved as the character's
 * prepared spells. Aurora's always-prepared spells (domain spells, a wizard's whole spellbook) are left out: the
 * rules know those. Prepared spells already saved for a spellcasting are kept. Returns how many were added.
 */
export async function importAuroraPreparedSpells(characterId: string, doc: Document): Promise<number> {
  const wanted: Record<string, string[]> = {};
  for (const casting of Array.from(doc.querySelectorAll("magic > spellcasting"))) {
    const name = casting.getAttribute("name");
    const prepared = Array.from(casting.querySelectorAll(":scope > spells > spell"))
      .filter((s) => s.getAttribute("prepared") === "true" && s.getAttribute("always-prepared") !== "true")
      .map((s) => s.getAttribute("id") ?? "")
      .filter(Boolean);
    if (name && prepared.length > 0) wanted[name] = prepared;
  }
  const auroraIds = [...new Set(Object.values(wanted).flat())];
  if (auroraIds.length === 0) return 0;

  const { elements: ids } = await apiClient.post<{ ids: string[] }, { elements: Record<string, string> }>("/api/elements/aurora-lookup", { ids: auroraIds });
  const magic = await apiClient.get<{ version: number; prepared: Record<string, string[]>; expendedSlots: Record<string, number>; expendedPactSlots: number }>(
    `/api/characters/${characterId}/magic`,
  );
  let added = 0;
  const prepared = { ...magic.prepared };
  for (const [name, list] of Object.entries(wanted)) {
    const current = new Set(prepared[name] ?? []);
    for (const id of list.map((a) => ids[a]).filter(Boolean)) {
      if (!current.has(id)) {
        current.add(id);
        added++;
      }
    }
    prepared[name] = [...current];
  }
  if (added > 0) await apiClient.put(`/api/characters/${characterId}/magic`, { ...magic, prepared });
  return added;
}

/** Aurora ids (with the homebrew id variants) to Starlights element ids, for the picks and what the file's gear and feat proxies need. */
async function lookupIds(picks: Pick[], doc: Document): Promise<Record<string, string>> {
  const gear = Array.from(doc.querySelectorAll("build > equipment > item")).flatMap((item) => [
    item.getAttribute("id") ?? "",
    ...Array.from(item.querySelectorAll(":scope > items > adorner")).map((a) => a.getAttribute("id") ?? ""),
  ]);
  const proxied = featProxies(doc).map((p) => p.feat);
  const wanted = [...new Set([...picks.flatMap((p) => [p.registered, p.parent ?? ""]), ...gear, ...proxied, EXTRA_FEAT].filter(Boolean))];
  const { elements: ids } = await apiClient.post<{ ids: string[] }, { elements: Record<string, string> }>("/api/elements/aurora-lookup", {
    ids: [...new Set(wanted.flatMap(idVariants))],
  });
  // homebrew ids sometimes change between versions of a file ("…_ARCHETYPE_FEATURE_…" vs "…_ARCHETYPE_…")
  for (const id of wanted) {
    if (!ids[id]) {
      const variant = idVariants(id).find((v) => ids[v]);
      if (variant) ids[id] = ids[variant];
    }
  }
  return ids;
}

async function registerPick(characterId: string, choice: BuilderChoice, elementId: string) {
  await apiClient.post(`/api/characters/${characterId}/builder/selection-rules/${choice.ruleId}/register`, {
    parentRegistration: choice.registrationId,
    elementId,
  });
}

/**
 * Fills the builder's choices with the file's picks, pass after pass as choices unlock (a feat's own choice once
 * the feat is picked). With onlyEmpty a choice the character already made is left as it is. Picks that found
 * their choice are taken out of `open`; returns how many were registered.
 */
async function fillChoices(
  characterId: string,
  open: Pick[],
  ids: Record<string, string>,
  options: { onlyEmpty: boolean; label: string; onProgress?: (message: string) => void },
): Promise<number> {
  let picked = 0;
  for (let pass = 0; pass < 30 && open.length > 0; pass++) {
    const choices = await settledChoices(characterId);
    const bySlot = new Map(choices.map((c) => [`${c.parentElementId}|${c.name}|${Math.max(1, c.level)}|${c.slot}`, c]));
    let progress = false;

    for (const pick of [...open]) {
      const parentId = pick.parent ? ids[pick.parent] : undefined;
      // exact name first; otherwise the one open choice of the same element, level and slot whose name ends in
      // the same "(…)" (homebrew renamed "Skill (X)" to "Skill Proficiency (X)")
      const suffix = pick.name.match(/\([^)]*\)$/)?.[0];
      const loose = choices.filter(
        (c) => c.parentElementId === parentId && Math.max(1, c.level) === pick.level && c.slot === pick.slot && !!suffix && c.name.endsWith(suffix),
      );
      const choice = parentId && (bySlot.get(`${parentId}|${pick.name}|${pick.level}|${pick.slot}`) ?? (loose.length === 1 ? loose[0] : undefined));
      if (!choice) continue;

      open.splice(open.indexOf(pick), 1);
      const differs = choice.selected?.elementId !== ids[pick.registered];
      if (options.onlyEmpty ? !choice.selected : differs) {
        options.onProgress?.(`${options.label}: ${pick.name}…`);
        await registerPick(characterId, choice, ids[pick.registered]);
        picked++;
        progress = true;
      }
    }
    if (!progress) break;
  }
  return picked;
}

/** The file's picks that found no choice, leaving out what the character has another way (newer content grants it). */
async function unmatchedPicks(characterId: string, open: Pick[], ids: Record<string, string>): Promise<string[]> {
  const has = await registeredElements(characterId);
  return open.filter((p) => p.parent !== null && !has.has(ids[p.registered])).map((p) => `${p.name} (${p.registered})`);
}

async function registeredElements(characterId: string): Promise<Set<string>> {
  const registered = await apiClient.get<{ registrations: { associatedElementId: string; children?: unknown[] }[] }>(`/api/characters/${characterId}/registrations`);
  const has = new Set<string>();
  const walk = (list: { associatedElementId: string; children?: unknown[] }[]) =>
    list.forEach((r) => {
      has.add(r.associatedElementId);
      walk((r.children ?? []) as { associatedElementId: string; children?: unknown[] }[]);
    });
  walk(registered.registrations);
  return has;
}

const EXTRA_FEAT = "ID_STARLIGHTS_EXTRA_FEAT";

/** Old Aurora's "Additional Feat, Resilient" items: a hidden item that grants a feat. */
function featProxies(doc: Document): { proxy: string; feat: string }[] {
  return Array.from(doc.querySelectorAll('build > elements element[type="Item"]'))
    .filter((e) => /_ITEM_FEAT_PROXY_/.test(e.getAttribute("id") ?? ""))
    .map((e) => ({ proxy: e.getAttribute("id") ?? "", feat: e.querySelector(':scope > element[type="Feat"]')?.getAttribute("id") ?? "" }))
    .filter((p) => p.feat);
}

/**
 * A feat an old Aurora file gives through a proxy item becomes an Additional Feat extra with that feat picked
 * (its own choices, such as Resilient's ability, follow as ordinary picks). Feats the character already has are
 * skipped. Returns the picks to fill.
 */
async function addFeatProxies(characterId: string, doc: Document, ids: Record<string, string>): Promise<Pick[]> {
  const proxies = featProxies(doc).filter((p) => ids[p.feat]);
  if (proxies.length === 0 || !ids[EXTRA_FEAT]) return [];
  const has = await registeredElements(characterId);
  const picks: Pick[] = [];
  for (const proxy of proxies.filter((p) => !has.has(ids[p.feat]))) {
    await apiClient.post(`/api/characters/${characterId}/extras`, { elementId: ids[EXTRA_FEAT] });
    picks.push({ type: "Feat", name: "Additional Feat", slot: 1, level: 1, registered: proxy.feat, parent: EXTRA_FEAT });
  }
  return picks;
}

// Aurora's equipment slots and the Equipment tab's
const SLOTS: Record<string, string> = { "Primary Hand": "Main Hand", "Secondary Hand": "Off Hand", "Two-Handed": "Two-Handed", Armor: "Armor" };
const COINS: [string, string][] = [
  ["copper", "cp"],
  ["silver", "sp"],
  ["electrum", "ep"],
  ["gold", "gp"],
  ["platinum", "pp"],
];

/**
 * An Aurora file's equipment, money and treasure, saved as the character's inventory: each item with its count,
 * the slot it is equipped in, attunement, the player's own name and notes; a magic item Aurora lays on a base
 * item ("Weapon, +1" on a Spear) becomes that magic item made from the base. Only into an empty inventory, so
 * running it again adds nothing twice. Returns how many items were added and the ones not in the content.
 */
export async function importAuroraEquipment(characterId: string, doc: Document): Promise<{ added: number; missing: string[] }> {
  const current = await apiClient.get<{ items: unknown[]; coins: Record<string, number>; treasure?: string | null; questItems?: string | null }>(
    `/api/characters/${characterId}/inventory`,
  );
  if (current.items.length > 0 || Object.values(current.coins ?? {}).some((n) => n > 0)) return { added: 0, missing: [] };

  const nodes = Array.from(doc.querySelectorAll("build > equipment > item")).filter(
    (i) => i.getAttribute("hidden") !== "true" && !/_ITEM_FEAT_PROXY_/.test(i.getAttribute("id") ?? ""),
  );
  const auroraIds = [...new Set(nodes.flatMap((i) => [i.getAttribute("id") ?? "", ...Array.from(i.querySelectorAll(":scope > items > adorner")).map((a) => a.getAttribute("id") ?? "")]))];
  const { elements: ids } = auroraIds.length
    ? await apiClient.post<{ ids: string[] }, { elements: Record<string, string> }>("/api/elements/aurora-lookup", { ids: auroraIds.filter(Boolean) })
    : { elements: {} as Record<string, string> };

  const missing: string[] = [];
  const items = nodes.flatMap((node) => {
    const own = ids[node.getAttribute("id") ?? ""];
    const adorner = node.querySelector(":scope > items > adorner");
    const magic = adorner ? ids[adorner.getAttribute("id") ?? ""] : undefined;
    if (!own || (adorner && !magic)) {
      missing.push(`${node.getAttribute("name")}: ${adorner?.getAttribute("id") ?? node.getAttribute("id")}`);
      return [];
    }
    const equipped = node.querySelector(":scope > equipped");
    const identifier = node.getAttribute("identifier") ?? "";
    return [
      {
        id: identifier.length > 0 && identifier.length <= 64 ? identifier : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        elementId: magic ?? own,
        baseElementId: magic ? own : null,
        name: text(node, ":scope > details > name") || null,
        quantity: Math.max(1, Number(node.getAttribute("amount")) || 1),
        equipped: equipped?.textContent?.trim() === "true" ? (SLOTS[equipped.getAttribute("location") ?? ""] ?? "Worn") : null,
        attuned: text(node, ":scope > attunement") === "true",
        card: node.querySelector(":scope > details")?.getAttribute("card") === "true",
        notes: text(node, ":scope > details > notes") || null,
      },
    ];
  });

  const currency = doc.querySelector("build > currency, currency");
  const coins: Record<string, number> = {};
  for (const [aurora, coin] of COINS) {
    const n = Number(text(currency, `:scope > ${aurora}`));
    if (n > 0) coins[coin] = Math.min(1_000_000_000, Math.floor(n));
  }
  const treasure = [text(currency, ":scope > treasure"), text(currency, ":scope > equipment")].filter(Boolean).join("\n\n");

  if (items.length === 0 && Object.keys(coins).length === 0 && !treasure) return { added: 0, missing };
  await apiClient.put(`/api/characters/${characterId}/inventory`, { ...current, items, coins, treasure: treasure || current.treasure || null });
  return { added: items.length, missing };
}

export interface AuroraUpdateReport {
  picked: number;
  items: number;
  prepared: number;
  missing: string[];
  unmatched: string[];
}

/**
 * Brings what an Aurora file has and the character lacks into a character imported earlier, adding only: choices
 * still empty are filled (a choice made since is kept), feats from Aurora's proxy items become extras, the
 * equipment and money go into an empty inventory, and prepared spells are added. The build, ability scores and
 * story are otherwise left as they are.
 */
export async function updateFromAurora(characterId: string, xmlText: string, onProgress?: (message: string) => void): Promise<AuroraUpdateReport> {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const elements = doc.querySelector("character > build > elements");
  if (!elements || doc.querySelector("parsererror")) throw new Error("This is not an Aurora character file (.dnd5e).");

  const picks = collectPicks(elements);
  const ids = await lookupIds(picks, doc);
  const missing = picks.filter((p) => !ids[p.registered]).map((p) => `${p.name}: ${p.registered}`);
  const open = picks.filter((p) => ids[p.registered] && p.parent !== null);

  onProgress?.("Feats…");
  open.push(...(await addFeatProxies(characterId, doc, ids)));
  onProgress?.("Choices…");
  const picked = await fillChoices(characterId, open, ids, { onlyEmpty: true, label: "Choices", onProgress });
  onProgress?.("Equipment…");
  const equipment = await importAuroraEquipment(characterId, doc);
  onProgress?.("Prepared spells…");
  const prepared = await importAuroraPreparedSpells(characterId, doc);

  return { picked, items: equipment.added, prepared, missing: [...missing, ...equipment.missing], unmatched: await unmatchedPicks(characterId, open, ids) };
}
