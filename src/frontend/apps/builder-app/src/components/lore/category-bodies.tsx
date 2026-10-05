/** What each of the other categories shows above and around its text. */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { alignmentText } from "@/lib/lore/monster-text";
import { prerequisiteText } from "@/lib/lore/prereq";
import type { LoreEntry } from "@/lib/lore/types";
import { Entries, Entry, Picture, RichText } from "./render";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ABILITY: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

function Facts({ facts }: { facts: [string, ReactNode][] }) {
  const shown = facts.filter(([, v]) => v !== "" && v != null);
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1.5 rounded-md border bg-muted/30 p-3 text-sm @lg:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd>{typeof value === "string" ? <RichText text={value} /> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

const Text = ({ entries }: { entries: unknown }) => (
  <div className="text-[0.95rem]">
    <Entries entries={entries} depth={2} />
  </div>
);

function abilityText(ability: unknown): string {
  return asArray(ability)
    .map((a) => {
      if (!isObj(a)) return "";
      const fixed = Object.entries(a)
        .filter(([k]) => ABILITY[k])
        .map(([k, n]) => `${ABILITY[k]} ${Number(n) >= 0 ? "+" : ""}${String(n)}`);
      const choose = isObj(a.choose) ? `choose ${String(a.choose.count ?? 1)} from ${asArray(a.choose.from).map((x) => ABILITY[String(x)] ?? x).join(", ")}${a.choose.amount ? ` (+${String(a.choose.amount)})` : ""}` : "";
      return [...fixed, choose].filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join("; or ");
}

function speedOf(speed: unknown): string {
  if (typeof speed === "number") return `${speed} ft.`;
  if (!isObj(speed)) return "";
  return Object.entries(speed)
    .map(([k, v]) => `${k === "walk" ? "" : `${cap(k)} `}${typeof v === "number" ? `${v} ft.` : v === true ? "equal to walking speed" : isObj(v) ? `${String(v.number)} ft.` : ""}`)
    .join(", ");
}

function proficiencyList(list: unknown): string {
  return asArray(list)
    .map((p) => (typeof p === "string" ? p : isObj(p) ? (isObj(p.choose) ? `choose ${String(p.choose.count ?? 1)} from ${asArray(p.choose.from).join(", ")}` : String(p.proficiency ?? p.full ?? "")) : ""))
    .filter(Boolean)
    .join(", ");
}

function levelFeatures(features: Obj[], level: number): string {
  return features
    .filter((f) => f.level === level)
    .map((f) => String(f.name))
    .join(", ");
}

const PB = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

function ClassTable({ entry, features }: { entry: LoreEntry; features: Obj[] }) {
  const groups = asArray(entry.classTableGroups) as Obj[];
  const cols: { label: string; cells: unknown[] }[] = [];
  for (const g of groups) {
    const rows = (g.rows ?? g.rowsSpellProgression) as unknown[][] | undefined;
    asArray(g.colLabels).forEach((label, i) => cols.push({ label: String(label), cells: (rows ?? []).map((r) => r?.[i]) }));
  }
  const cell = (c: unknown): ReactNode => (isObj(c) ? (c.type === "bonus" ? `+${String(c.value)}` : c.type === "dice" ? asArray(c.toRoll).map((d) => `${String((d as Obj).number)}d${String((d as Obj).faces)}`).join("+") : c.value != null ? String(c.value) : "—") : c == null || c === 0 ? "—" : <RichText text={String(c)} />);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-2 py-1 text-left">Level</th>
            <th className="px-2 py-1">PB</th>
            <th className="px-2 py-1 text-left">Features</th>
            {cols.map((c, i) => (
              <th key={i} className="px-2 py-1">
                <RichText text={c.label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PB.map((pb, i) => (
            <tr key={i} className="even:bg-muted/30">
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1 text-center">+{pb}</td>
              <td className="px-2 py-1">{levelFeatures(features, i + 1)}</td>
              {cols.map((c, j) => (
                <td key={j} className="px-2 py-1 text-center">
                  {cell(c.cells[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Features({ features }: { features: Obj[] }) {
  return (
    <div className="space-y-1 text-[0.95rem]">
      {features.map((f, i) => (
        <section key={i} id={`f-${String(f.level)}-${String(f.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="scroll-mt-20">
          <h3 className="mt-4 font-heading text-lg tracking-wide">
            <span className="text-muted-foreground">Level {String(f.level)}: </span>
            {String(f.name)}
          </h3>
          <Entries entries={f.entries} depth={2} />
        </section>
      ))}
    </div>
  );
}

function ClassBody({ entry }: { entry: LoreEntry }) {
  const features = (entry._features as Obj[] | undefined) ?? [];
  const parent = entry._class as Obj | undefined;
  if (parent) {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          A <RichText text={`{@class ${String(parent.name)}|${String(parent.source)}}`} /> subclass.
        </p>
        <Features features={features} />
      </>
    );
  }
  const sp = (entry.startingProficiencies ?? {}) as Obj;
  const hd = entry.hd as Obj | undefined;
  const subs = (entry._subclasses as Obj[] | undefined) ?? [];
  const equipment = entry.startingEquipment as Obj | undefined;
  return (
    <>
      <Facts
        facts={[
          ["Hit die", hd ? `d${String(hd.faces)}` : ""],
          ["Primary ability", asArray(entry.primaryAbility).map((a) => Object.keys(a as Obj).map((k) => ABILITY[k] ?? k).join(" and ")).join(" or ")],
          ["Saving throws", asArray(entry.proficiency).map((a) => ABILITY[String(a)] ?? a).join(", ")],
          ["Armor", proficiencyList(sp.armor)],
          ["Weapons", proficiencyList(sp.weapons)],
          ["Tools", proficiencyList(sp.tools)],
          ["Skills", asArray(sp.skills).map((s) => (isObj(s) && isObj(s.choose) ? `choose ${String(s.choose.count ?? 2)} from ${asArray(s.choose.from).map((x) => cap(String(x))).join(", ")}` : isObj(s) && s.any ? `any ${String(s.any)}` : "")).join("; ")],
        ]}
      />
      {equipment && (
        <div className="text-sm">
          <p className="font-semibold">Starting equipment</p>
          <Entries entries={asArray(equipment.default ?? equipment.entries).map((e) => (typeof e === "string" ? e : e))} depth={3} />
        </div>
      )}
      <ClassTable entry={entry} features={features} />
      {subs.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-heading text-lg tracking-wide">{String(entry.subclassTitle ?? "Subclasses")}</h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {subs.map((s) => (
              <li key={String(s.key)}>
                <Link to={`/lore/classes/${String(s.key)}`} className="text-primary underline-offset-2 hover:underline">
                  {String(s.name)}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">({String(s.source)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Features features={features} />
    </>
  );
}

function Cards({ cards }: { cards: Obj[] }) {
  return (
    <div className="grid gap-3 @lg:grid-cols-2">
      {cards.map((c, i) => (
        <article key={i} className="space-y-1 rounded-md border p-3">
          <h4 className="font-heading">{String(c.name)}</h4>
          {isObj(c.face) && <Picture image={c.face} small />}
          <Entries entries={c.entries} depth={3} />
        </article>
      ))}
    </div>
  );
}

/** The body of an entry in a category without its own block, or null to show just its text. */
export function OtherBody({ category, entry }: { category: string; entry: LoreEntry }) {
  const prereq = prerequisiteText(entry.prerequisite);
  const prereqLine = prereq ? (
    <p className="text-sm">
      <span className="font-semibold">Prerequisite: </span>
      <RichText text={prereq} />
    </p>
  ) : null;
  switch (category) {
    case "classes":
      return <ClassBody entry={entry} />;
    case "species":
      return (
        <>
          <Facts
            facts={[
              ["Ability scores", abilityText(entry.ability)],
              ["Size", asArray(entry.size).map((s) => ({ T: "Tiny", S: "Small", M: "Medium", L: "Large" } as Record<string, string>)[String(s)] ?? s).join(" or ")],
              ["Speed", speedOf(entry.speed)],
              ["Creature type", asArray(entry.creatureTypes).map((t) => cap(String(t))).join(", ")],
              ["Darkvision", entry.darkvision ? `${String(entry.darkvision)} ft.` : ""],
            ]}
          />
          {entry._race ? (
            <p className="text-sm text-muted-foreground">
              A subrace of <RichText text={`{@race ${String((entry._race as Obj).name)}|${String((entry._race as Obj).source)}}`} />.
            </p>
          ) : null}
          <Text entries={entry.entries} />
        </>
      );
    case "feats":
    case "optionalfeatures":
    case "backgrounds":
    case "charoptions":
      return (
        <>
          {prereqLine}
          {category === "feats" && Boolean(entry.ability) && (
            <p className="text-sm">
              <span className="font-semibold">Ability score increase: </span>
              {abilityText(entry.ability)}
            </p>
          )}
          <Text entries={entry.entries} />
        </>
      );
    case "deities":
      return (
        <>
          <Facts
            facts={[
              ["Pantheon", String(entry.pantheon ?? "")],
              ["Alignment", alignmentText(entry.alignment)],
              ["Domains", asArray(entry.domains).join(", ")],
              ["Province", String(entry.province ?? "")],
              ["Symbol", String(entry.symbol ?? "")],
              ["Title", String(entry.title ?? "")],
            ]}
          />
          {isObj(entry.symbolImg) && <Picture image={entry.symbolImg} small />}
          <Text entries={entry.entries} />
        </>
      );
    case "languages":
      return (
        <>
          <Facts facts={[["Type", cap(String(entry.type ?? ""))], ["Typical speakers", asArray(entry.typicalSpeakers).join(", ")], ["Script", String(entry.script ?? "")]]} />
          <Text entries={entry.entries} />
        </>
      );
    case "tables":
      return <Entry entry={{ ...entry, type: entry.tables ? "tableGroup" : "table", caption: undefined }} depth={3} />;
    case "decks":
      return (
        <>
          <Text entries={entry.entries} />
          <Cards cards={(entry._cards as Obj[] | undefined) ?? []} />
        </>
      );
    case "actions":
      return (
        <>
          {Boolean(entry.time) && <p className="text-sm italic text-muted-foreground">{asArray(entry.time).map((t) => (isObj(t) ? `${String(t.number)} ${String(t.unit)}` : String(t))).join(" or ")}</p>}
          <Text entries={entry.entries} />
        </>
      );
    case "bastions":
      return (
        <>
          {prereqLine}
          <Facts
            facts={[
              ["Level", entry.level != null ? String(entry.level) : ""],
              ["Space", asArray(entry.space).join(", ")],
              ["Hirelings", asArray(entry.hirelings).map((h) => (isObj(h) ? String(h.exact ?? h.min ?? "") : String(h))).join(", ")],
              ["Orders", asArray(entry.orders).join(", ")],
            ]}
          />
          <Text entries={entry.entries} />
        </>
      );
    default:
      return (
        <>
          {prereqLine}
          <Text entries={entry.entries ?? entry.entriesTemplate} />
          {Boolean(entry.actionEntries) && <Text entries={entry.actionEntries} />}
        </>
      );
  }
}
