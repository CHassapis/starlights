import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSpellIndex } from "@/lib/api/magic";
import { isPrepared, prepareProblem, preparedCount, togglePrepared, type Caster, type MagicState } from "@/lib/rules/magic";
import { normalizeText } from "@/lib/rules/picker";
import { cn } from "@/lib/utils";

const ORDINAL = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];

/**
 * Preparing spells from the simulator, as after a long rest: tick the spells each preparing class has ready today
 * (its whole class list or its spellbook, up to the number it may prepare). The same choice as the Magic tab.
 */
export function PrepareSpells({ casters, magic, onChange }: { casters: Caster[]; magic: MagicState; onChange: (fn: (m: MagicState) => MagicState) => void }) {
  const { byId } = useSpellIndex();
  const [query, setQuery] = useState("");
  const preparing = casters.filter((c) => c.prepares);
  if (preparing.length === 0) return <p className="text-sm text-white/60">Your spells are known, not prepared: they are always ready.</p>;
  const q = normalizeText(query);
  return (
    <div className="space-y-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a spell…"
        className="h-8 w-full rounded-md border border-white/15 bg-black/40 px-2 text-sm text-white placeholder:text-white/40"
      />
      {preparing.map((c) => {
        const { count, max } = preparedCount(c, magic);
        const always = c.spells.filter((s) => s.kind === "always").map((s) => s.elementId);
        const ids = [...new Set([...always, ...c.preparable, ...c.spells.filter((s) => s.kind === "spellbook").map((s) => s.elementId)])];
        const rows = ids
          .map((id) => {
            const known = c.spells.find((s) => s.elementId === id);
            const f = byId?.get(id);
            return { id, name: known?.name ?? f?.name ?? "Unknown spell", level: known?.level ?? f?.level ?? 0, always: always.includes(id), on: isPrepared(c, magic, id) };
          })
          .filter((r) => r.level > 0 && (!q || normalizeText(r.name).includes(q)))
          .sort((a, b) => Number(b.on) - Number(a.on) || a.level - b.level || a.name.localeCompare(b.name));
        const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
        return (
          <div key={c.name} className="space-y-2">
            <p className="text-sm font-semibold text-white">
              {c.name}: {count}
              {max !== null ? ` of ${max}` : ""} prepared
              {max !== null && count > max && <span className="ml-1 text-amber-300">(over the limit)</span>}
              <span className="ml-2 text-xs font-normal text-white/50">{c.spellbook ? "from your spellbook" : "from your whole class list"}; always-prepared spells don't count</span>
            </p>
            {levels.map((level) => (
              <div key={level}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{ORDINAL[level]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {rows
                    .filter((r) => r.level === level)
                    .map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        disabled={r.always}
                        title={r.always ? "Always prepared" : undefined}
                        onClick={() => {
                          const problem = r.on ? null : prepareProblem(c, magic, r.id);
                          if (!problem) return onChange((m) => togglePrepared(c, m, r.id));
                          // forgot to prepare it this morning: the DM may allow it anyway, over the day's number
                          if (max !== null && count >= max && window.confirm(`${problem}\n\nForgot to prepare ${r.name}? Prepare it anyway, over the limit (your DM's call)?`)) {
                            onChange((m) => ({ ...m, prepared: { ...m.prepared, [c.name]: [...(m.prepared[c.name] ?? []), r.id] } }));
                            toast(`${r.name} prepared, over your limit`, { description: "Unprepare another spell after the fight to get back to the limit." });
                          } else if (!(max !== null && count >= max)) toast.error(problem);
                        }}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                          r.on ? "border-sky-300/60 bg-sky-400/20 text-sky-50" : "border-white/15 text-white/70 hover:bg-white/10",
                          r.always && "border-amber-300/40 bg-amber-300/10 text-amber-50",
                        )}
                      >
                        {r.on && <CheckIcon className="size-3" />}
                        {r.name}
                        {r.always && <span className="text-[10px] opacity-70">always</span>}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
