/**
 * Encounter mode: a fight the DM runs on a campaign's encounter (initiative order, rounds, hit points, conditions),
 * and what a creature's conditions do to the attacks and saves made against it. The rules of the 2014 and 2024
 * Player's Handbooks agree on all of these:
 *   attacks against it: advantage when it is Blinded, Paralyzed, Petrified, Restrained, Stunned or Unconscious, or
 *     outlined by Faerie Fire; Prone gives advantage within 5 ft and disadvantage farther away; Invisible and Dodging
 *     give disadvantage. A hit within 5 ft on a Paralyzed or Unconscious creature is a critical hit.
 *   its saves: Paralyzed, Petrified, Stunned and Unconscious fail Strength and Dexterity saves; Restrained has
 *     disadvantage on Dexterity saves; Dodging has advantage on them.
 *   Frightened, Charmed, Poisoned, Grappled and Deafened change what the creature itself does, not attacks against it.
 * Advantage and disadvantage do not add up: one or more of each and the roll is normal.
 */
import type { Advantage } from "@/lib/rules/battle";

export interface FightCondition {
  name: string;
  /** who marked it (a character's name, or "DM") */
  by?: string;
  /** set by the player on their own sheet or simulator (the DM can't take it off) */
  fromSheet?: boolean;
}

export interface Combatant {
  id: string;
  kind: "pc" | "monster" | "npc";
  name: string;
  characterId?: string;
  initiative?: number | null;
  initiativeBonus?: number;
  /** the DM's only (players see health instead) */
  hp?: number;
  maxHp?: number;
  ac?: number | null;
  saves?: Record<string, number>;
  link?: { category: string; key: string; name: string } | null;
  notes?: string;
  hidden?: boolean;
  /** a player character's, from their simulator (the DM's view only) */
  tempHp?: number;
  deathSaves?: { successes: number; failures: number };
  /** what players see of a monster: unhurt, hurt, bloodied, down */
  health?: "unhurt" | "hurt" | "bloodied" | "down";
  conditions: FightCondition[];
}

export interface Fight {
  revision: number;
  active: boolean;
  round: number;
  /** the creature whose turn it is (its id) */
  turn: string | null;
  /** players see monsters' armor class and saves */
  shareStats: boolean;
  combatants: Combatant[];
}

export const EMPTY_FIGHT: Fight = { revision: 0, active: false, round: 1, turn: null, shareStats: false, combatants: [] };

/** What players and the DM can mark on a creature (the server allows the same list). */
export const MARKS: { name: string; note: string }[] = [
  { name: "Blinded", note: "attacks against it have advantage" },
  { name: "Charmed", note: "can't attack whoever charmed it" },
  { name: "Deafened", note: "can't hear" },
  { name: "Frightened", note: "its own attacks and checks have disadvantage while it sees the source" },
  { name: "Grappled", note: "speed 0" },
  { name: "Incapacitated", note: "no actions or reactions" },
  { name: "Invisible", note: "attacks against it have disadvantage" },
  { name: "Paralyzed", note: "advantage against it; hits within 5 ft are critical; fails Str and Dex saves" },
  { name: "Petrified", note: "advantage against it; fails Str and Dex saves" },
  { name: "Poisoned", note: "its own attacks and checks have disadvantage" },
  { name: "Prone", note: "advantage within 5 ft, disadvantage from farther away" },
  { name: "Restrained", note: "advantage against it; disadvantage on its Dex saves" },
  { name: "Stunned", note: "advantage against it; fails Str and Dex saves" },
  { name: "Unconscious", note: "advantage against it; hits within 5 ft are critical; fails Str and Dex saves" },
  { name: "Faerie Fire", note: "attacks against it have advantage; it can't be invisible" },
  { name: "Dodging", note: "attacks against it have disadvantage; advantage on its Dex saves" },
  { name: "Guiding Bolt", note: "the next attack against it has advantage" },
  { name: "Reckless", note: "attacks against it have advantage (Reckless Attack) until its next turn" },
  { name: "Vexed", note: "whoever vexed it has advantage on the next attack (Vex mastery)" },
  { name: "Hex", note: "the warlock's hits deal an extra 1d6 necrotic" },
  { name: "Hunter's Mark", note: "the ranger's hits deal an extra 1d6 (1d10 Foe Slayer)" },
  { name: "Bane", note: "−1d4 to its attacks and saves" },
  { name: "Bless", note: "+1d4 to its attacks and saves" },
  { name: "Concentrating", note: "it is holding a spell: damage makes it save" },
];

