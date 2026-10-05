/** Prerequisites (feats, class options, backgrounds) as one line of text with {@tags}. */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ABILITY: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ref(tag: string, uid: string): string {
  const [name, source, display] = uid.split("|");
  return `{@${tag} ${cap(name)}${source ? `|${source}` : ""}${display ? `|${display}` : ""}}`;
}

function one(p: Obj): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case "level":
        parts.push(isObj(v) ? `Level ${v.level}${isObj(v.class) ? ` ${String(v.class.name)}` : ""}` : `Level ${String(v)}`);
        break;
      case "ability":
        parts.push((v as Obj[]).map((a) => Object.entries(a).map(([ab, n]) => `${ABILITY[ab] ?? ab} ${String(n)}+`).join(" or ")).join(" or "));
        break;
      case "race":
        parts.push((v as Obj[]).map((r) => (r.displayEntry ? String(r.displayEntry) : `${cap(String(r.name))}${r.subrace ? ` (${String(r.subrace)})` : ""}`)).join(" or "));
        break;
      case "feat":
        parts.push((v as string[]).map((f) => ref("feat", f)).join(" or "));
        break;
      case "optionalfeature":
        parts.push((v as string[]).map((f) => ref("optfeature", f)).join(" or "));
        break;
      case "spell":
        parts.push((v as string[]).map((f) => ref("spell", f.replace(/#c$/, ""))).join(" or "));
        break;
      case "item":
        parts.push((v as string[]).map((f) => ref("item", f)).join(" or "));
        break;
      case "background":
        parts.push((v as Obj[]).map((b) => String(b.displayEntry ?? b.name)).join(" or "));
        break;
      case "spellcasting":
      case "spellcasting2020":
        parts.push("The ability to cast at least one spell");
        break;
      case "spellcastingFeature":
        parts.push("Spellcasting or Pact Magic feature");
        break;
      case "pact":
        parts.push(`Pact of the ${String(v)}`);
        break;
      case "patron":
        parts.push(`${String(v)} patron`);
        break;
      case "proficiency":
        parts.push((v as Obj[]).map((pr) => Object.entries(pr).map(([kind, what]) => `Proficiency with ${String(what)} ${kind === "weapon" ? "weapons" : kind}`).join(", ")).join(" or "));
        break;
      case "feature":
        parts.push((v as string[]).join(" or ") + " feature");
        break;
      case "campaign":
        parts.push(`${(v as string[]).join(" or ")} campaign`);
        break;
      case "other":
        parts.push(String(v));
        break;
      case "otherSummary":
        parts.push(String((v as Obj).entry ?? ""));
        break;
      default:
        break;
    }
  }
  return parts.filter(Boolean).join(", ");
}

export function prerequisiteText(prerequisite: unknown): string {
  if (!Array.isArray(prerequisite)) return "";
  return (prerequisite as Obj[]).map(one).filter(Boolean).join("; or ");
}
