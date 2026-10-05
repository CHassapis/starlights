/** An item: its type and rarity, its numbers (damage, armor class, properties, mastery, weight, cost), its text. */
import { Fragment } from "react";
import { valueText } from "@/lib/lore/item-text";
import type { LoreEntry } from "@/lib/lore/types";
import { Entries, RichText } from "./render";

type Obj = Record<string, unknown>;
const DMG: Record<string, string> = { A: "acid", B: "bludgeoning", C: "cold", F: "fire", O: "force", L: "lightning", N: "necrotic", P: "piercing", I: "poison", Y: "psychic", R: "radiant", S: "slashing", T: "thunder" };

export function ItemBlock({ entry }: { entry: LoreEntry }) {
  const stats: [string, string][] = [];
  if (entry.dmg1) stats.push(["Damage", `${String(entry.dmg1)} ${DMG[String(entry.dmgType)] ?? ""}${entry.dmg2 ? ` (versatile ${String(entry.dmg2)})` : ""}`]);
  if (entry.range) stats.push(["Range", `${String(entry.range)} ft.`]);
  if (entry.ac !== undefined) stats.push(["Armor class", `${String(entry.ac)}${entry.type && String(entry.type).startsWith("LA") ? " + Dex" : entry.type && String(entry.type).startsWith("MA") ? " + Dex (max 2)" : ""}${entry.bonusAc ? ` (${String(entry.bonusAc)})` : ""}`]);
  if (entry.strength) stats.push(["Strength", String(entry.strength)]);
  if (entry.stealth) stats.push(["Stealth", "Disadvantage"]);
  if (entry.bonusWeapon) stats.push(["Bonus", `${String(entry.bonusWeapon)} to attack and damage`]);
  if (Array.isArray(entry._props) && entry._props.length) stats.push(["Properties", (entry._props as string[]).join(", ")]);
  if (entry.weight) stats.push(["Weight", `${String(entry.weight)} lb.`]);
  const value = valueText(entry.value);
  if (value) stats.push(["Cost", value]);
  const mastery = (entry._mastery as { name: string; entries: unknown[] }[] | undefined) ?? [];
  const base = entry._baseItem as Obj | undefined;
  const generic = entry._genericVariant as Obj | undefined;
  return (
    <>
      {stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 @2xl:grid-cols-3">
          {stats.map(([label, text]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="text-sm">{text}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="text-[0.95rem]">
        <Entries entries={entry.entries} depth={3} />
        {Boolean(entry.additionalEntries) && <Entries entries={entry.additionalEntries} depth={3} />}
      </div>
      {mastery.length > 0 && (
        <div className="space-y-1 rounded-md border px-3 py-2 text-sm">
          {mastery.map((m) => (
            <Fragment key={m.name}>
              <p className="font-semibold">Mastery: {m.name}</p>
              <Entries entries={m.entries} depth={3} />
            </Fragment>
          ))}
        </div>
      )}
      {(base || generic) && (
        <p className="text-sm text-muted-foreground">
          {generic && (
            <>
              A form of <RichText text={`{@item ${String(generic.name)}|${String(generic.source)}}`} />
            </>
          )}
          {base && (
            <>
              {generic ? ", made from " : "Made from "}
              <RichText text={`{@item ${String(base.name)}|${String(base.source)}}`} />
            </>
          )}
          .
        </p>
      )}
    </>
  );
}
