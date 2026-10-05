/**
 * A creature's stat block in the app's own style, laid out as its book prints it: 2014 books (Challenge, saving
 * throws and skills as lines, damage and condition immunities apart) or 2024 books (initiative, an ability table
 * with modifiers and saves, Immunities together, CR with XP and proficiency bonus). Lair actions and regional
 * effects (the creature's legendary group) come after its actions.
 */
import { Fragment, type ReactNode } from "react";
import { ABILITY_NAMES } from "@/lib/lore/tags";
import {
  abilityModifier,
  acText,
  conditionListText,
  crText,
  damageListText,
  hpText,
  initiativeBonus,
  signed,
  speedText,
} from "@/lib/lore/monster-text";
import type { LoreEntry, LoreMeta } from "@/lib/lore/types";
import { cn } from "@/lib/utils";
import { Entries, Entry, RichText } from "./render";

type Obj = Record<string, unknown>;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="leading-snug">
      <span className="font-semibold">{label}</span> {children}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="border-b border-primary/30 pb-0.5 font-heading text-base tracking-wide text-primary">{title}</h4>
      {children}
    </section>
  );
}

/** Traits/actions: each a run-in name with its text. */
function Features({ list }: { list: unknown }) {
  return (
    <>
      {asArray(list).map((f, i) => (
        <Entry key={i} entry={typeof f === "object" && f && !(f as Obj).type ? { ...(f as Obj), type: "entries" } : f} depth={3} />
      ))}
    </>
  );
}

function skillsText(skill: unknown): string {
  if (!skill || typeof skill !== "object") return "";
  return Object.entries(skill as Obj)
    .filter(([k]) => k !== "other")
    .map(([k, v]) => `${k.replace(/\b\w/g, (c) => c.toUpperCase())} ${String(v)}`)
    .join(", ");
}

function savesText(save: unknown): string {
  if (!save || typeof save !== "object") return "";
  return Object.entries(save as Obj)
    .map(([k, v]) => `${cap(k)} ${String(v)}`)
    .join(", ");
}

function legendaryIntro(m: LoreEntry, modern: boolean, short: string): string {
  const uses = typeof m.legendaryActions === "number" ? m.legendaryActions : 3;
  if (modern) {
    const lair = typeof m.legendaryActionsLair === "number" ? ` (${m.legendaryActionsLair} in Lair)` : "";
    return `Legendary Action Uses: ${uses}${lair}. Immediately after another creature's turn, ${short} can expend a use to take one of the following actions. ${cap(short)} regains all expended uses at the start of each of its turns.`;
  }
  return `${cap(short)} can take ${uses} legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. ${cap(short)} regains spent legendary actions at the start of its turn.`;
}

function shortNameOf(m: LoreEntry): string {
  if (m.isNamedCreature) return String(m.name).split(/[ ,]/)[0];
  if (typeof m.shortName === "string") return `the ${m.shortName.toLowerCase()}`;
  return `the ${String(m.name).split(",")[0].toLowerCase()}`;
}

