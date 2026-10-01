import {
  AlertTriangleIcon,
  BackpackIcon,
  CheckIcon,
  CoinsIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ShieldIcon,
  SparklesIcon,
  StickyNoteIcon,
  SwordsIcon,
  WeightIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { InfoCard } from "@/components/info-card";
import { ItemPicker, rarityColor, type AddItem } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useCharacterFacts, useInventory, useSaveInventory } from "@/lib/api/inventory";
import { useBaseCandidates, useItemCatalog } from "@/lib/api/items";
import { useCharacterSources } from "@/lib/api/sources";
import {
  COINS,
  COIN_NAMES,
  armorClass,
  attacks,
  attunementMax,
  equipProblems,
  equipSlots,
  groupInventory,
  weight,
  type Attack,
  type InventoryEntry,
  type Resolved,
} from "@/lib/rules/items";
import { rarityOf } from "@/lib/rules/picker";
import { cn } from "@/lib/utils";

const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * What the character has on them, like Aurora's Equipment tab but grouped the way things are: equipped, carried,
 * in each container (a Bag of Holding weighs only itself, a mount's saddlebags are not carried), and stored away.
 * Equipping armor, shields and weapons and attuning magic items drives the sheet: armor class, attacks, and the
 * items' own rules (saves, speeds, spells) through the rules engine.
 */
export function EquipmentTab({ characterId }: { characterId: string }) {
  const { data: inventory, isLoading } = useInventory(characterId);
  const save = useSaveInventory(characterId);
  const { data: catalog } = useItemCatalog();
  const { facts } = useCharacterFacts(characterId);
  const { data: sources } = useCharacterSources(characterId);
  const [picking, setPicking] = useState(false);

  const byId = catalog?.byId;
  const groups = useMemo(() => (inventory && byId ? groupInventory(inventory, byId) : null), [inventory, byId]);
  const summary = useMemo(() => {
    if (!inventory || !byId || !facts) return null;
    return {
      ac: armorClass(inventory, byId, facts),
      attacks: new Map(attacks(inventory, byId, facts).map((a) => [a.entryId, a])),
      weight: weight(inventory, byId, facts.strength),
      problems: equipProblems(inventory, byId, attunementMax(facts)),
    };
  }, [inventory, byId, facts]);

  const failed = (e: Error) => toast.error("Could not save the equipment", { description: e.message });

  function add(add: AddItem) {
    save.update((current) => {
      // another of a plain stacking item raises the count on the one already carried
      const same = add.item && !add.baseElementId
        ? current.items.find((e) => e.elementId === add.item!.id && !e.baseElementId && !e.equipped && !e.containerId && !e.stored && !e.name)
        : undefined;
      if (same && (add.item!.stackable || add.item!.elementType === "Item")) {
        return { items: current.items.map((e) => (e.id === same.id ? { ...e, quantity: e.quantity + add.quantity } : e)) };
      }
      const entry: InventoryEntry = {
        id: newId(),
        elementId: add.item?.id ?? null,
        baseElementId: add.baseElementId ?? null,
        name: add.name ?? null,
        quantity: add.quantity,
        card: !!add.item,
        custom: add.custom ?? null,
      };
      return { items: [...current.items, entry] };
    }, failed);
    toast.success(`${add.item?.name ?? add.name} added`);
  }

  if (isLoading || !inventory || !groups) return <Spinner className="mx-auto my-8 size-5" />;

  const containers = groups.containers.map((g) => g.container);
  const rowProps = {
    containers,
    nextAttack: Math.max(0, ...inventory.items.map((e) => e.attack ?? 0)) + 1,
    attackOf: (id: string) => summary?.attacks.get(id),
    onChange: (id: string, change: Partial<InventoryEntry>) => save.updateEntry(id, change, failed),
    onRemove: (id: string) =>
      save.update(
        (current) => ({
          // what was inside a removed container falls out onto the character
          items: current.items.filter((e) => e.id !== id).map((e) => (e.containerId === id ? { ...e, containerId: null } : e)),
        }),
        failed,
      ),
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* the numbers the equipment decides */}
      <div className="flex flex-wrap items-stretch gap-2">
        {summary && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-muted/60">
                <ShieldIcon className="size-5 text-muted-foreground" />
                <span>
                  <span className="block text-xs text-muted-foreground">Armor class</span>
                  <span className="text-xl font-semibold tabular-nums">{summary.ac.total}</span>
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-sm">
              <p className="mb-2 font-medium">How it adds up</p>
              {summary.ac.parts.map((p) => (
                <p key={p.label} className="flex justify-between">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className="tabular-nums">{p.value >= 0 && p !== summary.ac.parts[0] ? `+${p.value}` : p.value}</span>
                </p>
              ))}
              {summary.ac.stealthDisadvantage && <p className="mt-2 text-xs text-muted-foreground">Disadvantage on Stealth checks in this armor.</p>}
            </PopoverContent>
          </Popover>
        )}
        {summary && (
          <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", summary.weight.encumbered && "border-destructive/60")}>
            <WeightIcon className="size-5 text-muted-foreground" />
            <span>
              <span className="block text-xs text-muted-foreground">Carrying</span>
              <span className="tabular-nums">
                <span className="text-xl font-semibold">{summary.weight.carried}</span> / {summary.weight.capacity} lb
              </span>
            </span>
          </div>
        )}
        {summary && (
          <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", summary.problems.attuned > summary.problems.attunementMax && "border-destructive/60")}>
            <SparklesIcon className="size-5 text-muted-foreground" />
            <span>
              <span className="block text-xs text-muted-foreground">Attuned</span>
              <span className="text-xl font-semibold tabular-nums">
                {summary.problems.attuned} / {summary.problems.attunementMax}
              </span>
            </span>
          </div>
        )}
        <Button className="ml-auto h-auto self-stretch" onClick={() => setPicking(true)}>
          <PlusIcon /> Add equipment
        </Button>
      </div>

      {summary && (summary.problems.messages.length > 0 || summary.weight.overfull.length > 0) && (
        <ul className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
          {summary.problems.messages.map((m) => (
            <li key={m} className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" /> {m}
            </li>
          ))}
          {summary.weight.overfull.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" /> {containers.find((c) => c.entry.id === id)?.name} holds more than it can.
            </li>
          ))}
          {summary.weight.encumbered && (
            <li className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" /> Carrying more than your carrying capacity.
            </li>
          )}
        </ul>
      )}

      {inventory.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing yet.{" "}
          <button type="button" className="underline" onClick={() => setPicking(true)}>
            Add equipment
          </button>
        </div>
      )}

      <Group title="Equipped" icon={<SwordsIcon className="size-4" />} items={groups.equipped} {...rowProps} />
      <Group title="Carried" icon={<BackpackIcon className="size-4" />} items={groups.carried} {...rowProps} />
      {groups.containers.map((g) => (
        <Group
          key={g.container.entry.id}
          title={g.container.name}
          icon={<BackpackIcon className="size-4" />}
          note={
            <span className={cn(g.capacity !== null && g.contents > g.capacity && "text-destructive")}>
              {g.contents}
              {g.capacity !== null ? ` / ${g.capacity}` : ""} lb inside
              {g.container.container?.weightless ? " · weighs nothing to you" : ""}
              {g.away ? " · not with you" : ""}
            </span>
          }
          items={g.items}
          empty="Empty. Use an item's menu to put it in here."
          {...rowProps}
        />
      ))}
      <Group title="Stored elsewhere" icon={<BackpackIcon className="size-4" />} items={groups.stored} note="not carried" {...rowProps} />

      <Coins inventory={inventory.coins} onChange={(coins) => save.update(() => ({ coins }), failed)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <SavedText label="Additional treasure" value={inventory.treasure ?? ""} onCommit={(v) => save.update(() => ({ treasure: v || null }), failed)} />
        <SavedText label="Quest items & trinkets" value={inventory.questItems ?? ""} onCommit={(v) => save.update(() => ({ questItems: v || null }), failed)} />
      </div>

      <ItemPicker open={picking} onOpenChange={setPicking} restrictedSources={sources?.restricted ?? []} onAdd={add} />
    </div>
  );
}

