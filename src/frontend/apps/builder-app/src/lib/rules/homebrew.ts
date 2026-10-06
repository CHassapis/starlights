/** A homebrew monster: the stat block the DM writes on the Homebrew page, and what an encounter needs from it. */

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

export interface HomebrewMonster {
  id?: string;
  name: string;
  /** "Medium fiend, neutral evil" */
  kind: string;
  cr: string;
  ac: number;
  /** what the AC comes from: "natural armor" */
  acNote?: string;
  hp: number;
  /** "15d8 + 45" */
  hpFormula?: string;
  speed: string;
  abilities: Record<AbilityKey, number>;
  /** listed save bonuses: "Dex +5, Wis +3" (the rest use the ability modifier) */
  saves?: string;
  skills?: string;
  defenses?: string;
  senses?: string;
  languages?: string;
  /** one per line: "Name. What it does." */
  traits?: string;
  actions?: string;
  bonusActions?: string;
  reactions?: string;
  legendary?: string;
  notes?: string;
}

export const EMPTY_MONSTER: HomebrewMonster = {
  name: "",
  kind: "Medium humanoid, neutral",
  cr: "1",
  ac: 12,
  hp: 20,
  speed: "30 ft.",
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
};

export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const signedMod = (score: number) => {
  const m = modifier(score);
  return m >= 0 ? `+${m}` : `${m}`;
};

/** Save bonuses for every ability: the listed ones ("Dex +5"), the rest from the ability modifier. */
export function saveBonuses(m: HomebrewMonster): Record<AbilityKey, number> {
  const out = Object.fromEntries(ABILITY_KEYS.map((k) => [k, modifier(m.abilities[k] ?? 10)])) as Record<AbilityKey, number>;
  for (const part of (m.saves ?? "").split(/[,;]/)) {
    const match = part.trim().match(/^(str|dex|con|int|wis|cha)\w*\s*([+-]\d+)$/i);
    if (match) out[match[1].toLowerCase() as AbilityKey] = Number(match[2]);
  }
  return out;
}
