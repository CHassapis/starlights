import { AlertTriangleIcon, BookOpenIcon, CheckIcon, MoonIcon, SearchIcon, SparklesIcon, SunriseIcon, WandSparklesIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { InfoCard } from "@/components/info-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useMagic, useSaveMagic, useSpellcasting, useSpellIndex, type SpellFigures } from "@/lib/api/magic";
import { normalizeText } from "@/lib/rules/picker";
import {
  casterLevelShare,
  expended,
  isPrepared,
  levelName,
  longRest,
  nextLevelSummary,
  ordinal,
  pactSlots,
  prepareProblem,
  preparedCount,
  setPactSpent,
  setSpent,
  shortRest,
  spellSlots,
  stalePrepared,
  togglePrepared,
  usesMulticlassTable,
  type Caster,
  type KnownSpell,
  type MagicState,
} from "@/lib/rules/magic";
import { cn } from "@/lib/utils";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * The character's spellcasting, like Aurora's Magic tab: for each spellcasting class its ability, spell attack and
 * save DC, the spells it has by level and, for classes that prepare, which are prepared today (always-prepared
 * spells do not count). Spell slots are ticked off as they are spent and come back on a rest.
 */
export function MagicTab({ characterId }: { characterId: string }) {
  const { data: casting, isLoading } = useSpellcasting(characterId);
  const { data: magic } = useMagic(characterId);
  const { byId: figures } = useSpellIndex();
  const save = useSaveMagic(characterId);
  const failed = (e: Error) => toast.error("Could not save", { description: e.message });

  if (isLoading || !casting || !magic) return <Spinner className="mx-auto my-8 size-5" />;

  const casters = casting.casters;
  const slots = spellSlots(casters);
  const pact = pactSlots(casters);
  const change = (fn: (m: MagicState) => MagicState) => save.update(fn, failed);

  if (casters.length === 0 && casting.otherSpells.length === 0) {
    return (
      <div className="max-w-4xl rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No spellcasting. Spells from a class, species, feat or magic item show up here.
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      {(Object.keys(slots).length > 0 || pact) && (
        <section className="rounded-lg border">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b bg-muted/30 px-3 py-2 font-heading">
            <SparklesIcon className="size-4 text-muted-foreground" />
            Spell slots
            {usesMulticlassTable(casters) && (
              <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
                shared by your classes (multiclass caster level {Math.min(20, casters.reduce((n, c) => n + casterLevelShare(c), 0))})
              </span>
            )}
            <span className="ms-auto flex gap-2">
              {pact && (
                <Button size="sm" variant="outline" onClick={() => change(shortRest)} title="Pact magic slots come back">
                  <SunriseIcon /> Short rest
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  change(longRest);
                  toast.success("Every slot is back");
                }}
              >
                <MoonIcon /> Long rest
              </Button>
            </span>
          </h3>
          <div className="divide-y">
            {Object.entries(slots).map(([level, total]) => (
              <SlotRow
                key={level}
                label={`${ordinal(Number(level))} level`}
                total={total}
                spent={expended(magic, Number(level))}
                onSpent={(n) => change((m) => setSpent(m, Number(level), n, total))}
              />
            ))}
            {pact && (
              <SlotRow
                label={`Pact magic (${ordinal(pact.level)})`}
                note="back after a short rest"
                total={pact.count}
                spent={magic.expendedPactSlots}
                onSpent={(n) => change((m) => setPactSpent(m, n, pact.count))}
              />
            )}
          </div>
        </section>
      )}

      {casters.map((c) => (
        <CasterCard key={c.name} caster={c} magic={magic} slots={slots} figures={figures} proficiency={casting.proficiencyBonus} onChange={change} />
      ))}

      {casting.otherSpells.length > 0 && (
        <section className="rounded-lg border">
          <h3 className="flex flex-wrap items-baseline gap-x-2 border-b bg-muted/30 px-3 py-2 font-heading">
            <WandSparklesIcon className="size-4 self-center text-muted-foreground" />
            Other spells
            <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">from your species, background, feats and features: cast as they say</span>
          </h3>
          <div className="divide-y">
            {casting.otherSpells.map((s) => (
              <SpellRow key={s.registrationId} spell={s} figures={figures?.get(s.elementId)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One level's slots as boxes to tick, like on the paper sheet: ticking the third box spends three slots. */
function SlotRow({ label, note, total, spent, onSpent }: { label: string; note?: string; total: number; spent: number; onSpent: (spent: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <span className="w-24 text-sm sm:w-36">
        {label}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <span className="flex flex-wrap gap-1.5" role="group" aria-label={`${label} slots`}>
        {Array.from({ length: total }, (_, i) => {
          const isSpent = i < spent;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={isSpent}
              aria-label={`${label} slot ${i + 1} of ${total}${isSpent ? ", spent" : ""}`}
              onClick={() => onSpent(isSpent ? i : i + 1)}
              className={cn(
                "flex size-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                isSpent ? "border-muted-foreground/40 bg-muted text-muted-foreground" : "border-primary/60 bg-primary/10 hover:bg-primary/20",
              )}
            >
              {isSpent && <CheckIcon className="size-4" />}
            </button>
          );
        })}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {total - spent} of {total} left
      </span>
    </div>
  );
}

function Figure({ label, value, children, warn }: { label: string; value: ReactNode; children?: ReactNode; warn?: boolean }) {
  const body = (
    <span className={cn("inline-block rounded-md border px-2 py-1 text-left", warn && "border-destructive/60", children && "hover:bg-muted/60")}>
      <span className="block text-[11px] leading-tight text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
  if (!children) return body;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md">
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm">{children}</PopoverContent>
    </Popover>
  );
}

function Breakdown({ parts, total }: { parts: [string, number][]; total: string }) {
  return (
    <>
      {parts
        .filter(([, v], i) => i === 0 || v !== 0)
        .map(([label, v], i) => (
          <p key={label} className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{i === 0 ? v : signed(v)}</span>
          </p>
        ))}
      <p className="mt-1 flex justify-between border-t pt-1 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{total}</span>
      </p>
    </>
  );
}

interface Row {
  spell: KnownSpell;
  /** prepared by choice, or always prepared */
  prepared: boolean;
  /** a prepare toggle is offered */
  preparable: boolean;
  stale: boolean;
}

function CasterCard({
  caster: c,
  magic,
  slots,
  figures,
  proficiency,
  onChange,
}: {
  caster: Caster;
  magic: MagicState;
  slots: Record<number, number>;
  figures: Map<string, SpellFigures> | undefined;
  proficiency: number;
  onChange: (fn: (m: MagicState) => MagicState) => void;
}) {
  const { count, max } = preparedCount(c, magic);
  const stale = new Set(stalePrepared(c, magic));
  const [showAll, setShowAll] = useState(() => c.knowsWholeList && count === 0);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const stale = new Set(stalePrepared(c, magic));
    const byId = new Map<string, Row>();
    for (const s of c.spells) {
      byId.set(s.elementId, { spell: s, prepared: s.kind === "always" || isPrepared(c, magic, s.elementId), preparable: c.prepares && s.kind === "spellbook", stale: false });
    }
    // a whole-list caster: every spell it may prepare, plus prepared ones that no longer fit
    const extra = c.knowsWholeList ? [...c.preparable, ...stale] : [...stale];
    for (const id of extra) {
      if (byId.has(id)) continue;
      const f = figures?.get(id);
      const spell: KnownSpell = { registrationId: id, elementId: id, name: f?.name ?? "Unknown spell", level: f?.level ?? 0, kind: "spellbook", origin: "" };
      byId.set(id, { spell, prepared: isPrepared(c, magic, id), preparable: true, stale: stale.has(id) });
    }
    return [...byId.values()].sort((a, b) => a.spell.level - b.spell.level || a.spell.name.localeCompare(b.spell.name));
  }, [c, magic, figures]);

  const q = normalizeText(query);
  const visible = rows.filter((r) => {
    if (c.knowsWholeList && !showAll && r.preparable && !r.prepared && !r.stale) return false;
    return !q || normalizeText(r.spell.name).includes(q);
  });
  const levels = [...new Set(visible.map((r) => r.spell.level))].sort((a, b) => a - b);
  const next = nextLevelSummary(c);
  const lists = c.lists.join(", ");

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <h3 className="me-2 flex items-center gap-2 font-heading">
          <BookOpenIcon className="size-4 text-muted-foreground" />
          {c.name}
          <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">{c.className && c.className !== c.name ? `${c.className} ${c.classLevel}` : `level ${c.classLevel}`}</span>
        </h3>
        <Figure label="Ability" value={c.ability ?? "—"} />
        <Figure label="Spell attack" value={signed(c.attack)}>
          <p className="mb-2 font-medium">Spell attack bonus</p>
          <Breakdown parts={[["Proficiency bonus", proficiency], [c.ability ?? "Ability", c.abilityModifier], ["Items and features", c.attackBonus]]} total={signed(c.attack)} />
        </Figure>
        <Figure label="Save DC" value={c.dc}>
          <p className="mb-2 font-medium">Spell save DC</p>
          <Breakdown parts={[["Base", 8], ["Proficiency bonus", proficiency], [c.ability ?? "Ability", c.abilityModifier], ["Items and features", c.dcBonus]]} total={String(c.dc)} />
        </Figure>
        {c.prepares && max !== null && <Figure label="Prepared" value={`${count} / ${max}`} warn={count > max} />}
      </div>

      <div className="space-y-3 p-3">
        <p className="text-sm text-muted-foreground">
          {c.pact
            ? `Pact magic: all your slots are ${ordinal(c.pact.level)} level and come back after a short rest.`
            : c.knowsWholeList
              ? `You prepare spells from the whole ${lists} list, of a level you have slots for; change them after a long rest. Always-prepared spells don't count toward the ${max ?? ""} you prepare.`
              : c.spellbook
                ? `You prepare ${max ?? ""} spells from your spellbook after a long rest. Rituals in your spellbook can be cast as rituals without preparing them.`
                : `You know these spells and can cast any of them with a slot.${c.allowReplace ? " When you gain a level, you can swap one for another from the list." : ""}`}
        </p>
        {next.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">At {c.className ?? c.name} level {c.nextLevel!.level}: </span>
            {next.join(", ")}
          </p>
        )}
        {stale.size > 0 && (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
            <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
            {stale.size === 1 ? "A prepared spell no longer fits" : `${stale.size} prepared spells no longer fit`} (a lower level or a book switched off). Unprepare{" "}
            {stale.size === 1 ? "it" : "them"} to free the place.
          </p>
        )}
        {c.prepares && max !== null && count > max && (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
            <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" /> More spells prepared than you can: unprepare {count - max}.
          </p>
        )}

        {c.knowsWholeList && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Which spells to show">
              {[
                [false, "Ready to cast"],
                [true, `All you can prepare (${c.preparable.length})`],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={showAll === value}
                  onClick={() => setShowAll(value as boolean)}
                  className={cn("rounded px-2.5 py-1 text-sm", showAll === value ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {label as string}
                </button>
              ))}
            </div>
            {showAll && (
              <div className="relative min-w-40 flex-1">
                <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search spells…" className="h-8 pl-8" aria-label={`Search ${c.name} spells`} />
              </div>
            )}
          </div>
        )}

        {levels.length === 0 && <p className="text-sm text-muted-foreground">{q ? "No spell matches." : "No spells yet."}</p>}
        {levels.map((level) => (
          <div key={level} className="rounded-md border">
            <p className="flex items-baseline gap-2 border-b px-3 py-1.5 text-sm font-medium">
              {levelName(level)}
              {level > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {c.pact ? (level <= c.pact.level ? `cast with a ${ordinal(c.pact.level)}-level pact slot` : "no slot of this level yet") : slots[level] ? `${slots[level]} slot${slots[level] === 1 ? "" : "s"}` : "no slots of this level yet"}
                </span>
              )}
            </p>
            <div className="divide-y">
              {visible
                .filter((r) => r.spell.level === level)
                .map((r) => (
                  <SpellRow
                    key={r.spell.elementId}
                    // the class's own Spellcasting feature says nothing new on every row
                    spell={/^Spellcasting\b/.test(r.spell.origin) ? { ...r.spell, origin: "" } : r.spell}
                    figures={figures?.get(r.spell.elementId)}
                    stale={r.stale}
                    toggle={
                      r.preparable
                        ? {
                            on: r.prepared,
                            problem: r.prepared ? null : prepareProblem(c, magic, r.spell.elementId),
                            onToggle: () => onChange((m) => togglePrepared(c, m, r.spell.elementId)),
                          }
                        : undefined
                    }
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SpellRow({
  spell,
  figures,
  stale,
  toggle,
}: {
  spell: KnownSpell;
  figures: SpellFigures | undefined;
  stale?: boolean;
  toggle?: { on: boolean; problem: string | null; onToggle: () => void };
}) {
  const always = spell.kind === "always";
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 text-sm", toggle && !toggle.on && "text-muted-foreground")}>
      {toggle ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={toggle.on}
          aria-label={`Prepare ${spell.name}`}
          title={toggle.problem ?? (toggle.on ? "Prepared: click to unprepare" : "Click to prepare")}
          disabled={!!toggle.problem}
          onClick={toggle.onToggle}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded border focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40",
            toggle.on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 hover:border-foreground",
          )}
        >
          {toggle.on && <CheckIcon className="size-4" />}
        </button>
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
          {always && <CheckIcon className="size-4 text-primary" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <InfoCard id={spell.elementId} className={cn("font-medium", toggle && !toggle.on && "font-normal")}>
          {spell.name}
        </InfoCard>
        {figures?.ritual && <Tag title="Ritual: can also be cast as a ritual, taking 10 minutes longer and no slot">R</Tag>}
        {figures?.concentration && <Tag title="Concentration: ends if you cast another concentration spell or lose concentration">C</Tag>}
        {always && <Tag title="Always prepared: does not count toward your prepared spells">always prepared</Tag>}
        {stale && <Tag title="No longer fits: a lower level or a book switched off">no longer fits</Tag>}
        {spell.origin && <span className="ms-2 text-xs text-muted-foreground">{spell.origin}</span>}
      </span>
      {figures && (
        <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground sm:inline">
          {/* "1 reaction, which you take when…": the trigger is on the spell's card */}
          {[figures.castingTime?.split(",")[0], figures.range].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

function Tag({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span title={title} className="ms-1.5 inline-block rounded border px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
