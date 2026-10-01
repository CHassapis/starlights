/**
 * A spell's level, school, casting time, range, components and duration as words, from the 5etools fields.
 * Used for the spell list (by the ingest script) and the spell block (by the app).
 */

export const SCHOOLS: Record<string, string> = {
  A: "Abjuration",
  C: "Conjuration",
  D: "Divination",
  E: "Enchantment",
  V: "Evocation",
  I: "Illusion",
  N: "Necromancy",
  T: "Transmutation",
  P: "Psionic",
};

export function levelText(level: number): string {
  if (level === 0) return "Cantrip";
  const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
  return `${level}${suffix} level`;
}

/** "Level 3 Evocation", "Evocation Cantrip" (2024 wording, which reads well for both editions). */
export function levelSchoolText(level: number, school: string): string {
  const name = SCHOOLS[school] ?? school;
  return level === 0 ? `${name} Cantrip` : `Level ${level} ${name}`;
}

interface Time {
  number?: number;
  unit?: string;
  condition?: string;
}

const UNIT_NAMES: Record<string, [string, string]> = {
  action: ["action", "actions"],
  bonus: ["bonus action", "bonus actions"],
  reaction: ["reaction", "reactions"],
  round: ["round", "rounds"],
  minute: ["minute", "minutes"],
  hour: ["hour", "hours"],
  day: ["day", "days"],
};

export function timeText(times: unknown, withCondition = false): string {
  if (!Array.isArray(times) || times.length === 0) return "";
  return (times as Time[])
    .map((t) => {
      const n = t.number ?? 1;
      const [one, many] = UNIT_NAMES[t.unit ?? ""] ?? [t.unit ?? "", t.unit ?? ""];
      return `${n} ${n === 1 ? one : many}${withCondition && t.condition ? `, ${t.condition}` : ""}`;
    })
    .join(" or ");
}

export function timeUnit(times: unknown): string {
  return Array.isArray(times) && times.length ? ((times[0] as Time).unit ?? "") : "";
}

interface Distance {
  type?: string;
  amount?: number;
}
interface Range {
  type?: string;
  distance?: Distance;
}

function distanceText(d: Distance | undefined): string {
  if (!d?.type) return "";
  switch (d.type) {
    case "self":
      return "Self";
    case "touch":
      return "Touch";
    case "sight":
      return "Sight";
    case "unlimited":
      return "Unlimited";
    case "plane":
      return "Unlimited on the same plane";
    case "feet":
      return `${d.amount} ${d.amount === 1 ? "foot" : "feet"}`;
    case "miles":
      return `${d.amount} ${d.amount === 1 ? "mile" : "miles"}`;
    default:
      return d.amount != null ? `${d.amount} ${d.type}` : d.type;
  }
}

const AREA_SHAPES = new Set(["radius", "sphere", "cone", "line", "cube", "cylinder", "hemisphere", "emanation"]);

export function rangeText(range: unknown): string {
  const r = range as Range | undefined;
  if (!r?.type) return "";
  if (r.type === "special") return "Special";
  if (AREA_SHAPES.has(r.type)) {
    const size = r.distance?.amount != null ? `${r.distance.amount}-${r.distance.type === "miles" ? "mile" : "foot"} ${r.type}` : r.type;
    return `Self (${size})`;
  }
  return distanceText(r.distance);
}

interface Components {
  v?: boolean;
  s?: boolean;
  m?: boolean | string | { text?: string };
  r?: boolean;
}

/** "V, S, M"; with details, the material in brackets: "V, S, M (a ball of bat guano and sulfur)". */
export function componentsText(components: unknown, details = false): string {
  const c = components as Components | undefined;
  if (!c) return "";
  const parts: string[] = [];
  if (c.v) parts.push("V");
  if (c.s) parts.push("S");
  if (c.m) {
    const text = typeof c.m === "string" ? c.m : typeof c.m === "object" ? c.m.text : undefined;
    parts.push(details && text ? `M (${text})` : "M");
  }
  if (c.r) parts.push("R");
  return parts.join(", ");
}

interface Duration {
  type?: string;
  duration?: { type?: string; amount?: number; upTo?: boolean };
  concentration?: boolean;
  ends?: string[];
}

export function durationText(durations: unknown): string {
  if (!Array.isArray(durations) || durations.length === 0) return "";
  return (durations as Duration[])
    .map((d) => {
      switch (d.type) {
        case "instant":
          return "Instantaneous";
        case "special":
          return "Special";
        case "permanent": {
          const ends = (d.ends ?? []).map((e) => (e === "dispel" ? "dispelled" : e === "trigger" ? "triggered" : e === "discharge" ? "discharged" : e));
          return ends.length ? `Until ${ends.join(" or ")}` : "Permanent";
        }
        case "timed": {
          const t = d.duration;
          const amount = t?.amount ?? 1;
          const unit = t?.type ?? "";
          const time = `${amount} ${amount === 1 ? unit : `${unit}s`}`;
          if (d.concentration) return `Concentration, up to ${time}`;
          return t?.upTo ? `Up to ${time}` : time;
        }
        default:
          return d.type ?? "";
      }
    })
    .join(" or ");
}

export function isConcentration(durations: unknown): boolean {
  return Array.isArray(durations) && (durations as Duration[]).some((d) => d.concentration);
}
