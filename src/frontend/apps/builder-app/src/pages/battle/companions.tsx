/**
 * The simulator's familiars and companions: a familiar from Find Familiar (the shapes the character's edition and
 * Pact of the Chain allow), a ranger's beast, an artificer's steel defender, a steed or a summon, or any creature
 * from the Compendium of Lore's bestiary. Each keeps its own hit points with the character's fight state, and shows
 * its stat block from the compendium.
 */
import { CatIcon, PawPrintIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { CompendiumPicker } from "@/components/lore/compendium-picker";
import { EntryPreview } from "@/components/lore/entry-view";
import { LoreLink } from "@/components/lore/lore-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLoreEntry, useLoreMeta } from "@/lib/lore/data";
import { useLoreLookup } from "@/lib/lore/lookup";
import { familiarForms, hurtCompanion, type Companion, type CombatState } from "@/lib/rules/battle";
import { cn } from "@/lib/utils";

/** Companions some features and spells bring, by the name the bestiary gives them. */
const COMPANION_SOURCES: [RegExp, string[]][] = [
  [/^Steel Defender$|Battle Smith/i, ["Steel Defender"]],
  [/Homunculus Servant/i, ["Homunculus Servant"]],
  [/Drake Companion|Drakewarden/i, ["Drake Companion"]],
  [/Primal Companion|Beast Master/i, ["Beast of the Land", "Beast of the Sea", "Beast of the Sky"]],
  [/Wildfire Spirit|Circle of Wildfire/i, ["Wildfire Spirit"]],
  [/Eldritch Cannon/i, ["Eldritch Cannon"]],
  [/Faithful Steed/i, ["Otherworldly Steed"]],
];

const SPELL_COMPANIONS: Record<string, string[]> = {
  "Find Steed": ["Otherworldly Steed", "Warhorse", "Pony", "Mastiff"],
  "Summon Beast": ["Bestial Spirit"],
  "Summon Fey": ["Fey Spirit"],
  "Summon Undead": ["Undead Spirit"],
  "Summon Elemental": ["Elemental Spirit"],
  "Summon Celestial": ["Celestial Spirit"],
  "Summon Fiend": ["Fiendish Spirit"],
  "Summon Construct": ["Construct Spirit"],
  "Summon Aberration": ["Aberrant Spirit"],
  "Summon Shadowspawn": ["Shadow Spirit"],
  "Summon Draconic Spirit": ["Draconic Spirit"],
  "Animate Dead": ["Skeleton", "Zombie"],
};

export function Companions({
  edition,
  state,
  featureTitles,
  spellNames,
  update,
}: {
  edition: "2014" | "2024";
  state: CombatState;
  featureTitles: string[];
  spellNames: string[];
  update: (change: (c: CombatState) => CombatState) => void;
}) {
  const lookup = useLoreLookup();
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState("");
  const companions = state.companions ?? [];
  const hasFamiliar = spellNames.includes("Find Familiar") || featureTitles.some((t) => /Pact of the Chain|Familiar/i.test(t));
  const chain = featureTitles.some((t) => /Pact of the Chain/i.test(t));
  const suggested = [
    ...COMPANION_SOURCES.filter(([re]) => featureTitles.some((t) => re.test(t))).flatMap(([, names]) => names),
    ...Object.entries(SPELL_COMPANIONS).filter(([spell]) => spellNames.includes(spell)).flatMap(([, names]) => names),
  ];

  const add = (name: string, key: string | null) =>
    update((c) => ({ ...c, companions: [...(c.companions ?? []), { id: crypto.randomUUID().slice(0, 12), name, key, maxHitPoints: 0, damage: 0, temporaryHitPoints: 0, notes: null }] }));
  const change = (id: string, fn: (c: Companion) => Companion) => update((c) => ({ ...c, companions: (c.companions ?? []).map((x) => (x.id === id ? fn(x) : x)) }));
  const remove = (id: string) => update((c) => ({ ...c, companions: (c.companions ?? []).filter((x) => x.id !== id) }));
  const quick = (name: string) => {
    const key = lookup("bestiary", name, edition);
    return (
      <button key={name} type="button" onClick={() => add(name, key)} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:border-amber-300/60 hover:bg-white/10">
        {name}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-white/10 bg-neutral-900/75 p-3 shadow-xl backdrop-blur-md sm:p-4">
        <header className="mb-2 flex items-center gap-2">
          <PawPrintIcon className="size-4 text-amber-300" />
          <h2 className="font-heading text-sm uppercase tracking-[0.2em] text-amber-200/90">Add a familiar or companion</h2>
        </header>
        {hasFamiliar && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-white/65">
              Find Familiar{chain ? " with Pact of the Chain" : ""}: {edition === "2024" ? "a Celestial, Fey or Fiend in one of these shapes (or another CR 0 beast)" : "a celestial, fey or fiend in one of these shapes"}.
            </p>
            <div className="flex flex-wrap gap-1.5">{familiarForms(edition, chain).map(quick)}</div>
          </div>
        )}
        {suggested.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-white/65">From your features and spells:</p>
            <div className="flex flex-wrap gap-1.5">{[...new Set(suggested)].map(quick)}</div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <CatIcon /> Any creature from the bestiary
          </Button>
          <span className="text-xs text-white/50">or</span>
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="A name of your own" aria-label="Companion name" className="h-8 w-48 border-white/20 bg-black/40 text-white" />
          <Button
            size="sm"
            variant="ghost"
            className="text-white/80"
            disabled={!custom.trim()}
            onClick={() => {
              add(custom.trim().slice(0, 100), null);
              setCustom("");
            }}
          >
            <PlusIcon /> Add
          </Button>
        </div>
        <CompendiumPicker open={picking} onOpenChange={setPicking} mode="creatures" onPick={(link) => add(link.name, link.key)} />
      </section>

      {companions.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-white/60">No familiar or companion in this fight yet.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {companions.map((c) => (
            <CompanionCard key={c.id} companion={c} onChange={(fn) => change(c.id, fn)} onRemove={() => remove(c.id)} />
          ))}
        </div>
      )}
      {hasFamiliar && (
        <p className="text-xs text-white/55">
          {edition === "2024"
            ? "A familiar acts on its own initiative and can't attack (with Pact of the Chain, when you take the Attack action you can give up one attack so it attacks with its Reaction). It can deliver your touch spells, and you can see and hear through it."
            : "A familiar acts independently and can't attack (with Pact of the Chain, you can give up one of your attacks so it attacks with its reaction). It can deliver your touch spells, and you can see through its eyes as an action."}
        </p>
      )}
    </div>
  );
}