interface RowProps {
  containers: Resolved[];
  /** the place a weapon put on the sheet's attack list gets */
  nextAttack: number;
  attackOf: (id: string) => Attack | undefined;
  onChange: (id: string, change: Partial<InventoryEntry>) => void;
  onRemove: (id: string) => void;
}

function Group({ title, icon, note, items, empty, ...row }: RowProps & { title: string; icon: ReactNode; note?: ReactNode; items: Resolved[]; empty?: string }) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="rounded-lg border">
      <h3 className="flex flex-wrap items-baseline gap-x-2 border-b bg-muted/30 px-3 py-2 font-heading">
        <span className="flex items-center gap-2 self-center text-muted-foreground">{icon}</span>
        {title}
        {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
      </h3>
      {items.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">{empty}</p> : <div className="divide-y">{items.map((r) => <Row key={r.entry.id} r={r} {...row} />)}</div>}
    </section>
  );
}

function Row({ r, containers, nextAttack, attackOf, onChange, onRemove }: RowProps & { r: Resolved }) {
  const { entry, item } = r;
  const slots = equipSlots(r);
  const attack = attackOf(entry.id);
  const charges = item?.magic?.charges ?? null;
  const [notesOpen, setNotesOpen] = useState(false);
  const rarity = item ? rarityOf(item) : null;
  const needsBase = !!item?.base && !entry.baseElementId;

  return (
    <div className="space-y-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex items-center gap-1.5">
            {r.magic && <SparklesIcon className={cn("size-3.5 shrink-0", rarityColor(rarity))} />}
            {item ? (
              <InfoCard id={item.id} className="truncate font-medium">
                {r.name}
              </InfoCard>
            ) : (
              <span className="truncate font-medium">{r.name}</span>
            )}
            {entry.quantity > 1 && <span className="shrink-0 text-sm text-muted-foreground">×{entry.quantity}</span>}
            {entry.notes && <StickyNoteIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {attack ? (
              <span className="text-foreground/80">
                {attack.attack.replace(" vs AC", " to hit")} · {attack.damage} · {attack.range}
                {!attack.proficient && " · not proficient"}
              </span>
            ) : (
              [r.categories[0], item?.magic?.rarity, r.weight ? `${r.weight} lb` : null].filter(Boolean).join(" · ")
            )}
            {charges ? ` · ${charges - (entry.chargesUsed ?? 0)}/${charges} charges` : ""}
          </p>
          {needsBase && <BaseChooser r={r} onChange={(id) => onChange(entry.id, { baseElementId: id })} />}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border">
            <Button size="icon-sm" variant="ghost" aria-label={`One fewer ${r.name}`} disabled={entry.quantity <= 1} onClick={() => onChange(entry.id, { quantity: entry.quantity - 1 })}>
              <MinusIcon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`One more ${r.name}`} onClick={() => onChange(entry.id, { quantity: entry.quantity + 1 })}>
              <PlusIcon />
            </Button>
          </div>

          {slots.length > 0 && !entry.stored && (
            <select
              aria-label={`Equip ${r.name}`}
              value={entry.equipped ?? ""}
              onChange={(e) => onChange(entry.id, { equipped: e.target.value || null, containerId: e.target.value ? null : entry.containerId })}
              className={cn("h-8 max-w-36 rounded-md border bg-background px-2 text-sm", entry.equipped && "border-primary text-primary")}
            >
              <option value="">{slots[0] === "Worn" ? "Not worn" : "Not equipped"}</option>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {s === "Worn" ? "Worn" : s}
                </option>
              ))}
            </select>
          )}

          {r.requiresAttunement && (
            <button
              type="button"
              aria-pressed={!!entry.attuned}
              onClick={() => onChange(entry.id, { attuned: !entry.attuned })}
              className={cn("flex h-8 items-center gap-1 rounded-md border px-2 text-xs", entry.attuned ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-muted-foreground")}
            >
              {entry.attuned && <CheckIcon className="size-3.5" />} Attuned
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More for ${r.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Where is it?</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={!entry.containerId && !entry.stored} onCheckedChange={() => onChange(entry.id, { containerId: null, stored: false })}>
                On you
              </DropdownMenuCheckboxItem>
              {containers
                .filter((c) => c.entry.id !== entry.id)
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.entry.id} checked={entry.containerId === c.entry.id} onCheckedChange={() => onChange(entry.id, { containerId: c.entry.id, stored: false, equipped: null })}>
                    In {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuCheckboxItem checked={!!entry.stored} onCheckedChange={() => onChange(entry.id, { stored: true, containerId: null, equipped: null, attuned: false })}>
                Stored elsewhere
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {charges && (
                <>
                  <DropdownMenuItem onSelect={(e) => (e.preventDefault(), onChange(entry.id, { chargesUsed: Math.min(charges, (entry.chargesUsed ?? 0) + 1) }))}>Use a charge</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onChange(entry.id, { chargesUsed: 0 })}>Recharge fully</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  const name = window.prompt("Name for this item", entry.name ?? r.name);
                  if (name !== null) onChange(entry.id, { name: name.trim() || null });
                }}
              >
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setNotesOpen(true)}>Notes…</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={entry.card !== false} onCheckedChange={(checked) => onChange(entry.id, { card: !!checked })}>
                Card on the sheet
              </DropdownMenuCheckboxItem>
              {r.weapon && (
                <DropdownMenuCheckboxItem checked={!!entry.attack} onCheckedChange={(checked) => onChange(entry.id, { attack: checked ? nextAttack : null })}>
                  On the sheet's attacks
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => onRemove(entry.id)}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {(notesOpen || entry.notes) && (
        <SavedText label="" value={entry.notes ?? ""} rows={2} placeholder="Notes about this item" onCommit={(v) => onChange(entry.id, { notes: v || null })} />
      )}
    </div>
  );
}

/** A magic item added without its base weapon or armor ("Weapon, +1"): choose it here. */
function BaseChooser({ r, onChange }: { r: Resolved; onChange: (id: string) => void }) {
  const { data, isLoading } = useBaseCandidates(r.item?.id);
  if (isLoading) return <Spinner className="mt-1 size-3" />;
  return (
    <select defaultValue="" onChange={(e) => e.target.value && onChange(e.target.value)} className="mt-1 h-7 rounded-md border border-amber-500/60 bg-background px-1 text-xs">
      <option value="">Which {r.item?.base?.kind === "Armor" ? "armor" : "weapon"} is it?</option>
      {(data?.items ?? [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.source})
          </option>
        ))}
    </select>
  );
}

function Coins({ inventory, onChange }: { inventory: Partial<Record<(typeof COINS)[number], number>>; onChange: (coins: Partial<Record<(typeof COINS)[number], number>>) => void }) {
  const gp = (inventory.cp ?? 0) / 100 + (inventory.sp ?? 0) / 10 + (inventory.ep ?? 0) / 2 + (inventory.gp ?? 0) + (inventory.pp ?? 0) * 10;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 font-heading text-lg">
        <CoinsIcon className="size-5 text-muted-foreground" /> Coins
        <Badge variant="outline" className="font-sans font-normal">
          worth {Math.round(gp * 100) / 100} gp
        </Badge>
      </h3>
      <div className="grid grid-cols-5 gap-2">
        {COINS.map((coin) => (
          <label key={coin} className="space-y-1 text-center text-xs text-muted-foreground">
            {COIN_NAMES[coin]}
            <NumberField value={inventory[coin] ?? 0} onCommit={(n) => onChange({ ...inventory, [coin]: n })} label={COIN_NAMES[coin]} />
          </label>
        ))}
      </div>
    </section>
  );
}

/** A number that saves when you leave the field or press Enter. */
function NumberField({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(text) || 0)));
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="text-center"
    />
  );
}

/** A text box that saves a moment after typing stops. */
function SavedText({ label, value, rows = 4, placeholder, onCommit }: { label: string; value: string; rows?: number; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <label className="block space-y-1 text-sm">
      {label && <span className="font-heading text-lg">{label}</span>}
      <textarea
        rows={rows}
        value={text}
        placeholder={placeholder}
        maxLength={label ? 20_000 : 5_000}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onCommit(next), 800);
        }}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </label>
  );
}