export function StatBlock({ meta, m }: { meta: LoreMeta; m: LoreEntry }) {
  const modern = meta.sources[m.source]?.edition === "2024";
  const short = shortNameOf(m);
  const spellcasting = asArray(m.spellcasting) as Obj[];
  const castingAs = (where: string) => spellcasting.filter((s) => (s.displayAs ?? "trait") === where);
  const group = m._legendaryGroup as Obj | undefined;
  const score = (a: string) => Number(m[a] ?? 10);
  const saves = (m.save ?? {}) as Obj;
  const gear = asArray(m.gear).map((g) => (typeof g === "string" ? `{@item ${g}}` : typeof g === "object" && g ? `${(g as Obj).quantity ?? ""} {@item ${(g as Obj).item}}`.trim() : ""));
  const immunities = modern ? [damageListText(m.immune, "immune"), conditionListText(m.conditionImmune)].filter(Boolean).join("; ") : "";

  return (
    <div className="@container space-y-3 rounded-lg border border-t-4 border-t-primary/60 bg-card/60 p-3 text-sm sm:p-4">
      <div className="grid gap-x-4 gap-y-0.5 @md:grid-cols-[auto_1fr]">
        <Line label="AC">
          <RichText text={acText(m.ac)} />
        </Line>
        {modern && <Line label="Initiative">{signed(initiativeBonus(m))} ({10 + initiativeBonus(m)})</Line>}
        <Line label="HP">{hpText(m.hp)}</Line>
        <Line label="Speed">
          <RichText text={speedText(m.speed)} />
        </Line>
      </div>

      {modern ? (
        <div className="grid grid-cols-3 gap-1 text-center text-xs @lg:grid-cols-6">
          {ABILITIES.map((a) => (
            <div key={a} className="rounded-md bg-muted/60 px-1 py-1">
              <div className="font-semibold uppercase">{a}</div>
              <div className="text-sm">{score(a)}</div>
              <div className="text-muted-foreground">
                mod {signed(abilityModifier(score(a)))} · save {String(saves[a] ?? signed(abilityModifier(score(a)))).replace("-", "−")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-1 text-center text-xs">
          {ABILITIES.map((a) => (
            <div key={a} className="rounded-md bg-muted/60 px-0.5 py-1" title={ABILITY_NAMES[a]}>
              <div className="font-semibold uppercase">{a}</div>
              <div>
                {score(a)} ({signed(abilityModifier(score(a)))})
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-0.5">
        {!modern && m.save ? <Line label="Saving Throws">{savesText(m.save)}</Line> : null}
        {m.skill ? <Line label="Skills"><RichText text={skillsText(m.skill)} /></Line> : null}
        {m.vulnerable ? <Line label={modern ? "Vulnerabilities" : "Damage Vulnerabilities"}><RichText text={damageListText(m.vulnerable, "vulnerable")} /></Line> : null}
        {m.resist ? <Line label={modern ? "Resistances" : "Damage Resistances"}><RichText text={damageListText(m.resist, "resist")} /></Line> : null}
        {modern ? (
          immunities ? <Line label="Immunities"><RichText text={immunities} /></Line> : null
        ) : (
          <>
            {m.immune ? <Line label="Damage Immunities"><RichText text={damageListText(m.immune, "immune")} /></Line> : null}
            {m.conditionImmune ? <Line label="Condition Immunities"><RichText text={conditionListText(m.conditionImmune)} /></Line> : null}
          </>
        )}
        {modern && gear.length > 0 && (
          <Line label="Gear">
            {gear.map((g, i) => (
              <Fragment key={i}>
                {i > 0 && ", "}
                <RichText text={g} />
              </Fragment>
            ))}
          </Line>
        )}
        <Line label="Senses">
          <RichText text={[...asArray(m.senses).map(String), `${modern ? "Passive Perception" : "passive Perception"} ${String(m.passive ?? 10)}`].join(modern ? "; " : ", ")} />
        </Line>
        <Line label="Languages">
          <RichText text={asArray(m.languages).map(String).join(", ") || "—"} />
        </Line>
        <Line label={modern ? "CR" : "Challenge"}>{crText(m.cr, modern)}</Line>
      </div>

      {(m.trait || castingAs("trait").length > 0) && (
        <Section title="Traits">
          <Features list={[...asArray(m.trait), ...castingAs("trait")]} />
        </Section>
      )}
      {(m.action || castingAs("action").length > 0) && (
        <Section title="Actions">
          {Boolean(m.actionHeader) && <Entries entries={m.actionHeader} depth={3} />}
          <Features list={[...asArray(m.action), ...castingAs("action")]} />
        </Section>
      )}
      {(m.bonus || castingAs("bonus").length > 0) && (
        <Section title="Bonus Actions">
          <Features list={[...asArray(m.bonus), ...castingAs("bonus")]} />
        </Section>
      )}
      {(m.reaction || castingAs("reaction").length > 0) && (
        <Section title="Reactions">
          {Boolean(m.reactionHeader) && <Entries entries={m.reactionHeader} depth={3} />}
          <Features list={[...asArray(m.reaction), ...castingAs("reaction")]} />
        </Section>
      )}
      {(m.legendary || castingAs("legendary").length > 0) && (
        <Section title="Legendary Actions">
          {m.legendaryHeader ? <Entries entries={m.legendaryHeader} depth={3} /> : <p className="my-1"><RichText text={legendaryIntro(m, modern, short)} /></p>}
          <Features list={[...asArray(m.legendary), ...castingAs("legendary")]} />
        </Section>
      )}
      {Boolean(m.mythic) && (
        <Section title="Mythic Actions">
          {Boolean(m.mythicHeader) && <Entries entries={m.mythicHeader} depth={3} />}
          <Features list={m.mythic} />
        </Section>
      )}
      {group && (group.lairActions || group.regionalEffects || group.mythicEncounter) ? (
        <>
          {Boolean(group.lairActions) && (
            <Section title="Lair Actions">
              <Entries entries={group.lairActions} depth={3} />
            </Section>
          )}
          {Boolean(group.regionalEffects) && (
            <Section title="Regional Effects">
              <Entries entries={group.regionalEffects} depth={3} />
            </Section>
          )}
          {Boolean(group.mythicEncounter) && (
            <Section title="Mythic Encounter">
              <Entries entries={group.mythicEncounter} depth={3} />
            </Section>
          )}
        </>
      ) : null}
      {Boolean(m.variant) && (
        <div className={cn("space-y-2")}>
          <Entries entries={(asArray(m.variant) as Obj[]).map((v) => ({ ...v, type: v.type ?? "variant" }))} depth={3} />
        </div>
      )}
    </div>
  );
}
