/**
 * The {@tag …} markup inside 5etools text: "{@spell fireball}", "{@b bold {@i and italic}}",
 * "{@creature goblin|MM|goblins}". parseTags turns a string into plain text and tag nodes (nested tags parsed
 * too); the renderer decides what each tag looks like. Written for this app; it follows the markup as the
 * 5etools data uses it, not 5etools' code.
 */

export interface TagNode {
  tag: string;
  /** the text after the tag name, split at the top-level "|" */
  args: string[];
  /** the raw text after the tag name */
  text: string;
}

export type TextNode = string | TagNode;

/** Where the matching "}" of the "{" at `start` is, counting nested braces; -1 when it never closes. */
function closingBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Splits at "|" that are not inside a nested tag. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "|" && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

export function parseTags(s: string): TextNode[] {
  const out: TextNode[] = [];
  let i = 0;
  let plain = "";
  while (i < s.length) {
    if (s[i] === "{" && s[i + 1] === "@") {
      const end = closingBrace(s, i);
      if (end < 0) break;
      const inner = s.slice(i + 2, end);
      const space = inner.search(/\s/);
      const tag = space < 0 ? inner : inner.slice(0, space);
      const text = space < 0 ? "" : inner.slice(space + 1);
      if (plain) out.push(plain);
      plain = "";
      out.push({ tag, args: splitArgs(text), text });
      i = end + 1;
    } else {
      plain += s[i];
      i++;
    }
  }
  plain += s.slice(i);
  if (plain) out.push(plain);
  return out;
}

/** The text a tag shows (most references: the third part if given, else the first). */
export function displayText(node: TagNode): string {
  const [first = "", , third] = node.args;
  return third?.trim() ? third : first;
}

/** Text with every tag replaced by what it shows: for search, titles and plain summaries. */
export function stripTags(s: string): string {
  return parseTags(s)
    .map((n) => (typeof n === "string" ? n : stripTags(plainTagText(n))))
    .join("");
}

const ATTACK_2014: Record<string, string> = {
  mw: "Melee Weapon Attack:",
  rw: "Ranged Weapon Attack:",
  ms: "Melee Spell Attack:",
  rs: "Ranged Spell Attack:",
  "mw,rw": "Melee or Ranged Weapon Attack:",
  "ms,rs": "Melee or Ranged Spell Attack:",
  "m,r": "Melee or Ranged Attack:",
  m: "Melee Attack:",
  r: "Ranged Attack:",
};
const ATTACK_2024: Record<string, string> = { m: "Melee Attack Roll:", r: "Ranged Attack Roll:", "m,r": "Melee or Ranged Attack Roll:" };
export const ABILITY_NAMES: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** What a tag reads as, without links or styling. */
export function plainTagText(n: TagNode): string {
  const [a = "", b = ""] = n.args;
  switch (n.tag) {
    case "atk":
      return ATTACK_2014[a] ?? "Attack:";
    case "atkr":
      return ATTACK_2024[a] ?? "Attack Roll:";
    case "h":
      return "Hit: ";
    case "m":
      return "Miss: ";
    case "hom":
      return "Hit or Miss: ";
    case "hit":
      return Number(a) >= 0 && !a.startsWith("+") ? `+${a}` : a;
    case "d20":
      return Number(a) >= 0 && !a.startsWith("+") ? `+${a}` : a;
    case "dc":
      return `DC ${b || a}`;
    case "dcYourSpellSave":
      return a || "your spell save DC";
    case "hitYourSpellAttack":
      return a || "your spell attack modifier";
    case "recharge":
      return a ? `(Recharge ${a}${a === "6" ? "" : "–6"})` : "(Recharge 6)";
    case "chance":
      return b || `${a} percent`;
    case "dice":
    case "damage":
    case "autodice":
      return b || a;
    case "scaledice":
    case "scaledamage":
      return n.args[2] || a;
    case "actSave":
      return `${ABILITY_NAMES[a] ?? a} Saving Throw:`;
    case "actSaveFail":
      return a ? `Failure by ${a} or More:` : "Failure:";
    case "actSaveFailBy":
      return `Failure by ${a} or More:`;
    case "actSaveSuccess":
      return "Success:";
    case "actSaveSuccessOrFail":
      return "Failure or Success:";
    case "actTrigger":
      return "Trigger:";
    case "actResponse":
      return a === "d" ? "Response—" : "Response:";
    case "coinflip":
      return a || "flip a coin";
    case "note":
    case "b":
    case "bold":
    case "i":
    case "italic":
    case "u":
    case "underline":
    case "u2":
    case "underlineDouble":
    case "s":
    case "strike":
    case "s2":
    case "strikeDouble":
    case "sup":
    case "sub":
    case "kbd":
    case "code":
    case "tip":
    case "comic":
    case "comicH1":
    case "comicH2":
    case "comicH3":
    case "comicH4":
    case "comicNote":
      return n.text;
    case "color":
    case "highlight":
    case "style":
    case "font":
    case "help":
    case "footnote":
    case "link":
    case "5etools":
    case "5etoolsImg":
    case "5etoolsAudio":
    case "filter":
    case "book":
    case "adventure":
    case "loader":
    case "unit":
    case "area":
      return a;
    case "quickref":
      return n.args[4] || a;
    default:
      return displayText(n);
  }
}
