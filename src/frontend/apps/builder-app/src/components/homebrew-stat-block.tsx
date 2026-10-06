/** A homebrew monster's stat block, laid out like the books'. */
import { RichText } from "@/components/rich-text";
import { ABILITY_KEYS, signedMod, type HomebrewMonster } from "@/lib/rules/homebrew";

const SECTIONS: [keyof HomebrewMonster, string][] = [
  ["traits", "Traits"],
  ["actions", "Actions"],
  ["bonusActions", "Bonus actions"],
  ["reactions", "Reactions"],
  ["legendary", "Legendary actions"],
];

export function HomebrewStatBlock({ monster: m }: { monster: HomebrewMonster }) {
  const lines: [string, string | undefined][] = [
    ["Saves", m.saves],
    ["Skills", m.skills],
    ["Defenses", m.defenses],
    ["Senses", m.senses],
    ["Languages", m.languages],
  ];
  return (
    <div className="space-y-2 text-sm">
      <div>
        <div className="font-heading text-lg">{m.name}</div>
        <div className="italic text-muted-foreground">
          {m.kind} · CR {m.cr}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <strong>AC</strong> {m.ac}
          {m.acNote ? ` (${m.acNote})` : ""}
        </span>
        <span>
          <strong>HP</strong> {m.hp}
          {m.hpFormula ? ` (${m.hpFormula})` : ""}
        </span>
        <span>
          <strong>Speed</strong> {m.speed}
        </span>
      </div>
      <div className="grid grid-cols-6 overflow-hidden rounded-md border text-center text-xs">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="border-r last:border-r-0">
            <div className="bg-muted/50 py-0.5 font-semibold uppercase">{k}</div>
            <div className="py-1">
              {m.abilities[k]} ({signedMod(m.abilities[k])})
            </div>
          </div>
        ))}
      </div>
      {lines
        .filter(([, v]) => v?.trim())
        .map(([label, v]) => (
          <div key={label}>
            <strong>{label}</strong> {v}
          </div>
        ))}
      {SECTIONS.filter(([key]) => (m[key] as string | undefined)?.trim()).map(([key, label]) => (
        <section key={key}>
          <h4 className="mb-1 border-b pb-0.5 text-xs font-semibold uppercase tracking-wider">{label}</h4>
          <RichText text={m[key] as string} />
        </section>
      ))}
      {m.notes?.trim() && <RichText text={m.notes} className="text-muted-foreground" />}
    </div>
  );
}
