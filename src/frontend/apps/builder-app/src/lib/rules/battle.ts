/**
 * Rules for the Battle Action Simulator: pure functions over the character sheet (lib/api/sheet) and the
 * character's state in a fight (GET/PUT /characters/{id}/combat). Dice and averages, the chance to hit an Armor
 * Class, what a spell does at a slot level (read from its text), limited uses and what a short or long rest gives
 * back. Nothing here keeps a second copy of the rules: attack bonuses, damage, save DCs and slots come from the sheet.
 */

// ---- dice

export interface DiceTerm {
  count: number;
  sides: number;
}

export interface Roll {
  dice: DiceTerm[];
  bonus: number;
  /** damage type ("slashing"), or "healing" */
  type: string;
}

/** "1d6+3 slashing", "2d8 + 1d6 - 1 fire", "1 bludgeoning": dice, flat bonus and type. */
export function parseRoll(text: string): Roll | null {
  const clean = text.replace(/[−–]/g, "-").trim();
  const match = clean.match(/^([0-9d+\-\s]+?)\s*([a-zA-Z][a-zA-Z ]*)?$/);
  if (!match) return null;
  const dice: DiceTerm[] = [];
  let bonus = 0;
  let any = false;
  for (const [, sign, term] of match[1].replace(/\s+/g, "").matchAll(/([+-]?)(\d+d\d+|\d+)/g)) {
    any = true;
    const factor = sign === "-" ? -1 : 1;
    const d = term.match(/^(\d+)d(\d+)$/);
    if (d) dice.push({ count: Number(d[1]) * factor, sides: Number(d[2]) });
    else bonus += Number(term) * factor;
  }
  return any ? { dice: mergeDice(dice), bonus, type: (match[2] ?? "").trim().toLowerCase() } : null;
}

function mergeDice(dice: DiceTerm[]): DiceTerm[] {
  const by = new Map<number, number>();
  for (const d of dice) by.set(d.sides, (by.get(d.sides) ?? 0) + d.count);
  return [...by.entries()].filter(([, n]) => n !== 0).sort((a, b) => b[0] - a[0]).map(([sides, count]) => ({ count, sides }));
}

export function addDice(roll: Roll, extra: DiceTerm[], bonus = 0): Roll {
  return { ...roll, dice: mergeDice([...roll.dice, ...extra]), bonus: roll.bonus + bonus };
}

/** The average of a roll (a die averages (sides + 1) / 2); never below 0 for damage, as the rules say. */
export function average(roll: Roll): number {
  return Math.max(0, roll.dice.reduce((s, d) => s + (d.count * (d.sides + 1)) / 2, 0) + roll.bonus);
}

/**
 * The average with Great Weapon Fighting: 2024 counts a 1 or 2 on a damage die as 3; 2014 rerolls a 1 or 2 once
 * (keeping the new roll).
 */
export function averageGreatWeapon(roll: Roll, edition: "2014" | "2024"): number {
  const die = (sides: number) => {
    let sum = 0;
    for (let face = 1; face <= sides; face++) sum += face <= 2 ? (edition === "2024" ? 3 : (sides + 1) / 2) : face;
    return sum / sides;
  };
  return Math.max(0, roll.dice.reduce((s, d) => s + d.count * die(d.sides), 0) + roll.bonus);
}

/** A critical hit rolls the damage dice twice; the modifier is added once. */
export function critical(roll: Roll): Roll {
  return { ...roll, dice: roll.dice.map((d) => ({ ...d, count: d.count * 2 })) };
}

export function formatRoll(roll: Roll, withType = true): string {
  const dice = roll.dice.map((d, i) => `${i > 0 && d.count > 0 ? "+" : ""}${d.count}d${d.sides}`).join("");
  const bonus = roll.bonus === 0 ? (dice ? "" : "0") : `${dice && roll.bonus > 0 ? "+" : ""}${roll.bonus}`;
  return `${dice}${bonus}${withType && roll.type ? ` ${roll.type}` : ""}`;
}

/** The lowest and highest a roll can come to. */
export function rollRange(roll: Roll): [number, number] {
  const min = roll.dice.reduce((s, d) => s + d.count, 0) + roll.bonus;
  const max = roll.dice.reduce((s, d) => s + d.count * d.sides, 0) + roll.bonus;
  return [Math.max(0, min), Math.max(0, max)];
}

/** Rolls the dice (for hit dice on a short rest). */
export function rollDice(roll: Roll, random: () => number = Math.random): number {
  let total = roll.bonus;
  for (const d of roll.dice) for (let i = 0; i < Math.abs(d.count); i++) total += Math.sign(d.count) * (1 + Math.floor(random() * d.sides));
  return Math.max(0, total);
}

// ---- hitting

export type Advantage = "advantage" | "normal" | "disadvantage";

/**
 * The chance that an attack with this bonus hits an Armor Class: a 20 always hits (and is a critical hit), a 1
 * always misses. With advantage the better of two d20s, with disadvantage the worse.
 */
export function hitChance(bonus: number, ac: number, advantage: Advantage = "normal", critOn = 20): { hit: number; crit: number } {
  const needed = Math.min(Math.max(ac - bonus, 2), 20); // the d20 roll that hits, 2..20
  const single = Math.max((21 - Math.min(needed, critOn)) / 20, (21 - critOn) / 20);
  const crit = (21 - critOn) / 20;
  if (advantage === "advantage") return { hit: 1 - (1 - single) ** 2, crit: 1 - (1 - crit) ** 2 };
  if (advantage === "disadvantage") return { hit: single ** 2, crit: crit ** 2 };
  return { hit: single, crit };
}