function CompanionCard({ companion: c, onChange, onRemove }: { companion: Companion; onChange: (fn: (c: Companion) => Companion) => void; onRemove: () => void }) {
  const meta = useLoreMeta();
  const entry = useLoreEntry(meta.data, "bestiary", c.key);
  const [amount, setAmount] = useState("");
  // notes are saved when the box is left, not on every key
  const [notes, setNotes] = useState(c.notes ?? "");
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  // the bestiary's average hit points, the first time (some, like a steel defender's, depend on your level: type them)
  const average = (entry.data?.entry?.hp as { average?: number } | undefined)?.average;
  useEffect(() => {
    if (c.maxHitPoints === 0 && average && average > 0) onChange((x) => ({ ...x, maxHitPoints: average }));
  }, [average, c.maxHitPoints, onChange]);
  const hp = Math.max(0, c.maxHitPoints - c.damage);
  const ratio = c.maxHitPoints > 0 ? hp / c.maxHitPoints : 0;
  return (
    <article className="rounded-xl border border-white/10 bg-neutral-900/80 p-3 shadow-xl backdrop-blur-md">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-lg tracking-wide text-white">{c.key ? <LoreLink category="bestiary" k={c.key}>{c.name}</LoreLink> : c.name}</h3>
          <div className="flex items-baseline gap-1.5 text-sm text-white/80">
            <span className="font-heading text-2xl text-white">{hp}</span>
            <span>/</span>
            <Input
              inputMode="numeric"
              aria-label={`${c.name}'s hit point maximum`}
              value={c.maxHitPoints || ""}
              placeholder="max"
              onChange={(e) => onChange((x) => ({ ...x, maxHitPoints: Math.min(10_000, Number(e.target.value.replace(/\D/g, "")) || 0) }))}
              className="h-7 w-16 border-white/20 bg-black/40 px-1 text-center text-white"
            />
            <span className="text-xs text-white/50">hit points</span>
            {c.temporaryHitPoints > 0 && <span className="text-xs text-sky-200">+{c.temporaryHitPoints} temp</span>}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="size-7 text-white/60" aria-label={`Remove ${c.name}`} onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full", ratio > 0.5 ? "bg-emerald-400" : ratio > 0.25 ? "bg-amber-400" : "bg-red-500")} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input inputMode="numeric" aria-label={`Amount for ${c.name}`} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="h-8 w-20 border-white/20 bg-black/40 text-white" />
        <Button size="sm" variant="destructive" disabled={!n} onClick={() => (onChange((x) => hurtCompanion(x, n)), setAmount(""))}>
          Damage
        </Button>
        <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={!n} onClick={() => (onChange((x) => hurtCompanion(x, -n)), setAmount(""))}>
          Heal
        </Button>
        <Button size="sm" variant="secondary" disabled={!n} onClick={() => (onChange((x) => ({ ...x, temporaryHitPoints: Math.max(x.temporaryHitPoints, n) })), setAmount(""))}>
          Temp HP
        </Button>
      </div>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
        onBlur={() => notes !== (c.notes ?? "") && onChange((x) => ({ ...x, notes: notes || null }))}
        placeholder="Notes (shape, orders, conditions…)"
        aria-label={`Notes on ${c.name}`}
        className="mt-2 h-8 border-white/15 bg-black/30 text-sm text-white"
      />
      {c.key && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-white/60">Stat block</summary>
          <div className="mt-2 max-h-[28rem] overflow-y-auto rounded-lg bg-background p-3 text-foreground">
            <EntryPreview category="bestiary" k={c.key} />
          </div>
        </details>
      )}
    </article>
  );
}