const has = (conditions: readonly (FightCondition | string)[], name: string) => conditions.some((c) => (typeof c === "string" ? c : c.name).toLowerCase() === name.toLowerCase());

export interface AttackRoll {
  advantage: Advantage;
  /** why: each source of advantage and of disadvantage */
  for: string[];
  against: string[];
  /** a hit is a critical hit (Paralyzed or Unconscious within 5 ft) */
  autoCrit: boolean;
  notes: string[];
}

/**
 * An attack's roll against a target: the player's own choice (from the Help action, a feature), their own conditions
 * (Poisoned, Prone…, and Invisible for advantage), the target's conditions, and a ranged attack with the target
 * within 5 ft.
 */
export function attackRoll(o: {
  melee: boolean;
  within5: boolean;
  manual: Advantage;
  /** the attacker's conditions that give its attacks disadvantage (Blinded, Frightened, Poisoned, Prone, Restrained, exhaustion) */
  ownDisadvantage: string[];
  ownInvisible: boolean;
  target: readonly (FightCondition | string)[];
}): AttackRoll {
  const pro: string[] = [];
  const con: string[] = [];
  const notes: string[] = [];
  if (o.manual === "advantage") pro.push("you chose advantage");
  if (o.manual === "disadvantage") con.push("you chose disadvantage");
  con.push(...o.ownDisadvantage.map((c) => `you are ${c}`));
  if (o.ownInvisible && !has(o.target, "Blinded")) pro.push("you are Invisible");
  const t = o.target;
  for (const c of ["Blinded", "Paralyzed", "Petrified", "Restrained", "Stunned", "Unconscious"]) if (has(t, c)) pro.push(`it is ${c}`);
  if (has(t, "Faerie Fire")) pro.push("Faerie Fire");
  if (has(t, "Guiding Bolt")) pro.push("Guiding Bolt (this attack only)");
  if (has(t, "Reckless")) pro.push("it attacked recklessly");
  if (has(t, "Vexed")) pro.push("Vex (if you vexed it)");
  if (has(t, "Prone")) {
    if (o.within5) pro.push("it is Prone, within 5 ft");
    else con.push("it is Prone, beyond 5 ft");
  }
  if (has(t, "Invisible") && !has(t, "Faerie Fire")) con.push("it is Invisible");
  if (has(t, "Dodging")) con.push("it is Dodging");
  if (!o.melee && o.within5 && !has(t, "Incapacitated") && !has(t, "Paralyzed") && !has(t, "Stunned") && !has(t, "Unconscious") && !has(t, "Petrified")) con.push("ranged attack within 5 ft of it");
  if (has(t, "Hex")) notes.push("Hex: +1d6 necrotic if it is yours");
  if (has(t, "Hunter's Mark")) notes.push("Hunter's Mark: +1d6 if it is yours");
  const advantage: Advantage = pro.length && !con.length ? "advantage" : con.length && !pro.length ? "disadvantage" : "normal";
  const autoCrit = o.within5 && (has(t, "Paralyzed") || has(t, "Unconscious"));
  return { advantage, for: pro, against: con, autoCrit, notes };
}

/** What the target's conditions do to its save against a spell or effect of yours. */
export function targetSave(target: readonly (FightCondition | string)[], ability: string): { autoFail: boolean; advantage: Advantage; notes: string[] } {
  const a = ability.slice(0, 3).toLowerCase();
  const notes: string[] = [];
  const failing = ["Paralyzed", "Petrified", "Stunned", "Unconscious"].find((c) => has(target, c));
  if ((a === "str" || a === "dex") && failing) return { autoFail: true, advantage: "normal", notes: [`it is ${failing}: fails automatically`] };
  let pro = 0;
  let con = 0;
  if (a === "dex" && has(target, "Restrained")) {
    con++;
    notes.push("Restrained: disadvantage");
  }
  if (a === "dex" && has(target, "Dodging")) {
    pro++;
    notes.push("Dodging: advantage");
  }
  if (has(target, "Bane")) notes.push("Bane: −1d4");
  if (has(target, "Bless")) notes.push("Bless: +1d4");
  return { autoFail: false, advantage: pro && !con ? "advantage" : con && !pro ? "disadvantage" : "normal", notes };
}