/** The damage to expect from one attack against an AC: hits times the average, plus the extra dice of critical hits. */
export function expectedDamage(bonus: number, ac: number, roll: Roll, advantage: Advantage = "normal"): number {
  const { hit, crit } = hitChance(bonus, ac, advantage);
  return (hit - crit) * average(roll) + crit * average(critical(roll));
}

/** The chance a creature with this saving throw bonus fails against a DC (a 1 on a save is not an automatic failure). */
export function failChance(dc: number, saveBonus: number): number {
  return Math.min(Math.max((dc - 1 - saveBonus) / 20, 0), 1);
}

// ---- spells

export const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;

export interface SpellEffect {
  attack: "melee" | "ranged" | null;
  save: string | null;
  halfOnSave: boolean;
  /** damage at the level cast (cantrips scaled to the character's level) */
  damage: Roll[];
  healing: Roll | null;
  /** temporary hit points gained (False Life) */
  temporary: Roll | null;
  /** separate attacks or missiles, each doing the damage (Eldritch Blast's beams, Magic Missile's darts) */
  beams: number;
  /** what each slot level above the spell's adds, when the text says so */
  upcastDice: DiceTerm[];
  upcastHealing: DiceTerm[];
  /** "At Higher Levels" text that is not extra dice (more targets, longer duration) */
  upcastNote: string | null;
}

/** Plain text of a spell's HTML description. */
export function plainSpellText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/\s+/g, " ").trim();
}

const HIGHER = /(?:At Higher Levels|Using a Higher-Level Spell Slot|Higher-Level Spell Slot)\.?\s*[:.]?\s*/i;
const CANTRIP_UPGRADE = /(?:Cantrip Upgrade)\.?\s*/i;

/** The level a cantrip's dice have grown to at a character level: once at 5, 11 and 17. */
export function cantripTier(characterLevel: number): number {
  return characterLevel >= 17 ? 4 : characterLevel >= 11 ? 3 : characterLevel >= 5 ? 2 : 1;
}

/**
 * What a spell does, read from its text: a spell attack or a saving throw, its damage (by type) or healing, and
 * what casting it with a higher slot adds. `modifier` is the spellcasting ability modifier (healing spells add it).
 */
export function spellEffect(spell: { level: number; description: string }, castAt: number, characterLevel: number, modifier: number): SpellEffect {
  const text = plainSpellText(spell.description);
  const [main, higher = ""] = text.split(HIGHER);
  const body = main.split(CANTRIP_UPGRADE)[0];
  const attack = /\bmelee spell attack\b/i.test(text) ? "melee" : /\branged spell attack\b/i.test(text) ? "ranged" : null;
  const save = body.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i)?.[1] ?? null;
  const halfOnSave = /half as much damage|half (?:the )?damage/i.test(body);

  const damage: Roll[] = [];
  const seenTypes = new Set<string>();
  for (const m of body.matchAll(/(\d+d\d+(?:\s*\+\s*\d+d\d+)*(?:\s*\+\s*\d+)?)\s+(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/gi)) {
    const roll = parseRoll(`${m[1]} ${m[2]}`);
    if (!roll || seenTypes.has(roll.type)) continue;
    seenTypes.add(roll.type);
    damage.push(roll);
  }

  // damage of a type the caster or the trigger chooses: "3d8 damage of the type you chose", "1d6 bludgeoning, piercing, or slashing damage"
  if (damage.length === 0) {
    const m = body.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s+((?:[a-z]+,?\s+(?:or\s+)?)*?)(?:extra\s+)?damage\b/i);
    const roll = m ? parseRoll(m[1]) : null;
    if (roll) damage.push({ ...roll, type: (m![2] ?? "").replace(/\s+/g, " ").trim().replace(/,$/, "") || "damage" });
  }

  // "takes Force damage equal to 1d8 plus your spellcasting ability modifier"
  for (const m of body.matchAll(/(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage equal to (\d+d\d+)(\s*(?:\+|plus) your spellcasting ability modifier)?/gi)) {
    const roll = parseRoll(`${m[2]} ${m[1]}`);
    if (!roll || seenTypes.has(roll.type)) continue;
    seenTypes.add(roll.type);
    damage.push(m[3] ? { ...roll, bonus: roll.bonus + modifier } : roll);
  }

  let healing: Roll | null = null;
  const withModifier = "(\\s*(?:\\+|plus) your spellcasting ability modifier)?";
  const heal =
    body.match(new RegExp(`regains? (?:a number of )?hit points equal to (\\d+d\\d+)${withModifier}`, "i")) ??
    body.match(new RegExp(`regains? (\\d+d\\d+)${withModifier} hit points`, "i"));
  if (heal) {
    const roll = parseRoll(`${heal[1]} healing`);
    if (roll) healing = heal[2] ? { ...roll, bonus: roll.bonus + modifier } : roll;
  }

  const temp = body.match(/gains? (\d+d\d+(?:\s*\+\s*\d+)?|\d+) temporary hit points/i);
  const temporary = temp ? parseRoll(`${temp[1]} temporary`) : null;

  // cantrips grow at levels 5, 11 and 17: more dice ("increases by 1d10 when you reach 5th level (2d10)"), or more
  // beams, each its own attack (Eldritch Blast)
  let beams = 1;
  if (spell.level === 0 && /\b(?:5th level|level 5|levels 5)\b/i.test(text)) {
    const tier = cantripTier(characterLevel);
    if (/\bbeams?\b/i.test(text)) beams = tier;
    else for (const r of damage) r.dice = r.dice.map((d) => ({ ...d, count: d.count * tier }));
  }

  // "the damage increases by 1d6 for each slot level above 3rd" / "for every two slot levels above 2nd"
  const per = (what: "damage" | "healing") => {
    const sentence = higher.split(/(?<=\.)\s+/).find((x) => new RegExp(`\\b${what}\\b[^.]*increases? by \\d+d\\d+`, "i").test(x));
    const m = sentence?.match(/increases? by (\d+d\d+)/i);
    const roll = m ? parseRoll(m[1]) : null;
    if (!roll) return [];
    const every = /every two/i.test(sentence!) ? 2 : 1;
    const steps = Math.floor(Math.max(0, castAt - spell.level) / every);
    return roll.dice.map((d) => ({ ...d, count: d.count * steps }));
  };
  const upcastDice = spell.level > 0 ? per("damage") : [];
  const upcastHealing = spell.level > 0 ? per("healing") : [];
  if (upcastDice.length && damage.length) damage[0] = addDice(damage[0], upcastDice);
  if (upcastHealing.length && healing) healing = addDice(healing, upcastHealing);
  // several darts or rays, each doing the damage, and one more for each slot level above (Magic Missile, Scorching Ray)
  const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
  const many = body.match(/\b(two|three|four|five) (?:glowing |fiery )?(darts|rays|beams|bolts)\b/i);
  if (many && spell.level > 0) {
    beams = NUMBERS[many[1].toLowerCase()];
    if (new RegExp(`one (?:additional|more) ${many[2].replace(/s$/i, "")}`, "i").test(higher)) beams += Math.max(0, castAt - spell.level);
  }
  const upcastNote = spell.level > 0 && higher && !upcastDice.length && !upcastHealing.length && !(many && beams > 1) ? higher.slice(0, 300) : null;

  return { attack, save, halfOnSave, damage, healing, temporary, beams, upcastDice, upcastHealing, upcastNote };
}

