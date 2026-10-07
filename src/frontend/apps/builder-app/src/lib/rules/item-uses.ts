/**
 * What a magic item lets its owner do on a turn, read from its text, so the simulator can put it under the action
 * it takes (Action, Bonus Action, Reaction): "As a bonus action, spend 1 charge: gain 1d6 temporary hit points",
 * "When an ally takes damage, you can use your reaction to reduce that damage by 1d8", drinking a potion. Spells an
 * item casts are its item spells (item-spells.ts), not uses.
 */
import { itemHealing, parseRoll, plainSpellText, type Roll } from "./battle";

export type UseSlot = "Action" | "Bonus Action" | "Reaction";

export interface ItemUse {
  id: string;
  slot: UseSlot;
  /** what it does, as a button would say it ("Gain 1d6 temporary hit points") */
  label: string;
  kind: "tempHp" | "heal" | "saveBonus" | "reduceDamage" | "other";
  roll: Roll | null;
  /** charges it spends (0: none) */
  charges: number;
  /** used up when used (a potion) */
  consumes: boolean;
  /** the item's own words for it */
  text: string;
}

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const DICE = String.raw`(\d+d\d+(?:\s*[+-]\s*\d+)?)`;

function slotOf(sentence: string): UseSlot | null {
  if (/\bbonus action\b/i.test(sentence)) return "Bonus Action";
  if (/\b(?:your |a |its )?reaction\b/i.test(sentence)) return "Reaction";
  if (/\bas an action\b|\buse an action\b|\btake the (?:magic|use an object|utilize) action\b|\baction:/i.test(sentence)) return "Action";
  return null;
}

function chargesOf(sentence: string): number {
  const m = sentence.match(/\b(?:spend|expend|use)s?\s+(\d+|a|an|one|two|three|four|five)\s+(?:of its\s+)?charges?\b/i);
  if (!m) return 0;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (WORDS[m[1].toLowerCase()] ?? 1);
}

/** The uses an item's text describes, each under the action it takes. */
export function itemUses(html: string, opts: { consumable: boolean; edition: "2014" | "2024"; castsSpells: boolean }): ItemUse[] {
  const uses: ItemUse[] = [];
  // a potion or similar: drinking it is a Bonus Action in the 2024 rules, an action in 2014
  if (opts.consumable) {
    const heals = itemHealing(html);
    if (heals) {
      uses.push({ id: "drink", slot: opts.edition === "2024" ? "Bonus Action" : "Action", label: "Drink it: heal", kind: "heal", roll: heals, charges: 0, consumes: true, text: "" });
      return uses;
    }
  }
  const text = plainSpellText(html);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  sentences.forEach((sentence, i) => {
    const slot = slotOf(sentence);
    if (!slot) return;
    // casting a spell is the item's spells, shown with the other spells of that action
    if (opts.castsSpells && /\bcast\b/i.test(sentence)) return;
    // the effect can be in the same sentence or the next ("Bonus action: spend 1 charge. You gain 1d6 temporary hit points.")
    const scope = `${sentence} ${sentences[i + 1] ?? ""}`;
    const charges = chargesOf(sentence) || chargesOf(sentences[i + 1] ?? "");
    const found: Omit<ItemUse, "id" | "slot" | "charges" | "consumes" | "text">[] = [];
    const temp = scope.match(new RegExp(`${DICE}\\s+temporary hit points`, "i"));
    if (temp) found.push({ label: `Gain ${temp[1]} temporary hit points`, kind: "tempHp", roll: parseRoll(temp[1]) });
    const save = scope.match(new RegExp(`add\\s+${DICE}\\s+to\\s+(?:your next |a |one |the |its )?saving throw`, "i"));
    if (save) found.push({ label: `Add ${save[1]} to a saving throw`, kind: "saveBonus", roll: parseRoll(save[1]) });
    const reduce = scope.match(new RegExp(`reduce\\s+(?:that |the |this )?damage(?: taken)?\\s+by\\s+${DICE}`, "i"));
    if (reduce) found.push({ label: `Reduce the damage by ${reduce[1]}`, kind: "reduceDamage", roll: parseRoll(reduce[1]) });
    const heal = !temp && scope.match(new RegExp(`regains?\\s+${DICE}\\s+hit points`, "i"));
    if (heal) found.push({ label: `Regain ${heal[1]} hit points`, kind: "heal", roll: { ...parseRoll(heal[1])!, type: "healing" } });
    if (found.length === 0) found.push({ label: sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence, kind: "other", roll: null });
    for (const f of found) uses.push({ ...f, id: `${i}-${f.kind}`, slot, charges, consumes: false, text: sentence });
  });
  // the same use read twice (an action sentence and the next one) counts once
  return uses.filter((u, i) => uses.findIndex((v) => v.kind === u.kind && v.label === u.label) === i);
}
