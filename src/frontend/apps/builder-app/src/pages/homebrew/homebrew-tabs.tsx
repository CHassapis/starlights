/**
 * The Homebrew page's own makers: magic items (become Aurora items the builder and campaigns can use) and monsters
 * (stat blocks a campaign's encounters can add). Everyone can read them; making and changing them needs the admin.
 */
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { HomebrewStatBlock } from "@/components/homebrew-stat-block";
import { RichText } from "@/components/rich-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHomebrewActions, useHomebrewItems, useHomebrewMonsters, type HomebrewItem } from "@/lib/api/homebrew";
import { isAdmin } from "@/lib/player";
import { ABILITY_KEYS, EMPTY_MONSTER, type HomebrewMonster } from "@/lib/rules/homebrew";
import { cn } from "@/lib/utils";

const KINDS = ["Wondrous Item", "Weapon", "Armor", "Ring", "Potion", "Scroll", "Staff", "Wand", "Rod"];
const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"];
const area = "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const select = cn(area, "h-9 py-1");

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("block space-y-1 text-sm", wide && "sm:col-span-2")}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const NEW_ITEM: HomebrewItem = { name: "", source: "Homebrew", kind: "Wondrous Item", rarity: "Uncommon", attunement: false, description: "" };

export function HomebrewItems() {
  const { data, isLoading } = useHomebrewItems();
  const { saveItem, deleteItem } = useHomebrewActions();
  const [editing, setEditing] = useState<HomebrewItem | null>(null);
  const admin = isAdmin();
  const items = data ?? [];
  const books = [...new Set(items.map((i) => i.source ?? "Homebrew"))].sort();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Items made here work like book items: players add them in the Equipment tab (with Homebrew ticked in their Sources), and a DM gives them from a
          campaign that uses homebrew.
        </p>
        {admin ? (
          <Button onClick={() => setEditing({ ...NEW_ITEM })}>
            <PlusIcon /> New magic item
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Unlock admin (key button at the top) to make homebrew.</span>
        )}
      </div>
      {isLoading && <Spinner className="mx-auto my-8 size-6" />}
      {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">No homebrew items yet.</p>}
      {books.map((book) => (
        <section key={book} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{book}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {items
              .filter((i) => (i.source ?? "Homebrew") === book)
              .map((i) => (
                <article key={i.id} className="rounded-lg border bg-background/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{i.name}</h3>
                    <Badge variant="outline">{i.rarity}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {i.kind}
                      {i.base ? ` (${i.base})` : ""}
                      {i.damage ? ` · ${i.damage} damage` : ""}
                      {i.attunement ? ` · requires attunement${i.attunementBy ? ` ${i.attunementBy}` : ""}` : ""}
                      {i.charges ? ` · ${i.charges} charges` : ""}
                    </span>
                    <span className="flex-1" />
                    {admin && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
                          <PencilIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${i.name}`}
                          onClick={() => {
                            if (confirm(`Delete ${i.name}? Characters carrying it lose it.`))
                              deleteItem.mutate(i.id!, { onError: (e) => toast.error("Could not delete it", { description: e.message }) });
                          }}
                        >
                          <Trash2Icon />
                        </Button>
                      </>
                    )}
                  </div>
                  <RichText text={i.description} className="mt-1 text-muted-foreground" />
                </article>
              ))}
          </div>
        </section>
      ))}
      {editing && (
        <ItemDialog
          item={editing}
          busy={saveItem.isPending}
          onClose={() => setEditing(null)}
          onSave={(item) =>
            saveItem.mutate(item, {
              onSuccess: () => {
                toast.success(`${item.name} saved`);
                setEditing(null);
              },
              onError: (e) => toast.error("Could not save it", { description: e.message }),
            })
          }
        />
      )}
    </div>
  );
}

function ItemDialog({ item, busy, onClose, onSave }: { item: HomebrewItem; busy: boolean; onClose: () => void; onSave: (i: HomebrewItem) => void }) {
  const [f, setF] = useState<HomebrewItem>(item);
  const set = (patch: Partial<HomebrewItem>) => setF((x) => ({ ...x, ...patch }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v) || 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item.id ? `Edit ${item.name}` : "New magic item"}</DialogTitle>
          <DialogDescription>It becomes an item like the books' ones, under the book name you give it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} autoFocus />
          </Field>
          <Field label="Book" hint='Shows as its source, e.g. "Curse of Strahd (homebrew)"'>
            <Input value={f.source ?? ""} onChange={(e) => set({ source: e.target.value })} maxLength={100} />
          </Field>
          <Field label="Kind">
            <select className={select} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="Rarity">
            <select className={select} value={f.rarity} onChange={(e) => set({ rarity: e.target.value })}>
              {RARITIES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          {(f.kind === "Weapon" || f.kind === "Armor") && (
            <Field label={f.kind === "Weapon" ? "Made from (weapon)" : "Made from (armor)"} hint={f.kind === "Weapon" ? "e.g. Rapier, Longsword, Dagger" : "e.g. Chain Shirt, Plate"} wide={f.kind === "Armor"}>
              <Input value={f.base ?? ""} onChange={(e) => set({ base: e.target.value })} maxLength={60} />
            </Field>
          )}
          {f.kind === "Weapon" && (
            <Field label="Damage (optional)" hint="Only if it differs from the weapon it's made from, e.g. 1d6">
              <Input value={f.damage ?? ""} onChange={(e) => set({ damage: e.target.value.replace(/[^\dd]/gi, "").toLowerCase() || null })} maxLength={6} placeholder="as the weapon" />
            </Field>
          )}
          <Field label="Attunement">
            <select className={select} value={f.attunement ? "yes" : "no"} onChange={(e) => set({ attunement: e.target.value === "yes" })}>
              <option value="no">Not needed</option>
              <option value="yes">Requires attunement</option>
            </select>
          </Field>
          {f.attunement ? (
            <Field label="Attunement by (optional)" hint='e.g. "by a paladin"'>
              <Input value={f.attunementBy ?? ""} onChange={(e) => set({ attunementBy: e.target.value })} maxLength={60} />
            </Field>
          ) : (
            <span />
          )}
          <Field label="Charges (optional)">
            <Input inputMode="numeric" value={f.charges ?? ""} onChange={(e) => set({ charges: num(e.target.value.replace(/\D/g, "")) })} />
          </Field>
          <Field label="Weight in lb (optional)">
            <Input inputMode="decimal" value={f.weight ?? ""} onChange={(e) => set({ weight: num(e.target.value.replace(/[^\d.]/g, "")) })} />
          </Field>
          <Field label="What it does" hint="Plain text. Leave a blank line between paragraphs." wide>
            <textarea rows={8} className={area} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={20000} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !f.name.trim()} onClick={() => onSave(f)}>
            {busy && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HomebrewMonsters() {
  const { data, isLoading } = useHomebrewMonsters();
  const { saveMonster, deleteMonster } = useHomebrewActions();
  const [editing, setEditing] = useState<HomebrewMonster | null>(null);
  const admin = isAdmin();
  const monsters = [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Monsters made here can be added to a campaign's encounters (when the campaign uses homebrew), with their HP, AC and initiative filled in.
        </p>
        {admin ? (
          <Button onClick={() => setEditing({ ...EMPTY_MONSTER, abilities: { ...EMPTY_MONSTER.abilities } })}>
            <PlusIcon /> New monster
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Unlock admin (key button at the top) to make homebrew.</span>
        )}
      </div>
      {isLoading && <Spinner className="mx-auto my-8 size-6" />}
      {!isLoading && monsters.length === 0 && <p className="text-sm text-muted-foreground">No homebrew monsters yet.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {monsters.map((m) => (
          <article key={m.id} id={`monster-${m.id}`} className="scroll-mt-24 rounded-lg border bg-background/60 p-3 target:ring-2 target:ring-primary">
            {admin && (
              <div className="float-right flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${m.name}`}
                  onClick={() => {
                    if (confirm(`Delete ${m.name}?`)) deleteMonster.mutate(m.id!, { onError: (e) => toast.error("Could not delete it", { description: e.message }) });
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            )}
            <HomebrewStatBlock monster={m} />
          </article>
        ))}
      </div>
      {editing && (
        <MonsterDialog
          monster={editing}
          busy={saveMonster.isPending}
          onClose={() => setEditing(null)}
          onSave={(m) =>
            saveMonster.mutate(m, {
              onSuccess: () => {
                toast.success(`${m.name} saved`);
                setEditing(null);
              },
              onError: (e) => toast.error("Could not save it", { description: e.message }),
            })
          }
        />
      )}
    </div>
  );
}

function MonsterDialog({ monster, busy, onClose, onSave }: { monster: HomebrewMonster; busy: boolean; onClose: () => void; onSave: (m: HomebrewMonster) => void }) {
  const [m, setM] = useState<HomebrewMonster>(monster);
  const set = (patch: Partial<HomebrewMonster>) => setM((x) => ({ ...x, ...patch }));
  const text = (key: keyof HomebrewMonster, label: string, hint?: string, rows = 3) => (
    <Field label={label} hint={hint} wide>
      <textarea rows={rows} className={area} value={(m[key] as string | undefined) ?? ""} onChange={(e) => set({ [key]: e.target.value })} maxLength={8000} />
    </Field>
  );
  const line = (key: keyof HomebrewMonster, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={(m[key] as string | undefined) ?? ""} onChange={(e) => set({ [key]: e.target.value })} maxLength={300} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{monster.id ? `Edit ${monster.name}` : "New monster"}</DialogTitle>
          <DialogDescription>Write it like a book's stat block. Traits and actions: one per line, "Name. What it does."</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={m.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} autoFocus />
          </Field>
          {line("kind", "Size, type, alignment", "e.g. Medium fiend, neutral evil")}
          <Field label="Armor class">
            <Input inputMode="numeric" value={m.ac} onChange={(e) => set({ ac: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </Field>
          {line("acNote", "AC from (optional)", "e.g. natural armor")}
          <Field label="Hit points">
            <Input inputMode="numeric" value={m.hp} onChange={(e) => set({ hp: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </Field>
          {line("hpFormula", "Hit dice (optional)", "e.g. 15d8 + 45")}
          {line("speed", "Speed", "e.g. 30 ft., fly 60 ft.")}
          {line("cr", "Challenge rating", "e.g. 5 or 1/2")}
          <div className="grid grid-cols-6 gap-2 sm:col-span-2">
            {ABILITY_KEYS.map((k) => (
              <Field key={k} label={k.toUpperCase()}>
                <Input inputMode="numeric" value={m.abilities[k]} onChange={(e) => set({ abilities: { ...m.abilities, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 } })} className="text-center" />
              </Field>
            ))}
          </div>
          {line("saves", "Saving throws (optional)", "e.g. Dex +5, Wis +3")}
          {line("skills", "Skills (optional)", "e.g. Perception +5, Stealth +6")}
          {line("defenses", "Resistances and immunities (optional)")}
          {line("senses", "Senses (optional)", "e.g. darkvision 60 ft., passive Perception 15")}
          {line("languages", "Languages (optional)")}
          <span />
          {text("traits", "Traits", "One per line: Name. What it does.", 4)}
          {text("actions", "Actions", "One per line: Name. What it does.", 5)}
          {text("bonusActions", "Bonus actions (optional)")}
          {text("reactions", "Reactions (optional)")}
          {text("legendary", "Legendary actions (optional)")}
          {text("notes", "Notes (optional)", "Tactics, lore, where it lives.")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !m.name.trim()} onClick={() => onSave(m)}>
            {busy && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