/** The chance a creature with this save bonus fails against a DC, with advantage or disadvantage. */
export function failChanceWith(dc: number, bonus: number, advantage: Advantage): number {
  const success = Math.min(1, Math.max(0, (21 - (dc - bonus)) / 20));
  const s = advantage === "advantage" ? 1 - (1 - success) ** 2 : advantage === "disadvantage" ? success ** 2 : success;
  return 1 - s;
}

/** The order of play: highest initiative first; ties keep the order they were added in. */
export function inOrder(combatants: Combatant[]): Combatant[] {
  return combatants
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (y.c.initiative ?? -99) - (x.c.initiative ?? -99) || (y.c.initiativeBonus ?? 0) - (x.c.initiativeBonus ?? 0) || x.i - y.i)
    .map((x) => x.c);
}

/** The next creature's turn (a new round after the last); creatures at 0 hit points are still in the order. */
export function nextTurn(fight: Fight): Fight {
  const order = inOrder(fight.combatants);
  if (order.length === 0) return fight;
  const at = order.findIndex((c) => c.id === fight.turn);
  const next = at < 0 ? 0 : (at + 1) % order.length;
  const round = at >= 0 && next === 0 ? fight.round + 1 : fight.round;
  const id = order[next].id;
  // what lasts until the start of a creature's next turn ends now: its Dodge, its Reckless Attack
  const combatants = fight.combatants.map((c) => (c.id === id ? { ...c, conditions: c.conditions.filter((k) => k.name !== "Dodging" && k.name !== "Reckless") } : c));
  return { ...fight, combatants, turn: id, round };
}

/** How hurt a creature looks. */
export function health(hp: number, max: number): Combatant["health"] {
  return hp <= 0 ? "down" : max <= 0 || hp >= max ? "unhurt" : hp * 2 <= max ? "bloodied" : "hurt";
}

const mod = (score: unknown) => Math.floor(((typeof score === "number" ? score : 10) - 10) / 2);

/** A challenge rating's proficiency bonus ("1/4" → 2, 5 → 3). */
export function proficiencyOf(cr: unknown): number {
  const raw = typeof cr === "object" && cr !== null ? (cr as { cr?: unknown }).cr : cr;
  const text = String(raw ?? "0");
  const n = text.includes("/") ? 0 : Number(text) || 0;
  return n < 5 ? 2 : Math.min(9, 2 + Math.floor((n - 1) / 4));
}

/**
 * A monster's numbers from the Compendium's bestiary entry (5etools' JSON): hit points, armor class, initiative
 * bonus (Dexterity, plus its proficiency where the 2024 stat block lists it) and saving throw bonuses.
 */
export function monsterStats(m: Record<string, unknown>): { hp: number; ac: number | null; initiativeBonus: number; saves: Record<string, number> } {
  const hp = (m.hp as { average?: number } | undefined)?.average ?? 1;
  const first = (m.ac as unknown[] | undefined)?.[0];
  const ac = typeof first === "number" ? first : typeof first === "object" && first !== null && typeof (first as { ac?: unknown }).ac === "number" ? (first as { ac: number }).ac : null;
  const pb = proficiencyOf(m.cr);
  const init = m.initiative as number | { proficiency?: number } | undefined;
  const initiativeBonus = typeof init === "number" ? init : mod(m.dex) + (init?.proficiency ?? 0) * pb;
  const saves: Record<string, number> = {};
  for (const a of ["str", "dex", "con", "int", "wis", "cha"]) {
    const listed = (m.save as Record<string, string> | undefined)?.[a];
    saves[a] = listed !== undefined ? Number(String(listed).replace(/[^\d+-]/g, "")) || 0 : mod(m[a]);
  }
  return { hp, ac, initiativeBonus, saves };
}
