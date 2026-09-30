/**
 * Spellcasting rules for the Magic tab and the sheet: the shared multiclass slot table, pact magic, how many spells
 * are prepared, spending and getting back slots. Pure functions over what the server works out from the build
 * (GET /characters/{id}/spellcasting) and the player's day-to-day state (GET/PUT /characters/{id}/magic).
 */

export type SpellKind = "cantrip" | "always" | "spellbook" | "known";
export type MulticlassKind = "Full" | "Half" | "HalfUp" | "Third" | "Solo";

export interface KnownSpell {
  registrationId: string;
  elementId: string;
  name: string;
  level: number;
  /** cantrip; always prepared; in a spellbook (may be prepared); known (always castable) */
  kind: SpellKind;
  origin: string;
}

export interface Caster {
  name: string;
  ability: string | null;
  abilityModifier: number;
  attack: number;
  dc: number;
  attackBonus: number;
  dcBonus: number;
  prepares: boolean;
  knowsWholeList: boolean;
  spellbook: boolean;
  allowReplace: boolean;
  lists: string[];
  className: string | null;
  classLevel: number;
  multiclass: MulticlassKind | null;
  edition: "2014" | "2024";
  /** slots of its own class table, by spell level */
  slots: Record<string, number>;
  pact: { level: number; count: number } | null;
  prepareMax: number | null;
  spells: KnownSpell[];
  /** what it may prepare: its class list up to its highest slot, or its spellbook */
  preparable: string[];
  nextLevel: { level: number; slots: Record<string, number>; prepare: number; choices: string[] } | null;
}

export interface Spellcasting {
  proficiencyBonus: number;
  casters: Caster[];
  otherSpells: KnownSpell[];
}

export interface MagicState {
  version: number;
  /** prepared spell elements per spellcasting name; always-prepared spells are not listed */
  prepared: Record<string, string[]>;
  /** spent slots by spell level, shared by every spellcasting class */
  expendedSlots: Record<string, number>;
  expendedPactSlots: number;
}

export const EMPTY_MAGIC: MagicState = { version: 1, prepared: {}, expendedSlots: {}, expendedPactSlots: 0 };

