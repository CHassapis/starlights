/**
 * The simulator's magic items and consumables: what each one does in a fight, read from its text. Charges are the
 * Equipment tab's (spending one here spends it there); a weapon's switchable powers (a Flame Tongue ablaze, a Holy
 * Avenger against fiends) add their damage to its attack cards; a potion heals and is used up. Bonuses an item's
 * rules give (AC, saves, ability scores, speed) are already in the character's numbers while it is active.
 */
import { FlaskConicalIcon, GemIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SheetItem } from "@/lib/api/sheet";
import { average, formatRoll, itemHealing, plainSpellText, rollDice, type CombatState, type ItemRider } from "@/lib/rules/battle";
import { cn } from "@/lib/utils";

export function Items({
  items,
  riders,
  state,
  edition,
  update,
  setCharges,
  consume,
  heal,
  markUsed,
}: {
  items: SheetItem[];
  riders: Record<string, ItemRider[]>;
  state: CombatState;
  edition: "2014" | "2024";
  update: (change: (c: CombatState) => CombatState) => void;
  setCharges: (entryId: string, used: number) => void;
  consume: (entryId: string) => void;
  heal: (amount: number) => void;
  markUsed: (slot: "Action" | "Bonus Action") => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-white/60">No magic items or potions carried. Add them in the builder's Equipment tab.</p>;
  }
  const active = new Set(state.active ?? []);
  const toggle = (key: string) => update((c) => ({ ...c, active: (c.active ?? []).includes(key) ? (c.active ?? []).filter((k) => k !== key) : [...(c.active ?? []), key] }));
  const sorted = [...items].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.consumable) - Number(b.consumable) || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sorted.map((item) => {
        const heals = item.consumable ? itemHealing(item.html) : null;
        const powers = riders[item.entryId] ?? [];
        const chargesLeft = item.charges ? Math.max(0, item.charges - item.chargesUsed) : null;
        return (
          <article key={item.entryId} className={cn("rounded-xl border bg-neutral-900/80 p-3 shadow-xl backdrop-blur-md", item.active ? "border-amber-300/30" : "border-white/10")}>
            <header className="flex flex-wrap items-center gap-2">
              {item.consumable ? <FlaskConicalIcon className="size-4 text-emerald-300" /> : <GemIcon className="size-4 text-amber-300" />}
              <h3 className="font-semibold text-white">{item.name}</h3>
              {item.quantity > 1 && <span className="text-xs text-white/60">×{item.quantity}</span>}
              <span className="flex-1" />
              {item.rarity && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70">{item.rarity}</span>}
              {item.requiresAttunement && (
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", item.attuned ? "border-emerald-300/40 text-emerald-100" : "border-red-300/40 text-red-100")}>
                  {item.attuned ? "attuned" : "not attuned"}
                </span>
              )}
            </header>
            <p className="mt-1 text-xs text-white/60">
              {item.bonuses.length > 0
                ? item.active
                  ? `Active: ${item.bonuses.join(", ")}, already in your numbers.`
                  : item.requiresAttunement && !item.attuned
                    ? `Attune to it (a short rest with it, in the Equipment tab) for ${item.bonuses.join(", ")}.`
                    : `Equip it in the Equipment tab for ${item.bonuses.join(", ")}.`
                : item.requiresAttunement && !item.attuned
                  ? "Needs attunement (a short rest with it) before its magic works: attune it in the Equipment tab."
                  : item.consumable
                    ? "Used up when you use it."
                    : "Its powers are below and in what it does."}
            </p>

            {chargesLeft !== null && item.charges !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/75">
                <span>Charges</span>
                <span className="inline-flex gap-0.5">
                  {Array.from({ length: Math.min(item.charges, 30) }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={i < chargesLeft ? "Spend a charge" : "Get back a charge"}
                      onClick={() => setCharges(item.entryId, i < chargesLeft ? item.chargesUsed + 1 : item.chargesUsed - 1)}
                      className={cn("size-3 rotate-45 border border-violet-300/70", i < chargesLeft ? "bg-violet-400" : "bg-transparent")}
                    />
                  ))}
                </span>
                <span>
                  {chargesLeft}/{item.charges}
                </span>
              </div>
            )}

            {item.spells.length > 0 && (
              <p className="mt-2 text-xs text-violet-100/80">
                Casts{" "}
                {item.spells
                  .map((s) => `${s.spell.name} (${s.cost ? `${s.cost} charge${s.cost === 1 ? "" : "s"}${s.upcast ? ", more for a higher level" : ""}` : "no charge"}${s.dc ? `, save DC ${s.dc}` : ""})`)
                  .join(", ")}
                : cast them from the Spells tab.
              </p>
            )}

            {powers.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {powers.map((p) => {
                  const key = `${item.entryId}:${p.id}`;
                  const on = p.always || active.has(key);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-red-300/40 bg-red-500/10 px-2 py-0.5 text-red-100">
                        +{formatRoll(p.roll)} ({average(p.roll)} avg)
                      </span>
                      <span className="text-white/75">{p.label}</span>
                      <span className="flex-1" />
                      {p.always || p.critOnly ? (
                        <span className="text-white/50">{p.critOnly ? "added to critical hits" : "always on"}</span>
                      ) : (
                        <Button size="sm" variant={on ? "default" : "secondary"} className={cn("h-7", on && "bg-amber-500 text-black hover:bg-amber-400")} aria-pressed={on} onClick={() => toggle(key)}>
                          {on ? "On" : "Switch on"}
                        </Button>
                      )}
                    </li>
                  );
                })}
                <li className="text-[11px] text-white/45">Switched-on damage is added to this weapon's attack cards.</li>
              </ul>
            )}

            {heals && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                  Heals {formatRoll(heals, false)} ({average(heals)} avg)
                </span>
                <span className="text-white/60">{edition === "2024" ? "Drinking it is a Bonus Action." : "Drinking it is an action."}</span>
                <span className="flex-1" />
                <Button
                  size="sm"
                  className="h-7 bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => {
                    const amount = rollDice(heals);
                    heal(amount);
                    consume(item.entryId);
                    markUsed(edition === "2024" ? "Bonus Action" : "Action");
                    toast.success(`${item.name}: healed ${amount} hit points`);
                  }}
                >
                  Drink (roll)
                </Button>
              </div>
            )}

            <details className="mt-2 text-xs text-white/70">
              <summary className="cursor-pointer text-white/50">What it does</summary>
              <p className="mt-1 whitespace-pre-line">{plainSpellText(item.html) || "No description."}</p>
            </details>
          </article>
        );
      })}
    </div>
  );
}
