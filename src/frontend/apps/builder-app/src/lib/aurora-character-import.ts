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
const TOP_LEVEL: Record<string, string> = { Race: "Species", Class: "Class", Background: "Background", Alignment: "Alignment" };

const ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function text(root: Element | null | undefined, selector: string): string {
  return root?.querySelector(selector)?.textContent?.trim() ?? "";
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
  const { elements: ids } = await apiClient.post<{ ids: string[] }, { elements: Record<string, string> }>("/api/elements/aurora-lookup", {
    ids: [...new Set(picks.flatMap((p) => [p.registered, p.parent ?? ""]).filter(Boolean))],
  });

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
  for (const type of ["Class", "Race", "Background", "Alignment"]) {
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

  for (let pass = 0; pass < 30 && open.length > 0; pass++) {
    choices = await settledChoices(characterId);
    const bySlot = new Map(choices.map((c) => [`${c.parentElementId}|${c.name}|${Math.max(1, c.level)}|${c.slot}`, c]));
    let progress = false;

    for (const pick of [...open]) {
      const parentId = pick.parent ? ids[pick.parent] : undefined;
      const choice = parentId && bySlot.get(`${parentId}|${pick.name}|${pick.level}|${pick.slot}`);
      if (!choice) continue;

      open.splice(open.indexOf(pick), 1);
      if (choice.selected?.elementId !== ids[pick.registered]) {
        onProgress?.(`${name}: ${pick.name}…`);
        await register(choice, ids[pick.registered]);
        progress = true;
      }
    }
    if (!progress) break;
  }
  report.unmatched = open.filter((p) => p.parent !== null).map((p) => `${p.name} (${p.registered})`);

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
    ["input > organization", "allies"],
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
  if (Object.keys(story).length > 0) {
    await apiClient.put(`/api/characters/${characterId}/story`, { fields: story });
  }

  onProgress?.(`${name}: ability scores…`);
  const scores = await apiClient.get<{ abilityScores: { abilityScoreId: string; name: string }[] }>(`/api/characters/${characterId}/ability-scores`);
  for (const ability of ABILITIES) {
    const value = Number(text(build, `:scope > abilities > ${ability}`));
    const target = scores.abilityScores?.find((s) => s.name.toLowerCase() === ability);
    if (target && value > 0) {
      await apiClient.post(`/api/characters/${characterId}/ability-scores/${target.abilityScoreId}/base`, { value });
    }
  }

  return report;
}