/** The Multiclass Spellcaster table (the same in the 2014 and 2024 Player's Handbooks): slots by caster level. */
const MULTICLASS_TABLE: number[][] = [
  [],
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/**
 * What a class's levels add to the multiclass caster level: all of them for full casters; half for paladins and
 * rangers, rounded down in the 2014 rules and up in the 2024 rules; half rounded up for artificers; a third,
 * rounded down, for Eldritch Knights and Arcane Tricksters. Warlocks (Solo) add nothing: pact magic is separate.
 */
export function casterLevelShare(caster: Pick<Caster, "multiclass" | "classLevel" | "edition">): number {
  const level = caster.classLevel;
  switch (caster.multiclass) {
    case "Full":
      return level;
    case "Half":
      return caster.edition === "2024" ? Math.ceil(level / 2) : Math.floor(level / 2);
    case "HalfUp":
      return Math.ceil(level / 2);
    case "Third":
      return Math.floor(level / 3);
    default:
      return 0;
  }
}

const countsForMulticlass = (c: Caster) => c.multiclass !== null && c.multiclass !== "Solo" && !c.pact;

/**
 * The spell slots the character has, by spell level. With one spellcasting class they are that class's own table;
 * with two or more that count for multiclassing, the Multiclass Spellcaster table for their combined caster level
 * replaces them (one pool for all). A spellcasting outside that system (homebrew) adds its own slots. Pact slots
 * are not included (see {@link pactSlots}).
 */
export function spellSlots(casters: Caster[]): Record<number, number> {
  const slots: Record<number, number> = {};
  const add = (level: number, n: number) => {
    if (n > 0) slots[level] = (slots[level] ?? 0) + n;
  };
  const counting = casters.filter(countsForMulticlass);
  const own = counting.length >= 2 ? casters.filter((c) => !c.pact && !countsForMulticlass(c)) : casters.filter((c) => !c.pact);
  if (counting.length >= 2) {
    const level = Math.min(20, counting.reduce((sum, c) => sum + casterLevelShare(c), 0));
    MULTICLASS_TABLE[level].forEach((n, i) => add(i + 1, n));
  }
  for (const c of own) for (const [level, n] of Object.entries(c.slots)) add(Number(level), n);
  return slots;
}

/** Whether the shared multiclass table is in use (the Magic tab says so). */
export const usesMulticlassTable = (casters: Caster[]) => casters.filter(countsForMulticlass).length >= 2;

/** Pact magic slots (warlock): all of one level, back after a short rest. */
export function pactSlots(casters: Caster[]): { level: number; count: number } | null {
  return casters.find((c) => c.pact)?.pact ?? null;
}

/** The highest spell level the character can cast with a slot. */
export function highestSlotLevel(casters: Caster[]): number {
  const levels = Object.keys(spellSlots(casters)).map(Number);
  return Math.max(0, ...levels, pactSlots(casters)?.level ?? 0);
}

/** The spells a spellcasting has prepared by choice (always-prepared ones are not stored and never count). */
export function preparedIds(caster: Caster, state: MagicState): string[] {
  const always = new Set(caster.spells.filter((s) => s.kind === "always").map((s) => s.elementId));
  return (state.prepared[caster.name] ?? []).filter((id) => !always.has(id));
}

/** How many spells are prepared against the limit, and the limit. */
export function preparedCount(caster: Caster, state: MagicState): { count: number; max: number | null } {
  return { count: preparedIds(caster, state).length, max: caster.prepareMax };
}

/** Prepared spells that are no longer allowed (a level or a book lost): kept, and shown for the player to change. */
export function stalePrepared(caster: Caster, state: MagicState): string[] {
  const allowed = new Set(caster.preparable);
  return preparedIds(caster, state).filter((id) => !allowed.has(id));
}

export function isPrepared(caster: Caster, state: MagicState, elementId: string): boolean {
  return caster.spells.some((s) => s.elementId === elementId && s.kind === "always") || preparedIds(caster, state).includes(elementId);
}

/**
 * Why a spell cannot be prepared now, or null when it can: the spellcasting does not prepare, the spell is not on
 * what it prepares from, or the limit is reached. Unpreparing is always allowed.
 */
export function prepareProblem(caster: Caster, state: MagicState, elementId: string): string | null {
  if (!caster.prepares) return `${caster.name} spells are known, not prepared.`;
  if (caster.spells.some((s) => s.elementId === elementId && s.kind === "always")) return "Always prepared.";
  if (preparedIds(caster, state).includes(elementId)) return null;
  if (!caster.preparable.includes(elementId)) return caster.spellbook ? "Not in your spellbook." : "Not a spell you can prepare yet.";
  const { count, max } = preparedCount(caster, state);
  if (max !== null && count >= max) return `You have prepared ${max} spells, the most you can.`;
  return null;
}

/** Prepares or unprepares a spell; an unallowed change leaves the state as it is. */
export function togglePrepared(caster: Caster, state: MagicState, elementId: string): MagicState {
  const current = state.prepared[caster.name] ?? [];
  if (current.includes(elementId)) {
    return { ...state, prepared: { ...state.prepared, [caster.name]: current.filter((id) => id !== elementId) } };
  }
  if (prepareProblem(caster, state, elementId)) return state;
  return { ...state, prepared: { ...state.prepared, [caster.name]: [...current, elementId] } };
}

/** Whether a spell can be cast now: cantrips, known and always-prepared spells, and prepared ones. */
export function isCastable(caster: Caster, state: MagicState, spell: KnownSpell): boolean {
  return spell.kind === "cantrip" || spell.kind === "known" || spell.kind === "always" || isPrepared(caster, state, spell.elementId);
}

export const expended = (state: MagicState, level: number) => state.expendedSlots[level] ?? 0;

/** Spends a slot of a level, if one is left. */
export function expendSlot(state: MagicState, level: number, total: number): MagicState {
  const used = expended(state, level);
  return used >= total ? state : { ...state, expendedSlots: { ...state.expendedSlots, [level]: used + 1 } };
}

/** Gets back one spent slot of a level. */
export function restoreSlot(state: MagicState, level: number): MagicState {
  const used = expended(state, level);
  if (used <= 0) return state;
  const expendedSlots = { ...state.expendedSlots, [level]: used - 1 };
  if (expendedSlots[level] === 0) delete expendedSlots[level];
  return { ...state, expendedSlots };
}

/** Clicking the n-th pip (1-based) of a row: spends up to it, or gets it back when it is the last spent one. */
export function setSpent(state: MagicState, level: number, spent: number, total: number): MagicState {
  const n = Math.max(0, Math.min(total, spent));
  const expendedSlots = { ...state.expendedSlots, [level]: n };
  if (n === 0) delete expendedSlots[level];
  return { ...state, expendedSlots };
}

export function setPactSpent(state: MagicState, spent: number, total: number): MagicState {
  return { ...state, expendedPactSlots: Math.max(0, Math.min(total, spent)) };
}

/** A long rest brings back every slot. */
export const longRest = (state: MagicState): MagicState => ({ ...state, expendedSlots: {}, expendedPactSlots: 0 });

/** A short rest brings back pact magic slots. */
export const shortRest = (state: MagicState): MagicState => ({ ...state, expendedPactSlots: 0 });

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
export const levelName = (level: number) => (level === 0 ? "Cantrips" : `${ORDINAL[level]} level`);
export const ordinal = (level: number) => ORDINAL[level] ?? `${level}th`;

/** What the next class level brings to a spellcasting, in words ("a 3rd-level slot ×2, 1 more prepared spell"). */
export function nextLevelSummary(caster: Caster): string[] {
  const next = caster.nextLevel;
  if (!next) return [];
  const lines: string[] = [];
  for (const [level, n] of Object.entries(next.slots).sort(([a], [b]) => Number(a) - Number(b))) {
    if (n > 0) lines.push(`${n === 1 ? "a" : n} ${ordinal(Number(level))}-level slot${n === 1 ? "" : "s"}`);
    else if (n < 0) lines.push(`${-n} fewer ${ordinal(Number(level))}-level slot${n === -1 ? "" : "s"}`);
  }
  if (next.prepare > 0) lines.push(`${next.prepare} more prepared spell${next.prepare === 1 ? "" : "s"}`);
  lines.push(...next.choices);
  return lines;
}
