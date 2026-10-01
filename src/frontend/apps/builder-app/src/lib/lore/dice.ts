/** Rolling the dice written in the books: "2d6", "1d8 + 3", "4d6 + 1d4 - 1". */

export interface DiceTerm {
  count: number;
  sides: number;
  sign: 1 | -1;
}

export interface ParsedDice {
  dice: DiceTerm[];
  bonus: number;
}

/** The terms of a dice expression, or null when it is not one ("(summonSpellLevel - 4)d4 + 3"). */
export function parseDice(expression: string): ParsedDice | null {
  const s = expression.replace(/\s+/g, "").replace(/[−–]/g, "-").toLowerCase();
  if (!s || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(s)) return null;
  const dice: DiceTerm[] = [];
  let bonus = 0;
  for (const m of s.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    const term = m[2];
    if (term.includes("d")) {
      const [count, sides] = term.split("d");
      const n = count === "" ? 1 : Number(count);
      if (n > 100 || Number(sides) > 1000 || Number(sides) < 1) return null;
      dice.push({ count: n, sides: Number(sides), sign });
    } else bonus += sign * Number(term);
  }
  return dice.length || bonus ? { dice, bonus } : null;
}

export interface Roll {
  total: number;
  /** each die's result, signed */
  rolls: number[];
  bonus: number;
}

export function roll(parsed: ParsedDice, random: () => number = Math.random): Roll {
  const rolls: number[] = [];
  for (const d of parsed.dice) for (let i = 0; i < d.count; i++) rolls.push(d.sign * (1 + Math.floor(random() * d.sides)));
  return { total: rolls.reduce((a, b) => a + b, 0) + parsed.bonus, rolls, bonus: parsed.bonus };
}

/** "4 + 3 + 2 = 9" */
export function describeRoll(r: Roll): string {
  const parts = [...r.rolls.map(String), ...(r.bonus ? [String(r.bonus)] : [])];
  return parts.length > 1 ? `${parts.join(" + ").replace(/\+ -/g, "− ")} = ${r.total}` : String(r.total);
}
