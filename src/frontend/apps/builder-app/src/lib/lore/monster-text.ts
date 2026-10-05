/** A creature's size, type, alignment, challenge, armor class, hit points, speed and defenses as words. */

export const SIZES: Record<string, string> = { F: "Fine", D: "Diminutive", T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan", C: "Colossal", V: "Varies" };
export const SIZE_ORDER = ["T", "S", "M", "L", "H", "G"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function sizeText(size: unknown): string {
  const list = Array.isArray(size) ? (size as string[]) : typeof size === "string" ? [size] : [];
  return list.map((s) => SIZES[s] ?? s).join(" or ");
}

/** The creature's main types ("fey"), for filtering. */
export function mainTypes(type: unknown): string[] {
  if (typeof type === "string") return [type];
  if (isObj(type)) {
    const t = type.type;
    if (typeof t === "string") return [t];
    if (isObj(t) && Array.isArray(t.choose)) return t.choose as string[];
  }
  return [];
}

/** "fey (goblinoid)", "swarm of Tiny beasts". */
export function typeText(type: unknown): string {
  if (typeof type === "string") return type;
  if (!isObj(type)) return "";
  const main = mainTypes(type).join(" or ");
  if (type.swarmSize) return `swarm of ${SIZES[String(type.swarmSize)] ?? type.swarmSize} ${main === "beast" ? "beasts" : `${main}s`}`;
  const tags = Array.isArray(type.tags) ? (type.tags as unknown[]).map((t) => (typeof t === "string" ? t : isObj(t) ? `${t.prefix ?? ""} ${t.tag ?? ""}`.trim() : "")).filter(Boolean) : [];
  return tags.length ? `${main} (${tags.join(", ")})` : main;
}

const ALIGN: Record<string, string> = { L: "lawful", N: "neutral", NX: "neutral", NY: "neutral", C: "chaotic", G: "good", E: "evil", U: "unaligned", A: "any alignment" };

function alignmentPart(a: unknown): string {
  if (typeof a === "string") return ALIGN[a] ?? a;
  if (!isObj(a)) return "";
  if (typeof a.special === "string") return a.special;
  const inner = alignmentText(a.alignment);
  return a.chance ? `${inner} (${a.chance}%)` : inner;
}

export function alignmentText(alignment: unknown): string {
  if (!Array.isArray(alignment)) return typeof alignment === "string" ? alignmentPart(alignment) : "";
  const list = alignment as unknown[];
  if (list.some(isObj)) return list.map(alignmentPart).join(" or ");
  const set = new Set(list as string[]);
  if (set.has("A")) return "any alignment";
  if (set.size === 6 && set.has("L") && set.has("C") && set.has("G") && set.has("E")) return "any alignment";
  if (set.size === 5 && !set.has("G") && set.has("L") && set.has("C") && set.has("E") && set.has("NX")) return "any non-good alignment";
  if (set.size === 5 && !set.has("E") && set.has("G")) return "any non-evil alignment";
  if (set.size === 4 && set.has("C") && set.has("G") && set.has("E") && set.has("NY") && !set.has("L")) return "any chaotic alignment";
  if (set.size === 4 && set.has("L") && set.has("G") && set.has("E") && set.has("NY") && !set.has("C")) return "any lawful alignment";
  if (set.size === 4 && set.has("L") && set.has("C") && set.has("E") && set.has("NX") && !set.has("G")) return "any evil alignment";
  if (set.size === 4 && set.has("L") && set.has("C") && set.has("G") && set.has("NX") && !set.has("E")) return "any good alignment";
  if (list.length === 1 && list[0] === "N") return "neutral";
  return (list as string[]).map((a) => ALIGN[a] ?? a).join(" ");
}

/** Lawful, neutral, chaotic, good, evil, unaligned, any: for filtering. */
export function alignmentAxes(alignment: unknown): string[] {
  const flat = (a: unknown): string[] => (typeof a === "string" ? [a] : Array.isArray(a) ? a.flatMap(flat) : isObj(a) ? flat(a.alignment) : []);
  const out = new Set<string>();
  for (const a of flat(alignment)) {
    if (a === "L") out.add("lawful");
    else if (a === "C") out.add("chaotic");
    else if (a === "G") out.add("good");
    else if (a === "E") out.add("evil");
    else if (a === "N" || a === "NX" || a === "NY") out.add("neutral");
    else if (a === "U") out.add("unaligned");
    else if (a === "A") out.add("any");
  }
  return [...out];
}

export const XP_BY_CR: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
  "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000,
  "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

export function crString(cr: unknown): string {
  if (typeof cr === "string") return cr;
  if (isObj(cr) && typeof cr.cr === "string") return cr.cr;
  return "";
}

export function crValue(cr: unknown): number {
  const s = crString(cr);
  if (s.includes("/")) {
    const [a, b] = s.split("/").map(Number);
    return a / b;
  }
  return s === "" || s === "Unknown" ? -1 : Number(s);
}

export function proficiencyBonus(cr: unknown): number {
  const n = crValue(cr);
  return n < 5 ? 2 : Math.ceil(n / 4) + 1;
}

/** "1/4 (XP 50)" / "17 (XP 18,000, or 20,000 in lair)". */
export function crText(cr: unknown, modern: boolean): string {
  const s = crString(cr);
  if (!s) return "—";
  const xp = isObj(cr) && typeof cr.xp === "number" ? cr.xp : XP_BY_CR[s];
  const lair = isObj(cr) && typeof cr.xpLair === "number" ? cr.xpLair : null;
  const xpText = xp != null ? `${xp.toLocaleString("en-US")}${lair ? `, or ${lair.toLocaleString("en-US")} in lair` : ""}` : "";
  const parts = [isObj(cr) && cr.lair ? `${s} (${cr.lair} in lair)` : s];
  if (modern) return `${parts[0]}${xpText ? ` (XP ${xpText}; PB +${proficiencyBonus(cr)})` : ""}`;
  return `${parts[0]}${xpText ? ` (${xpText} XP)` : ""}`;
}

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
export const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Armor class with what gives it; may contain {@tags}. */
export function acText(ac: unknown): string {
  const list = Array.isArray(ac) ? ac : [ac];
  return list
    .map((a, i) => {
      if (typeof a === "number") return String(a);
      if (!isObj(a)) return "";
      if (typeof a.special === "string") return a.special;
      const from = Array.isArray(a.from) ? ` (${(a.from as string[]).join(", ")})` : "";
      const cond = typeof a.condition === "string" ? ` ${a.condition}` : "";
      const text = `${a.ac}${from}${cond}`;
      return i > 0 && a.braces ? `(${text})` : text;
    })
    .filter(Boolean)
    .join(", ");
}

export function hpText(hp: unknown): string {
  if (!isObj(hp)) return "";
  if (typeof hp.special === "string") return hp.special;
  return `${hp.average ?? ""}${hp.formula ? ` (${hp.formula})` : ""}`;
}

export function speedText(speed: unknown): string {
  if (typeof speed === "number") return `${speed} ft.`;
  if (!isObj(speed)) return "";
  const one = (v: unknown): string => (typeof v === "number" ? `${v} ft.` : isObj(v) ? `${v.number} ft.${v.condition ? ` ${v.condition}` : ""}` : v === true ? "equal to walking speed" : "");
  const parts: string[] = [];
  if (speed.walk !== undefined) parts.push(one(speed.walk));
  for (const k of ["burrow", "climb", "fly", "swim"]) if (speed[k] !== undefined) parts.push(`${k === "fly" ? "Fly" : cap(k)} ${one(speed[k])}${k === "fly" && speed.canHover && !isObj(speed[k]) ? " (hover)" : ""}`);
  if (isObj(speed.choose)) parts.push(`${(speed.choose.from as string[]).join(" or ")} ${speed.choose.amount} ft.${speed.choose.note ? ` ${speed.choose.note}` : ""}`);
  return parts.filter(Boolean).join(", ");
}

/** Which kinds of movement it has beyond walking, for filtering. */
export function speedKinds(speed: unknown): string[] {
  if (!isObj(speed)) return [];
  return ["burrow", "climb", "fly", "swim"].filter((k) => speed[k] !== undefined && speed[k] !== 0);
}

/** Damage immunities/resistances/vulnerabilities, with their notes ("from nonmagical attacks"). */
export function damageListText(list: unknown, key: "immune" | "resist" | "vulnerable"): string {
  if (!Array.isArray(list)) return "";
  const plain: string[] = [];
  const special: string[] = [];
  for (const d of list) {
    if (typeof d === "string") plain.push(d);
    else if (isObj(d)) {
      if (typeof d.special === "string") special.push(d.special);
      else {
        const inner = damageListText(d[key], key);
        special.push(`${d.preNote ? `${d.preNote} ` : ""}${inner}${d.note ? ` ${d.note}` : ""}`);
      }
    }
  }
  return [plain.join(", "), ...special].filter(Boolean).join("; ");
}

/** Every damage type named in a defense list, for filtering. */
export function damageTypes(list: unknown, key: "immune" | "resist" | "vulnerable"): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => (typeof d === "string" ? [d] : isObj(d) && Array.isArray(d[key]) ? damageTypes(d[key], key) : []));
}

export function conditionListText(list: unknown): string {
  if (!Array.isArray(list)) return "";
  return list
    .map((c) => (typeof c === "string" ? c : isObj(c) ? (typeof c.special === "string" ? c.special : `${conditionListText(c.conditionImmune)}${c.note ? ` ${c.note}` : ""}`) : ""))
    .filter(Boolean)
    .join(", ");
}

/** The creature's initiative bonus (2024 stat blocks): Dexterity plus proficiency when it has it. */
export function initiativeBonus(mon: Obj): number {
  const dex = abilityModifier(Number(mon.dex ?? 10));
  const init = mon.initiative;
  if (typeof init === "number") return init;
  if (isObj(init)) {
    if (typeof init.initiative === "number") return init.initiative;
    if (typeof init.proficiency === "number") return dex + init.proficiency * proficiencyBonus(mon.cr);
  }
  return dex;
}

/** "Small Fey (goblinoid), chaotic neutral" */
export function monsterSubtitle(m: Record<string, unknown>): string {
  return `${sizeText(m.size)} ${cap(typeText(m.type))}${m.alignment ? `, ${alignmentText(m.alignment)}` : ""}`.trim();
}
