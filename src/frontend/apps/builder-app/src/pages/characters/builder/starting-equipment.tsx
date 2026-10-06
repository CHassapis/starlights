import { CheckIcon, DicesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { BuilderChoice } from "@/lib/api/builder";
import { useInventory, useSaveInventory } from "@/lib/api/inventory";
import { useItemCatalog } from "@/lib/api/items";
import { useCategoryIndex, useLoreEntry, useLoreMeta } from "@/lib/lore/data";
import type { IndexRow } from "@/lib/lore/types";
import type { InventoryEntry, ItemInfo } from "@/lib/rules/items";
import { coinsOf, goldAlternative, itemsOfKind, matchItem, startingGroups, type StartGroup, type StartItem } from "@/lib/rules/starting-equipment";
import { cn } from "@/lib/utils";

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const revisedSource = (source: string | null | undefined) => /\((2024|2025)\)/.test(source ?? "");

/**
 * The equipment the books allow a new character: the class's and the background's packages (or gold instead).
 * The player picks an option in each group, chooses the "a martial weapon" kind of items, and adds it all to their
 * equipment in one go.
 */
export function StartingEquipment({ characterId, choices }: { characterId: string; choices: BuilderChoice[] }) {
  const cls = choices.find((c) => c.section === "Class" && c.depth === 0 && c.selected)?.selected ?? null;
  const background = choices.find((c) => c.section === "Background" && c.depth === 0 && c.selected)?.selected ?? null;
  const revised = revisedSource(cls?.source ?? background?.source);
  const meta = useLoreMeta();
  const { data: catalog } = useItemCatalog();
  // loaded here too: a save changes the inventory as loaded (the Equipment tab may never have been opened)
  const inventory = useInventory(characterId);
  const save = useSaveInventory(characterId);
  const [added, setAdded] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({}); // group key → option label; kind key → item id
  const [gold, setGold] = useState<Record<string, number>>({}); // "gold instead" amounts
  const classEntry = useBookEntry(meta.data, "classes", cls?.name, revised);
  const backgroundEntry = useBookEntry(meta.data, "backgrounds", background?.name, revised);

  if (!cls && !background) return <p className="text-sm text-muted-foreground">Pick a class and a background first (the earlier steps): they decide what you start with.</p>;
  if (meta.isError) return <p className="text-sm text-muted-foreground">The Compendium isn't set up on this site, so the books' starting equipment can't be shown. Add your gear in the Equipment tab.</p>;
  if (meta.isLoading || !catalog || classEntry.loading || backgroundEntry.loading) return <Spinner className="mx-auto my-6 size-5" />;

  const sources = [
    { key: "class", title: `${cls?.name ?? "Class"}`, se: classEntry.entry?.startingEquipment },
    { key: "background", title: `${background?.name ?? "Background"} (background)`, se: backgroundEntry.entry?.startingEquipment },
  ].filter((s) => s.se);

  const pickOf = (key: string, group: StartGroup) => picks[key] ?? group[0].label;

  function add() {
    // a second kit by mistake (back to this step, or the guide opened again on a character with gear)
    const has = inventory.data?.items.length ?? 0;
    if (has > 0 && !window.confirm(`This character already has ${has} ${has === 1 ? "item" : "items"}. Add the starting equipment as well?`)) return;
    const entries: InventoryEntry[] = [];
    let cp = 0;
    for (const s of sources) {
      // the 2014 books' gold instead of all of the class's equipment
      if (picks[`${s.key}-0`] === "gold") {
        cp += (gold[`${s.key}-0`] ?? 0) * 100;
        continue;
      }
      startingGroups(s.se).forEach((group, g) => {
        const key = `${s.key}-${g}`;
        const option = group.find((o) => o.label === pickOf(key, group)) ?? group[0];
        cp += option.cp;
        option.items.forEach((it, n) => entries.push(...toEntries(it, `${key}-${option.label}-${n}`)));
      });
    }
    save.update(
      (current) => {
        const coins = { ...current.coins };
        for (const [kind, n] of Object.entries(coinsOf(cp))) coins[kind as keyof typeof coins] = (coins[kind as keyof typeof coins] ?? 0) + n;
        return { items: [...current.items, ...entries], coins };
      },
      (e) => toast.error("Could not add it", { description: e.message }),
    );
    setAdded(true);
    toast.success(`Added ${entries.length} items${cp ? ` and ${cp / 100} gp` : ""} to your equipment`);
  }

  function toEntries(it: StartItem, kindKey: string): InventoryEntry[] {
    const items = catalog!.items;
    if (it.kind) {
      const options = itemsOfKind(items, it.kind, revised);
      const chosen = options.find((o) => o.id === picks[kindKey]) ?? options[0];
      return chosen ? Array.from({ length: it.quantity }, () => entry(chosen, 1)) : [custom(it.name, it.quantity)];
    }
    const match = matchItem(items, it.name, revised);
    return [match ? entry(match.item, it.quantity * match.per, it.displayName) : custom(it.displayName ?? it.name, it.quantity)];
  }
  const entry = (item: ItemInfo, quantity: number, name?: string): InventoryEntry => ({ id: newId(), elementId: item.id, quantity, card: true, name: name ?? null });
  const custom = (name: string, quantity: number): InventoryEntry => ({ id: newId(), name: name.charAt(0).toUpperCase() + name.slice(1), quantity, card: false });

  if (sources.length === 0) return <p className="text-sm text-muted-foreground">The books list no starting equipment for this class and background. Add your gear in the Equipment tab.</p>;

  return (
    <div className="space-y-5">
      {sources.map((s) => {
        const groups = startingGroups(s.se);
        const goldText = goldAlternative(s.se);
        return (
          <section key={s.key} className="space-y-3 rounded-lg border p-4">
            <h3 className="font-heading text-lg">{s.title}</h3>
            {groups.map((group, g) => {
              const key = `${s.key}-${g}`;
              if (g > 0 && picks[`${s.key}-0`] === "gold") return null;
              const chosen = pickOf(key, group);
              const options = [...group];
              return (
                <div key={key} className="space-y-2">
                  {(options.length > 1 || goldText) && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Choose one</p>}
                  {options.map((o) => (
                    <label key={o.label || "only"} className={cn("flex cursor-pointer gap-3 rounded-md border p-3", chosen === o.label && "border-primary bg-primary/5")}>
                      {options.length > 1 || goldText ? (
                        <input type="radio" name={key} className="mt-1" checked={chosen === o.label} onChange={() => setPicks({ ...picks, [key]: o.label })} />
                      ) : (
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                      )}
                      <span className="min-w-0 flex-1 space-y-1 text-sm">
                        {o.label && <span className="font-medium">Option {o.label}</span>}
                        {o.items.length === 0 && o.cp > 0 && <span className="block">{o.cp / 100} gp to buy your own gear</span>}
                        <ul className="space-y-1">
                          {o.items.map((it, n) => (
                            <ItemLine
                              key={n}
                              item={it}
                              catalog={catalog.items}
                              revised={revised}
                              value={picks[`${key}-${o.label}-${n}`]}
                              onPick={(id) => setPicks({ ...picks, [`${key}-${o.label}-${n}`]: id, [key]: o.label })}
                            />
                          ))}
                          {o.items.length > 0 && o.cp > 0 && <li>{o.cp / 100} gp</li>}
                        </ul>
                      </span>
                    </label>
                  ))}
                  {goldText && g === 0 && (
                    <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm", chosen === "gold" && "border-primary bg-primary/5")}>
                      <input type="radio" name={key} checked={chosen === "gold"} onChange={() => setPicks({ ...picks, [key]: "gold" })} />
                      <span className="flex-1">Or no class equipment, and {goldText} to buy your own</span>
                      {chosen === "gold" && (
                        <span className="flex items-center gap-1">
                          <Input aria-label="Gold rolled" inputMode="numeric" value={gold[key] ?? ""} placeholder="gp" onChange={(e) => setGold({ ...gold, [key]: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="h-8 w-20" />
                          <Button type="button" size="sm" variant="outline" onClick={() => setGold({ ...gold, [key]: rollGold(goldText) })}>
                            <DicesIcon /> Roll
                          </Button>
                        </span>
                      )}
                    </label>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={add} disabled={added || save.isPending || !inventory.data}>
          {added ? <CheckIcon /> : null} {added ? "Added to your equipment" : "Add this to my equipment"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {inventory.data && inventory.data.items.length > 0 && !added
            ? `This character already has ${inventory.data.items.length} items: add this only if they don't have their starting gear yet.`
            : "You can change anything later in the Equipment tab."}
        </span>
      </div>
    </div>
  );
}

/** One item of an option: its name, or a list to pick from for "a martial weapon". */
function ItemLine({ item, catalog, revised, value, onPick }: { item: StartItem; catalog: ItemInfo[]; revised: boolean; value?: string; onPick: (id: string) => void }) {
  const qty = item.quantity > 1 ? `${item.quantity} × ` : "";
  if (!item.kind) return <li>{qty + (item.displayName ?? item.name)}</li>;
  const options = itemsOfKind(catalog, item.kind, revised);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>{qty + item.name}:</span>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={value ?? options[0]?.id ?? ""} onChange={(e) => onPick(e.target.value)} onClick={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </li>
  );
}

/** "5d4 × 10 gp" rolled. */
function rollGold(text: string): number {
  const m = text.match(/(\d+)d(\d+)(?:\s*×\s*(\d+))?/);
  if (!m) return 0;
  let total = 0;
  for (let i = 0; i < Number(m[1]); i++) total += 1 + Math.floor(Math.random() * Number(m[2]));
  return total * Number(m[3] ?? 1);
}

/** A class's or background's entry in the Compendium, the character's edition first. */
function useBookEntry(meta: Parameters<typeof useCategoryIndex>[0], category: string, name: string | undefined, revised: boolean) {
  const index = useCategoryIndex<IndexRow & { kind?: string }>(meta, category);
  const rows = (index.data?.rows ?? []).filter((r) => name && r.name.toLowerCase() === name.toLowerCase() && (category !== "classes" || !r.kind || r.kind === "class"));
  const row = rows.find((r) => r.ed === (revised ? "2024" : "2014")) ?? rows[0];
  const entry = useLoreEntry(meta, category, row?.k);
  return { entry: entry.data?.entry as { startingEquipment?: unknown } | null | undefined, loading: index.isLoading || (!!row && entry.isLoading) };
}