/** The action a spell's casting time takes: "Action", "Bonus Action", "Reaction" or "Other" (minutes, rituals). */
export function castingAction(time: string): "Action" | "Bonus Action" | "Reaction" | "Other" {
  const t = time.toLowerCase().trim();
  if (t.includes("bonus action")) return "Bonus Action";
  if (t.includes("reaction")) return "Reaction";
  return /^(?:1 )?action\b/.test(t) ? "Action" : "Other";
}

// ---- limited uses

export type Recharge = "turn" | "short" | "long";

export type Usage =
  /** `regainOnShort`: one use comes back on a short rest, all on a long one (2024's Second Wind, Channel Divinity) */
  | { kind: "count"; max: number; recharge: Recharge; regainOnShort?: boolean }
  /** spends from another feature's pool ("Channel Divinity", "Ki"); `cost` when a use takes several ("2 Sorcery Points") */
  | { kind: "pool"; pool: string; cost?: number };

/** A feature's usage line from its sheet entry: "2/Long Rest", "1/Turn", "1/Short or Long Rest", "Channel Divinity". */
export function parseUsage(usage: string | null | undefined): Usage | null {
  if (!usage) return null;
  // "Focus Point — 1/Turn": spends from the pool (once a turn is the feature's own limit, in its text)
  const u = usage.trim().replace(/\.$/, "").replace(/\s+[—–-]\s+\d+\/(?:turn|round)$/i, "");
  // "2/Long Rest", "1/1d4 Long Rests", a pool of dice "4d6/Long Rest" (four Psionic Energy Dice), of points "30 HP/Long Rest"
  const count = u.match(/^(\d+)(?:d\d+|\s*(?:HP|hit points|points?))?\s*\/\s*(?:\d+d\d+\s+)?(.+)$/i);
  if (count) {
    const max = Number(count[1]);
    const per = count[2].toLowerCase();
    if (max <= 0) return null;
    if (/turn|round/.test(per)) return { kind: "count", max, recharge: "turn" };
    if (/short/.test(per)) return { kind: "count", max, recharge: "short" };
    if (/long|day|dawn/.test(per)) return { kind: "count", max, recharge: "long" };
    return null;
  }
  const points = u.match(/^(\d+) ([A-Za-z’' ]+?)$/);
  if (points && Number(points[1]) > 0) return { kind: "pool", pool: points[2].replace(/s$/, ""), cost: Number(points[1]) };
  if (/^(action|bonus action|reaction)$/i.test(u) || /\{\{|\}\}/.test(u) || /^\d/.test(u)) return null;
  return { kind: "pool", pool: u };
}

/** Other names a pool's feature goes by. */
const POOL_ALIASES: Record<string, string[]> = {
  "psionic energy die": ["psionic power", "psionic energy dice"],
  "superiority die": ["superiority dice", "combat superiority"],
  "sorcery point": ["sorcery points", "font of magic"],
  ki: ["ki points", "ki", "monk's focus", "focus points"],
  "focus point": ["focus points", "monk's focus"],
};

/** The feature that holds a pool: "Channel Divinity" for Channel Divinity, "Psionic Power" for a Psionic Energy Die. */
export function findPool<T extends { title: string; usage?: string | null }>(features: T[], pool: string): T | undefined {
  const name = pool.toLowerCase().replace(/s$/, "");
  const names = [name, ...(POOL_ALIASES[name] ?? [])];
  const counted = features.filter((f) => parseUsage(f.usage)?.kind === "count");
  const title = (f: T) => f.title.toLowerCase().replace(/\s*\(.*\)$/, "");
  for (const n of names) {
    const hit = counted.find((f) => title(f) === n) ?? counted.find((f) => title(f).startsWith(n));
    if (hit) return hit;
  }
  return counted.find((f) => title(f).includes(name));
}

/**
 * A pool's size from the text that grants it, for pools the sheet gives no usage line: "You have 4 Sorcery Points",
 * "you have four superiority dice". Recharges on a long rest unless the text says a short one.
 */
export function poolFromText(texts: string[], pool: string): { max: number; recharge: Recharge } | null {
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const stem = pool.toLowerCase().replace(/s$/, "").replace(/ die$/, " di(?:e|ce)").replace(/ point$/, " points?");
  const re = new RegExp(`\\b(?:you have|you gain|has) (\\d+|${Object.keys(WORDS).join("|")}) ${stem}\\b`, "i");
  for (const text of texts) {
    const m = text.match(re);
    if (!m) continue;
    const max = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const recharge: Recharge = /short or long rest|short rest/i.test(text) && !/when you finish a long rest/i.test(text) ? "short" : "long";
    return max > 0 ? { max, recharge } : null;
  }
  return null;
}

/** Whether a feature's text gives one use back on a short rest (and all on a long one). */
export const regainsOneOnShortRest = (text: string) => /regain one (?:of (?:your|its) )?expended [a-z’' ]*?\b(?:use|die|dice|point)s?\b[^.]*?(?:when you finish|after) a short rest/i.test(text);

/** Uses left of a feature with a counted usage. */
export function usesLeft(usage: Usage | null, spent: Record<string, number>, title: string): number | null {
  return usage?.kind === "count" ? Math.max(0, usage.max - (spent[title] ?? 0)) : null;
}

// ---- the fight's state and rests

/** A familiar, companion or summon, with its own hit points (a bestiary entry's key when it has one). */
export interface Companion {
  id: string;
  name: string;
  key: string | null;
  maxHitPoints: number;
  damage: number;
  temporaryHitPoints: number;
  notes: string | null;
}

export interface CombatState {
  version: number;
  damage: number;
  temporaryHitPoints: number;
  /** the maximum the simulator last worked out, kept for the DM's fight board */
  maxHitPoints?: number | null;
  hitDiceSpent: number;
  uses: Record<string, number>;
  concentration: string | null;
  conditions: string[];
  exhaustion: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  heroicInspiration: boolean;
  companions: Companion[];
  /** item powers switched on: "<inventory entry id>:<power id>" (a Flame Tongue ablaze) */
  active: string[];
  /** spells, features and situations affecting the character now ("Shield", "Bladesong", "Aid@3"); see effectFor */
  effects: string[];
}

export const EMPTY_COMBAT: CombatState = {
  version: 1,
  damage: 0,
  temporaryHitPoints: 0,
  hitDiceSpent: 0,
  uses: {},
  concentration: null,
  conditions: [],
  exhaustion: 0,
  deathSaveSuccesses: 0,
  deathSaveFailures: 0,
  heroicInspiration: false,
  companions: [],
  active: [],
  effects: [],
};

/** The maximum hit points: 2014 exhaustion level 4 halves it. */
export function maxHitPoints(max: number, state: CombatState, edition: "2014" | "2024"): number {
  return edition === "2014" && state.exhaustion >= 4 ? Math.floor(max / 2) : max;
}

export function currentHitPoints(max: number, state: CombatState): number {
  return Math.max(0, max - state.damage);
}

/** Damage takes temporary hit points first; at 0 hit points the death saves start over. */
export function takeDamage(state: CombatState, amount: number, max: number): CombatState {
  if (amount <= 0) return state;
  const fromTemp = Math.min(state.temporaryHitPoints, amount);
  const rest = amount - fromTemp;
  return { ...state, temporaryHitPoints: state.temporaryHitPoints - fromTemp, damage: Math.min(max, state.damage + rest) };
}

/** Healing up to the maximum; any healing at 0 hit points ends the death saves. */
export function heal(state: CombatState, amount: number): CombatState {
  if (amount <= 0) return state;
  return { ...state, damage: Math.max(0, state.damage - amount), deathSaveSuccesses: 0, deathSaveFailures: 0 };
}

/** Temporary hit points do not add up: the new amount replaces the old if it is higher. */
export function gainTemporary(state: CombatState, amount: number): CombatState {
  return { ...state, temporaryHitPoints: Math.max(state.temporaryHitPoints, Math.max(0, amount)) };
}

type Restable = { title: string; usage?: string | null; regainOnShort?: boolean };

/** Uses that come back when the given rest (or turn) ends; on a short rest, one use of "regain one" features too. */
function resetUses(uses: Record<string, number>, features: Restable[], recharges: Recharge[]): Record<string, number> {
  const next = { ...uses };
  for (const f of features) {
    const u = parseUsage(f.usage);
    if (u?.kind !== "count") continue;
    if (recharges.includes(u.recharge)) delete next[f.title];
    else if (f.regainOnShort && recharges.includes("short") && next[f.title]) {
      next[f.title] -= 1;
      if (next[f.title] <= 0) delete next[f.title];
    }
  }
  return next;
}

/** A new turn: "1/Turn" features (Sneak Attack) come back. */
export function newTurn(state: CombatState, features: Restable[]): CombatState {
  return { ...state, uses: resetUses(state.uses, features, ["turn"]) };
}

/**
 * A short rest: spend hit dice (each heals its roll plus the Constitution modifier, at least 0) and get back
 * short-rest features. Pact Magic slots come back too (done by the caller, in the magic state).
 */
export function shortRest(state: CombatState, features: Restable[], healed: number, diceSpent: number): CombatState {
  return { ...heal({ ...state, uses: resetUses(state.uses, features, ["turn", "short"]) }, healed), hitDiceSpent: state.hitDiceSpent + diceSpent };
}

/**
 * A long rest: all hit points, temporary hit points gone, every feature back, one level of exhaustion less,
 * concentration and death saves over. Hit dice: 2024 gives all back, 2014 half the total (at least one).
 * Spell slots come back too (done by the caller, in the magic state).
 */
export function longRest(state: CombatState, features: Restable[], totalHitDice: number, edition: "2014" | "2024"): CombatState {
  const regained = edition === "2024" ? totalHitDice : Math.max(1, Math.floor(totalHitDice / 2));
  return {
    ...state,
    damage: 0,
    temporaryHitPoints: 0,
    hitDiceSpent: Math.max(0, state.hitDiceSpent - regained),
    uses: resetUses(state.uses, features, ["turn", "short", "long"]),
    concentration: null,
    exhaustion: Math.max(0, state.exhaustion - 1),
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    companions: (state.companions ?? []).map((c) => ({ ...c, damage: 0, temporaryHitPoints: 0 })),
    active: [],
    effects: [],
  };
}

/** Damage or healing to a companion (temporary hit points first), kept between 0 and its maximum. */
export function hurtCompanion(c: Companion, amount: number): Companion {
  if (amount >= 0) {
    const fromTemp = Math.min(c.temporaryHitPoints, amount);
    return { ...c, temporaryHitPoints: c.temporaryHitPoints - fromTemp, damage: Math.min(c.maxHitPoints, c.damage + amount - fromTemp) };
  }
  return { ...c, damage: Math.max(0, c.damage + amount) };
}

/** The shapes Find Familiar offers, by edition (2024 also allows any other CR 0 beast); Pact of the Chain adds its own. */
export function familiarForms(edition: "2014" | "2024", chain: boolean): string[] {
  const forms =
    edition === "2024"
      ? ["Bat", "Cat", "Frog", "Hawk", "Lizard", "Octopus", "Owl", "Rat", "Raven", "Spider", "Weasel"]
      : ["Bat", "Cat", "Crab", "Frog", "Hawk", "Lizard", "Octopus", "Owl", "Poisonous Snake", "Quipper", "Rat", "Raven", "Sea Horse", "Spider", "Weasel"];
  const pact = edition === "2024" ? ["Imp", "Pseudodragon", "Quasit", "Skeleton", "Slaad Tadpole", "Sphinx of Wonder", "Sprite", "Venomous Snake"] : ["Imp", "Pseudodragon", "Quasit", "Sprite"];
  return [...new Set(chain ? [...forms, ...pact] : forms)].sort();
}

// ---- conditions

export const CONDITIONS: { name: string; effect: string; noActions?: boolean; noReactions?: boolean; speedZero?: boolean; attackDisadvantage?: boolean }[] = [
  { name: "Blinded", effect: "Can't see; attacks against you have advantage, your attacks have disadvantage.", attackDisadvantage: true },
  { name: "Charmed", effect: "Can't attack the charmer or target it with harmful effects; it has advantage on social checks with you." },
  { name: "Deafened", effect: "Can't hear; fails checks that need hearing." },
  { name: "Frightened", effect: "Disadvantage on ability checks and attacks while the source is in sight; can't move closer to it.", attackDisadvantage: true },
  { name: "Grappled", effect: "Speed 0. (2024: disadvantage on attacks against anyone but the grappler.)", speedZero: true },
  { name: "Incapacitated", effect: "No actions, bonus actions or reactions. (2024: also concentration breaks, can't speak.)", noActions: true, noReactions: true },
  { name: "Invisible", effect: "Attacks against you have disadvantage, your attacks have advantage." },
  { name: "Paralyzed", effect: "Incapacitated, speed 0, fail Str and Dex saves; hits within 5 ft are critical.", noActions: true, noReactions: true, speedZero: true },
  { name: "Petrified", effect: "Incapacitated, speed 0, resistance to all damage, fail Str and Dex saves.", noActions: true, noReactions: true, speedZero: true },
  { name: "Poisoned", effect: "Disadvantage on attack rolls and ability checks.", attackDisadvantage: true },
  { name: "Prone", effect: "Disadvantage on attacks; standing up costs half your speed; melee attacks against you have advantage.", attackDisadvantage: true },
  { name: "Restrained", effect: "Speed 0; disadvantage on attacks and Dex saves; attacks against you have advantage.", speedZero: true, attackDisadvantage: true },
  { name: "Stunned", effect: "Incapacitated, fail Str and Dex saves; attacks against you have advantage.", noActions: true, noReactions: true },
  { name: "Unconscious", effect: "Incapacitated, prone, drop what you hold; hits within 5 ft are critical.", noActions: true, noReactions: true, speedZero: true },
];

/** What exhaustion does at a level, by edition. */
export function exhaustionEffect(level: number, edition: "2014" | "2024"): { text: string; d20Penalty: number; speedPenalty: number; speedHalved: boolean; speedZero: boolean; attackDisadvantage: boolean } {
  if (level <= 0) return { text: "", d20Penalty: 0, speedPenalty: 0, speedHalved: false, speedZero: false, attackDisadvantage: false };
  if (edition === "2024") {
    return { text: level >= 6 ? "Death." : `−${2 * level} to every d20 test, speed −${5 * level} ft.`, d20Penalty: 2 * level, speedPenalty: 5 * level, speedHalved: false, speedZero: false, attackDisadvantage: false };
  }
  const steps = ["Disadvantage on ability checks", "speed halved", "disadvantage on attacks and saves", "hit point maximum halved", "speed 0", "death"];
  return { text: `${steps.slice(0, Math.min(level, 6)).join("; ")}.`, d20Penalty: 0, speedPenalty: 0, speedHalved: level >= 2, speedZero: level >= 5, attackDisadvantage: level >= 3 };
}

// ---- weapons

/** The 2024 weapon mastery properties, in short. */
export const MASTERY: Record<string, string> = {
  Cleave: "Hit: make one more attack against a second creature within 5 ft of the first (no ability modifier to its damage); once per turn.",
  Graze: "Miss: the target still takes damage equal to your ability modifier.",
  Nick: "The Light weapon's extra attack is part of the Attack action instead of a bonus action; once per turn.",
  Push: "Hit: push a Large or smaller creature up to 10 ft straight away from you.",
  Sap: "Hit: the target has disadvantage on its next attack roll before your next turn.",
  Slow: "Hit and damage: the target's speed drops by 10 ft until the start of your next turn.",
  Topple: "Hit: the target makes a Constitution save (DC 8 + ability modifier + proficiency) or falls prone.",
  Vex: "Hit and damage: you have advantage on your next attack roll against it before the end of your next turn.",
};

/** "+5 vs AC" → 5. */
export function attackBonusOf(attack: string): number | null {
  const m = attack.match(/([+-−]?\d+)/);
  return m ? Number(m[1].replace("−", "-")) : null;
}

export const percent = (p: number) => `${Math.round(p * 100)}%`;
export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// ---- magic items

/** Extra damage an item's text gives its weapon's hits: always, while switched on, or against some targets. */
export interface ItemRider {
  id: string;
  /** "Always", "While the sword is ablaze", "Against fiend or undead" */
  label: string;
  roll: Roll;
  /** applies on every hit (no switch needed) */
  always: boolean;
  /** only on a critical hit */
  critOnly: boolean;
}

/**
 * The extra damage in a magic weapon's text: "it deals an extra 2d6 fire damage", "takes an extra 2d10 radiant
 * damage", "an extra 3d6 damage of the weapon's type", "plus 4d6 lightning damage". `weaponType` names the
 * weapon's damage type for "of the weapon's type".
 */
export function itemRiders(html: string, weaponType = ""): ItemRider[] {
  const text = plainSpellText(html);
  const out: ItemRider[] = [];
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const m = sentence.match(/(?:an extra|plus) (\d+d\d+) (?:([a-z]+) damage|damage(?: of the weapon[’']s type)?)/i);
    if (!m) continue;
    const roll = parseRoll(m[1]);
    if (!roll) continue;
    roll.type = (m[2] ?? weaponType).toLowerCase();
    const critOnly = /critical hit/i.test(sentence) && /roll a 20/i.test(sentence);
    const versus = sentence.match(/when you hit (?:an? |any )?([a-z ,]+?) with/i)?.[1] ?? sentence.match(/if the target is an? ([a-z ]+)/i)?.[1];
    const condition = sentence.match(/^(?:while|as long as) ([^,]+)/i)?.[1];
    // a power used now and then (a command word, once a day) adds its damage only when switched on
    const power = /\b(?:once|bonus action|action|until|expend|charge)\b/i.test(sentence) || (/^(?:on a hit|plus)\b/i.test(sentence) && /command word|can[’']t be used again|until (?:the next )?dawn/i.test(text));
    const always = !versus && !condition && !critOnly && !power;
    const label = critOnly
      ? "On a critical hit"
      : versus
        ? `Against ${versus.trim().toLowerCase().replace(/\b(?:an?|any)\s+/g, "")}`
        : condition
          ? `While ${condition.trim()}`
          : always
            ? "On every hit"
            : "When you use its power";
    out.push({ id: `extra${out.length}`, label, roll, always, critOnly });
  }
  return out;
}

/** What a potion or other consumable heals: "regains 2d4 + 2 Hit Points". */
export function itemHealing(html: string): Roll | null {
  const m = plainSpellText(html).match(/regains? (\d+d\d+(?:\s*\+\s*\d+)?) hit points/i);
  return m ? { ...parseRoll(m[1])!, type: "healing" } : null;
}

// ---- active effects: spells and features that change the character's numbers for a while

export interface EffectContext {
  edition: "2014" | "2024";
  mod: (abbreviation: string) => number;
  proficiencyBonus: number;
  /** the barbarian's Rage damage bonus, if any */
  rageDamage: number;
}

export interface BattleEffect {
  key: string;
  name: string;
  /** what it does, in a few words */
  summary: string;
  kind: "spell" | "feature" | "situation";
  /** a new base AC while no armor is worn (Mage Armor: 13 + Dexterity) */
  acBase?: number;
  acBonus?: number;
  /** AC can't be lower than this (Barkskin) */
  acFloor?: number;
  /** the AC bonus needs this: no armor at all, or no medium or heavy armor and no shield (Bladesong) */
  armorNeeded?: "none" | "light-no-shield";
  attackBonus?: number;
  /** a die added to (or taken from) attack rolls and saves: Bless +1d4, Bane −1d4 */
  d20Die?: { sides: number; sign: 1 | -1 };
  saveBonus?: number;
  /** extra damage on weapon hits (Hunter's Mark, Divine Favor) */
  weaponDamage?: Roll;
  /** a flat bonus to Strength-based melee weapon damage (Rage) */
  strengthMeleeDamage?: number;
  speedBonus?: number;
  speedMultiplier?: number;
  maxHpBonus?: number;
  /** ends at the start of your next turn (Shield, Dodge) */
  untilNextTurn?: boolean;
  concentration?: boolean;
  /** survives a short rest (lasts an hour or more) */
  longLasting?: boolean;
  /** things it does that are not numbers here (resistances, advantage) */
  notes?: string;
}

const die = (count: number, sides: number, type: string): Roll => ({ dice: [{ count, sides }], bonus: 0, type });

/**
 * The effect a spell, feature or situation has on the character, by its name ("Shield", "Bladesong", "Cover:
 * three-quarters"), with an optional slot level ("Aid@3"); null when it changes none of the numbers shown here.
 */
export function effectFor(key: string, c: EffectContext): BattleEffect | null {
  const [rawName, level] = key.split("@");
  const name = rawName.trim();
  const slot = Number(level) || 0;
  const base = { key, name };
  const spell = (e: Omit<BattleEffect, "key" | "name" | "kind">): BattleEffect => ({ ...base, kind: "spell", ...e });
  const int = c.mod("INT");
  switch (name.toLowerCase()) {
    case "shield":
      return spell({ summary: "+5 AC until the start of your next turn; no damage from Magic Missile", acBonus: 5, untilNextTurn: true });
    case "shield of faith":
      return spell({ summary: "+2 AC", acBonus: 2, concentration: true });
    case "mage armor":
      return spell({ summary: "base AC 13 + Dexterity while you wear no armor", acBase: 13 + c.mod("DEX"), longLasting: true });
    case "barkskin":
      return c.edition === "2024"
        ? spell({ summary: "AC can't be less than 17", acFloor: 17, longLasting: true })
        : spell({ summary: "AC can't be less than 16", acFloor: 16, concentration: true, longLasting: true });
    case "haste":
      return spell({ summary: "+2 AC, speed doubled, advantage on Dexterity saves, one extra limited action", acBonus: 2, speedMultiplier: 2, concentration: true, notes: "When it ends you can't move or act until after your next turn." });
    case "slow":
      return spell({ summary: "−2 AC and Dexterity saves, speed halved, no reactions, one action or bonus action a turn", acBonus: -2, speedMultiplier: 0.5, notes: "−2 to Dexterity saving throws." });
    case "warding bond":
      return spell({ summary: "+1 AC and saving throws, resistance to all damage", acBonus: 1, saveBonus: 1, longLasting: true });
    case "bless":
      return spell({ summary: "+1d4 to attack rolls and saving throws", d20Die: { sides: 4, sign: 1 }, concentration: true });
    case "bane":
      return spell({ summary: "−1d4 to attack rolls and saving throws", d20Die: { sides: 4, sign: -1 }, concentration: true });
    case "hunter's mark":
    case "hunter’s mark":
      return spell({ summary: `+1d6${c.edition === "2024" ? " force" : ""} damage on weapon hits against the marked target`, weaponDamage: die(1, 6, c.edition === "2024" ? "force" : "damage"), concentration: true, longLasting: true });
    case "hex":
      return spell({ summary: "+1d6 necrotic on hits against the hexed target", weaponDamage: die(1, 6, "necrotic"), concentration: true, longLasting: true });
    case "divine favor":
      return spell({ summary: "+1d4 radiant on weapon hits", weaponDamage: die(1, 4, "radiant"), concentration: c.edition === "2014" });
    case "elemental weapon":
      return spell({ summary: "+1 to hit and +1d4 elemental damage with the weapon", attackBonus: 1, weaponDamage: die(1, 4, "elemental"), concentration: true, longLasting: true });
    case "magic weapon":
      return spell({ summary: `+${slot >= 6 ? 3 : slot >= 4 ? 2 : 1} to hit and damage with the weapon`, attackBonus: slot >= 6 ? 3 : slot >= 4 ? 2 : 1, weaponDamage: { dice: [], bonus: slot >= 6 ? 3 : slot >= 4 ? 2 : 1, type: "" }, concentration: c.edition === "2014", longLasting: true });
    case "enlarge":
    case "enlarge/reduce":
      return spell({ summary: "enlarged: +1d4 weapon damage, advantage on Strength checks and saves", weaponDamage: die(1, 4, "damage"), concentration: true });
    case "reduce":
      return spell({ summary: "reduced: −1d4 weapon damage, disadvantage on Strength checks and saves", weaponDamage: die(-1, 4, "damage"), concentration: true });
    case "longstrider":
      return spell({ summary: "+10 ft speed", speedBonus: 10, longLasting: true });
    case "aid": {
      const hp = 5 * Math.max(1, (slot || 2) - 1);
      return spell({ summary: `+${hp} hit point maximum (and current)`, maxHpBonus: hp, longLasting: true });
    }
    case "heroism":
      return spell({ summary: "immune to Frightened; temporary hit points equal to the caster's spellcasting modifier at the start of each turn", concentration: true });
    case "blade ward":
      return spell({ summary: c.edition === "2024" ? "attack rolls against you take −1d4" : "resistance to bludgeoning, piercing and slashing from weapon attacks", concentration: c.edition === "2024" });
    case "bladesong":
      return {
        ...base,
        kind: "feature",
        summary: `+${Math.max(1, int)} AC, +10 ft speed, advantage on Acrobatics, +${Math.max(1, int)} to Constitution saves for concentration (light or no armor, no shield)`,
        acBonus: Math.max(1, int),
        armorNeeded: "light-no-shield",
        speedBonus: 10,
      };
    case "rage":
      return {
        ...base,
        kind: "feature",
        summary: `+${c.rageDamage} damage with Strength melee attacks, resistance to bludgeoning, piercing and slashing, advantage on Strength checks and saves; no spells`,
        strengthMeleeDamage: c.rageDamage,
      };
    case "dodge":
      return { ...base, kind: "situation", summary: "attacks against you have disadvantage, advantage on Dexterity saves", untilNextTurn: true };
    case "cover: half":
      return { ...base, kind: "situation", summary: "+2 AC and Dexterity saves", acBonus: 2 };
    case "cover: three-quarters":
      return { ...base, kind: "situation", summary: "+5 AC and Dexterity saves", acBonus: 5 };
    default:
      return null;
  }
}

/** Spells that only ever affect the caster: casting one turns its effect on. */
export const SELF_SPELLS = new Set(["shield", "mage armor", "divine favor", "hunter's mark", "hunter’s mark", "hex", "blade ward", "longstrider", "elemental weapon", "magic weapon"]);

/** Effects a player may turn on by hand (cast on them by an ally, or a situation). */
export const PICKABLE_EFFECTS = ["Bless", "Bane", "Haste", "Slow", "Shield of Faith", "Barkskin", "Warding Bond", "Mage Armor", "Aid@2", "Longstrider", "Enlarge", "Reduce", "Heroism", "Dodge", "Cover: half", "Cover: three-quarters"];

export interface ArmorFacts {
  total: number;
  /** the armor's or unarmored calculation's base, before Dexterity and bonuses */
  base: number;
  /** "Light", "Medium", "Heavy", or null without armor */
  armorKind: string | null;
  shield: boolean;
}

/** The AC with the effects: Mage Armor's base without armor, then bonuses (Bladesong only in light or no armor and no shield), then floors (Barkskin). */
export function effectiveArmorClass(armor: ArmorFacts, effects: BattleEffect[]): { total: number; changes: string[] } {
  let total = armor.total;
  const changes: string[] = [];
  for (const e of effects) {
    if (e.acBase === undefined || armor.armorKind) continue;
    if (e.acBase > armor.base) {
      changes.push(`${e.name}: base ${e.acBase} instead of ${armor.base}`);
      total += e.acBase - armor.base;
    }
  }
  for (const e of effects) {
    if (!e.acBonus) continue;
    const fits = e.armorNeeded === "none" ? !armor.armorKind : e.armorNeeded === "light-no-shield" ? (!armor.armorKind || armor.armorKind === "Light") && !armor.shield : true;
    if (!fits) {
      changes.push(`${e.name}: no AC bonus in ${armor.shield ? "a shield" : `${armor.armorKind?.toLowerCase()} armor`}`);
      continue;
    }
    total += e.acBonus;
    changes.push(`${e.name} ${e.acBonus > 0 ? "+" : ""}${e.acBonus}`);
  }
  for (const e of effects) {
    if (e.acFloor && total < e.acFloor) {
      changes.push(`${e.name}: at least ${e.acFloor}`);
      total = e.acFloor;
    }
  }
  return { total, changes };
}

/** The chance to hit with a die added to (or taken from) the roll (Bless, Bane): each face equally likely. */
export function hitChanceWithDie(bonus: number, ac: number, advantage: Advantage, d: { sides: number; sign: 1 | -1 } | null): { hit: number; crit: number } {
  if (!d) return hitChance(bonus, ac, advantage);
  let hit = 0;
  let crit = 0;
  for (let face = 1; face <= d.sides; face++) {
    const h = hitChance(bonus + d.sign * face, ac, advantage);
    hit += h.hit / d.sides;
    crit += h.crit / d.sides;
  }
  return { hit, crit };
}

/** Speed with the effects: bonuses first, then doubling or halving. */
export function effectiveSpeed(speed: number, effects: BattleEffect[]): number {
  if (speed <= 0) return 0;
  const plus = effects.reduce((n, e) => n + (e.speedBonus ?? 0), 0);
  const times = effects.reduce((n, e) => n * (e.speedMultiplier ?? 1), 1);
  return Math.floor((speed + plus) * times);
}
