import { EyeIcon, EyeOffIcon, ImagePlusIcon, LockIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { unlockCampaign, useCampaignActions, type CampaignEntry, type EntryInput, type EntryKind, type PartyMember } from "@/lib/api/campaigns";
import { shrinkImage } from "@/lib/image";
import { COIN_KINDS, formatCoins, isEmpty, shareOut, type Coins } from "@/lib/rules/ledger";
import { cn } from "@/lib/utils";

export const KIND_NAMES: Record<EntryKind, string> = {
  session: "Session",
  npc: "NPC",
  encounter: "Encounter",
  place: "Place",
  faction: "Faction",
  item: "Item",
  handout: "Handout",
  quest: "Quest",
  ledger: "Gold line",
  map: "Map",
  magicitem: "Magic item",
};

export const RARITIES = ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"];

/** The codex: everything with a picture and a status that is not an NPC, encounter, map or magic item. */
export const CODEX_KINDS: EntryKind[] = ["place", "faction", "item", "handout"];

export const textareaClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}

/** Text the players read, kept as written: paragraphs and line breaks, nothing else. */
export function Prose({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return <div className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>{text}</div>;
}

/** The DM's notes, set apart so they are never mistaken for what the players see. */
export function DmNotes({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <EyeOffIcon className="size-3.5" /> DM only
      </p>
      <Prose text={text} />
    </div>
  );
}

const blank = (kind: EntryKind, sort: number, number?: number): EntryInput => ({
  kind,
  title: "",
  number: number ?? null,
  occurredOn: kind === "session" || kind === "ledger" ? new Date().toISOString().slice(0, 10) : null,
  visible: kind === "ledger",
  body: "",
  dmNotes: "",
  imageUrl: null,
  data:
    kind === "ledger"
      ? { coins: {}, to: "party", items: [] }
      : kind === "quest"
        ? { status: "open" }
        : kind === "magicitem"
          ? { rarity: "Uncommon", category: "Wondrous Item", attunement: "" }
          : kind === "encounter"
            ? { status: "planned", location: "", creatures: "" }
            : {},
  sort,
});

/**
 * Adding or changing an entry. Every kind has its title, what the players read, the DM's own notes and whether the
 * players can see it yet (ledger lines always); sessions add a number and date, the codex a picture and status,
 * quests their state, and ledger lines their coins, who they are for and the items.
 */
export function EntryDialog({
  campaignId,
  open,
  onOpenChange,
  kind,
  entry,
  party,
  nextNumber,
  sort,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: EntryKind;
  entry?: CampaignEntry | null;
  party: PartyMember[];
  nextNumber?: number;
  sort: number;
}) {
  const actions = useCampaignActions(campaignId);
  const [form, setForm] = useState<EntryInput>(() =>
    entry ? { ...entry, dmNotes: entry.dmNotes ?? "", data: { ...entry.data } } : blank(kind, sort, kind === "session" ? nextNumber : undefined),
  );
  const [uploading, setUploading] = useState(false);
  const set = (change: Partial<EntryInput>) => setForm((f) => ({ ...f, ...change }));
  const setData = (change: Record<string, unknown>) => setForm((f) => ({ ...f, data: { ...f.data, ...change } }));
  const k = form.kind;
  const coins = (form.data.coins ?? {}) as Coins;
  const direction = Object.values(coins).some((n) => (n ?? 0) < 0) ? -1 : 1;
  const items = (form.data.items as string[] | undefined) ?? [];

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await actions.uploadImage(await shrinkImage(file, 1200));
      set({ imageUrl: url });
    } catch (e) {
      toast.error("Could not upload the picture", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  function save() {
    actions.saveEntry.mutate(
      { ...form, id: entry?.id, visible: k === "ledger" ? true : form.visible },
      {
        onSuccess: () => {
          toast.success(entry ? "Saved" : `${KIND_NAMES[k]} added`);
          onOpenChange(false);
        },
        onError: (e) => toast.error("Could not save", { description: e.message }),
      },
    );
  }

  const titleLabel = k === "session" ? "Title" : k === "ledger" ? "What happened" : k === "quest" ? "Quest" : "Name";
  const bodyLabel =
    k === "session"
      ? "Recap"
      : k === "handout"
        ? "Text of the handout"
        : k === "ledger"
          ? "Note"
          : k === "magicitem"
            ? "What it does (shown on the card)"
            : k === "encounter"
              ? "What the players see (read aloud)"
              : "Description";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{entry ? `Edit ${KIND_NAMES[k].toLowerCase()}` : `New ${KIND_NAMES[k].toLowerCase()}`}</DialogTitle>
          <DialogDescription>
            {k === "ledger" ? "Everyone in the campaign sees ledger lines, so the party fund adds up the same for all." : "What players read is in the text; your secrets go in the DM-only notes."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {CODEX_KINDS.includes(k) && (
            <Field label="Kind">
              <select value={k} onChange={(e) => set({ kind: e.target.value as EntryKind })} disabled={!!entry} className={cn(textareaClass, "h-9")}>
                {CODEX_KINDS.map((x) => (
                  <option key={x} value={x}>
                    {KIND_NAMES[x]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="flex gap-3">
            {k === "session" && (
              <Field label="Number">
                <Input type="number" min={0} className="w-20" value={form.number ?? ""} onChange={(e) => set({ number: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
            )}
            <div className="flex-1">
              <Field label={titleLabel}>
                <Input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} autoFocus />
              </Field>
            </div>
          </div>
          {(k === "session" || k === "ledger") && (
            <Field label="Date" hint="As you like it: 2026-09-28, or an in-world date">
              <Input value={form.occurredOn ?? ""} onChange={(e) => set({ occurredOn: e.target.value })} maxLength={60} />
            </Field>
          )}
          {k === "npc" && (
            <Field label="Who they are" hint="Innkeeper at the Blood on the Vine, Ireena's brother… (players see it)">
              <Input value={(form.data.role as string) ?? ""} onChange={(e) => setData({ role: e.target.value })} maxLength={200} />
            </Field>
          )}
          {k === "encounter" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status">
                <select value={(form.data.status as string) ?? "planned"} onChange={(e) => setData({ status: e.target.value })} className={cn(textareaClass, "h-9")}>
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                  <option value="skipped">Skipped</option>
                </select>
              </Field>
              <Field label="Where">
                <Input value={(form.data.location as string) ?? ""} onChange={(e) => setData({ location: e.target.value })} maxLength={200} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Creatures" hint="One per line: 3 wolves, Ghoul ×2 (players see them once revealed)">
                  <textarea rows={3} className={textareaClass} value={(form.data.creatures as string) ?? ""} onChange={(e) => setData({ creatures: e.target.value.slice(0, 2000) })} />
                </Field>
              </div>
            </div>
          )}
          {(CODEX_KINDS.includes(k) || k === "npc") && (
            <Field label="Status" hint="Alive, dead, ally, destroyed… (players see it)">
              <Input value={(form.data.status as string) ?? ""} onChange={(e) => setData({ status: e.target.value })} maxLength={60} />
            </Field>
          )}
          {k === "magicitem" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rarity">
                <select value={(form.data.rarity as string) ?? ""} onChange={(e) => setData({ rarity: e.target.value })} className={cn(textareaClass, "h-9")}>
                  {RARITIES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Kind of item">
                <Input value={(form.data.category as string) ?? ""} onChange={(e) => setData({ category: e.target.value })} maxLength={100} placeholder="Wondrous Item, Weapon (longsword)…" />
              </Field>
              <Field label="Attunement" hint="Empty for none; 'Yes', or 'by a cleric'">
                <Input value={(form.data.attunement as string) ?? ""} onChange={(e) => setData({ attunement: e.target.value })} maxLength={100} />
              </Field>
              <Field label="Weight (lb)">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={(form.data.weight as number | undefined) ?? ""}
                  onChange={(e) => setData({ weight: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                />
              </Field>
            </div>
          )}
          {k === "quest" && (
            <Field label="Status">
              <select value={(form.data.status as string) ?? "open"} onChange={(e) => setData({ status: e.target.value })} className={cn(textareaClass, "h-9")}>
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
              </select>
            </Field>
          )}
          {k === "ledger" && (
            <>
              <Field label="For">
                <select value={(form.data.to as string) ?? "party"} onChange={(e) => setData({ to: e.target.value })} className={cn(textareaClass, "h-9")}>
                  <option value="party">The party fund</option>
                  {party.filter((p) => !p.missing).map((p) => (
                    <option key={p.characterId} value={p.characterId}>
                      {p.name}
                    </option>
                  ))}
                  <option value="other">Someone else</option>
                </select>
              </Field>
              <div className="space-y-1">
                <span className="text-sm font-medium">Coins</span>
                <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Coming in or going out">
                  {([1, -1] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={direction === d}
                      onClick={() => setData({ coins: Object.fromEntries(Object.entries(coins).map(([c, n]) => [c, Math.abs(n ?? 0) * d])) })}
                      className={cn("rounded px-2.5 py-1 text-sm", direction === d ? "bg-muted font-medium" : "text-muted-foreground")}
                    >
                      {d === 1 ? "Coming in" : "Going out"}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {COIN_KINDS.map((c) => (
                    <label key={c} className="text-center text-xs text-muted-foreground">
                      {c}
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={Math.abs(coins[c] ?? 0) || ""}
                        onChange={(e) => setData({ coins: { ...coins, [c]: Math.trunc(Math.abs(Number(e.target.value) || 0)) * direction } })}
                        className="mt-1 px-1 text-center"
                        aria-label={c}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Items" hint="One per line">
                <textarea
                  rows={3}
                  className={textareaClass}
                  value={items.join("\n")}
                  onChange={(e) => setData({ items: e.target.value.split("\n").map((x) => x.trimStart()).slice(0, 50) })}
                  onBlur={() => setData({ items: items.map((x) => x.trim()).filter(Boolean) })}
                />
              </Field>
            </>
          )}
          <Field label={bodyLabel} hint={k === "ledger" ? undefined : "What the players read once you show it to them"}>
            <textarea rows={k === "session" || k === "handout" ? 7 : 4} className={textareaClass} value={form.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
          <Field label="DM only" hint={k === "encounter" ? "Tactics, treasure, what happens if…: never shown to players" : "Secrets, plans, the beat map: never shown to players"}>
            <textarea rows={4} className={cn(textareaClass, "border-amber-500/50")} value={form.dmNotes} onChange={(e) => set({ dmNotes: e.target.value })} />
          </Field>
          {k !== "ledger" && (
            <div className="flex flex-wrap items-center gap-3">
              {form.imageUrl ? (
                <div className="flex items-center gap-2">
                  <img src={form.imageUrl} alt="" className="h-16 w-16 rounded-md border object-cover" />
                  <Button size="sm" variant="ghost" onClick={() => set({ imageUrl: null })}>
                    <Trash2Icon /> Remove picture
                  </Button>
                </div>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                  <ImagePlusIcon className="size-4" /> {uploading ? "Uploading…" : "Add a picture"}
                  <input type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
                </label>
              )}
            </div>
          )}
          {k !== "ledger" && (
            <button
              type="button"
              onClick={() => set({ visible: !form.visible })}
              className={cn("flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm", form.visible ? "border-primary/60 bg-primary/5" : "")}
              aria-pressed={form.visible}
            >
              {form.visible ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
              {form.visible ? "Players can see this" : "Hidden from players (until you reveal it)"}
            </button>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!form.title.trim() || actions.saveEntry.isPending || uploading}>
              {entry ? "Save" : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sharing out the party fund: each chosen character gets the same whole coins of each kind; what does not divide
 * stays in the fund. Makes one line out of the fund and one line per character.
 */
export function ShareOutDialog({ campaignId, open, onOpenChange, fund, party }: { campaignId: string; open: boolean; onOpenChange: (open: boolean) => void; fund: Coins; party: PartyMember[] }) {
  const actions = useCampaignActions(campaignId);
  const members = party.filter((p) => !p.missing);
  const [chosen, setChosen] = useState<string[]>(members.map((m) => m.characterId));
  const [amount, setAmount] = useState<Coins>(() => Object.fromEntries(Object.entries(fund).filter(([, n]) => (n ?? 0) > 0)) as Coins);
  const [busy, setBusy] = useState(false);
  const [purses, setPurses] = useState(true);
  const { each, remainder } = shareOut(amount, chosen.length);
  const handedOut = Object.fromEntries(Object.entries(each).map(([c, n]) => [c, -(n ?? 0) * chosen.length])) as Coins;
  const date = new Date().toISOString().slice(0, 10);

  async function share() {
    setBusy(true);
    try {
      if (purses) {
        // straight into each one's coin purse, each paid out of the fund (the Gold tab gets both lines)
        for (const id of chosen) {
          await actions.give.mutateAsync({ characterId: id, quantity: 0, coins: each as Record<string, number>, fromFund: true, note: `Share of ${chosen.length}` });
        }
        toast.success("Shared out into their purses");
        onOpenChange(false);
        return;
      }
      const base = { visible: true, body: "", dmNotes: "", imageUrl: null, number: null, occurredOn: date, sort: 0 };
      await actions.saveEntry.mutateAsync({ ...base, kind: "ledger", title: `Shared out among ${chosen.length}`, data: { coins: handedOut, to: "party", items: [] } });
      for (const id of chosen) {
        const name = members.find((m) => m.characterId === id)?.name ?? "a character";
        await actions.saveEntry.mutateAsync({ ...base, kind: "ledger", title: `${name}'s share`, data: { coins: each, to: id, items: [] } });
      }
      toast.success("Shared out");
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not share out", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share out the party fund</DialogTitle>
          <DialogDescription>Each chosen character gets the same whole coins; what does not divide stays in the fund. The fund holds {formatCoins(fund)}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {COIN_KINDS.map((c) => (
              <label key={c} className="text-center text-xs text-muted-foreground">
                {c}
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={amount[c] || ""}
                  onChange={(e) => setAmount({ ...amount, [c]: Math.min(Math.max(0, Math.trunc(Number(e.target.value) || 0)), Math.max(0, fund[c] ?? 0)) })}
                  className="mt-1 px-1 text-center"
                  aria-label={c}
                />
              </label>
            ))}
          </div>
          <div className="space-y-1">
            {members.map((m) => (
              <label key={m.characterId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(m.characterId)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, m.characterId] : chosen.filter((x) => x !== m.characterId))}
                />
                {m.name}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={purses} onChange={(e) => setPurses(e.target.checked)} /> Put each share in their coin purse (on their Equipment tab)
          </label>
          <p className="text-sm">
            Each gets <b>{formatCoins(each)}</b>
            {!isEmpty(remainder) && <>; {formatCoins(remainder)} stays in the fund</>}.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={share} disabled={busy || chosen.length === 0 || isEmpty(each)}>
              Share out
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for a campaign's password; the token it gives is kept in this browser. */
export function UnlockCampaign({ campaignId, name, onUnlocked }: { campaignId: string; name?: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await unlockCampaign(campaignId, password);
      onUnlocked();
    } catch {
      toast.error("That is not the campaign's password");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="mx-auto max-w-sm space-y-3 rounded-lg border p-6 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <LockIcon className="mx-auto size-8 text-muted-foreground" />
      <p className="font-heading text-lg">{name ?? "This campaign"} has a password</p>
      <p className="text-sm text-muted-foreground">Ask your DM for it. This browser remembers it once given.</p>
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Campaign password" aria-label="Campaign password" autoFocus />
      <Button type="submit" className="w-full" disabled={!password || busy}>
        Open
      </Button>
    </form>
  );
}

/**
 * Giving a party member something: one of the campaign's magic items, an item of the books (picked like on the
 * Equipment tab), and/or coins, which can come out of the party fund. It goes straight into their equipment.
 */
export function GiveDialog({
  campaignId,
  open,
  onOpenChange,
  party,
  item,
  book,
  coinsOnly,
}: {
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: PartyMember[];
  item?: CampaignEntry | null;
  book?: { elementId: string; baseElementId?: string | null; name: string } | null;
  coinsOnly?: boolean;
}) {
  const actions = useCampaignActions(campaignId);
  const members = party.filter((p) => !p.missing);
  const [to, setTo] = useState(members[0]?.characterId ?? "");
  const [quantity, setQuantity] = useState(1);
  const [coins, setCoins] = useState<Coins>({});
  const [fromFund, setFromFund] = useState(true);
  const [note, setNote] = useState("");
  const what = item?.title ?? book?.name;

  function give() {
    actions.give.mutate(
      {
        characterId: to,
        campaignItemId: item?.id ?? null,
        elementId: book?.elementId ?? null,
        baseElementId: book?.baseElementId ?? null,
        quantity: what ? quantity : 0,
        coins: Object.fromEntries(Object.entries(coins).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>,
        fromFund,
        note,
      },
      {
        onSuccess: (r) => {
          toast.success(`Gave ${r.given} to ${members.find((m) => m.characterId === to)?.name}`);
          onOpenChange(false);
        },
        onError: (e) => toast.error("Could not give it", { description: e.message }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{what ? `Give ${what}` : "Give coins"}</DialogTitle>
          <DialogDescription>It goes straight into their equipment; they can remove it if they want. The Gold tab records it.</DialogDescription>
        </DialogHeader>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is in the party yet.</p>
        ) : (
          <div className="space-y-4">
            <Field label="To">
              <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(textareaClass, "h-9")}>
                {members.map((m) => (
                  <option key={m.characterId} value={m.characterId}>
                    {m.name}
                    {m.playerName ? ` (${m.playerName})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {what && (
              <Field label="How many">
                <Input type="number" min={1} max={1000} className="w-24" value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(1000, Math.trunc(Number(e.target.value) || 1))))} />
              </Field>
            )}
            <div className="space-y-1">
              <span className="text-sm font-medium">{coinsOnly ? "Coins" : "And coins (optional)"}</span>
              <div className="grid grid-cols-5 gap-2">
                {COIN_KINDS.map((c) => (
                  <label key={c} className="text-center text-xs text-muted-foreground">
                    {c}
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={coins[c] || ""}
                      onChange={(e) => setCoins({ ...coins, [c]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                      className="mt-1 px-1 text-center"
                      aria-label={c}
                    />
                  </label>
                ))}
              </div>
              {!isEmpty(coins) && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={fromFund} onChange={(e) => setFromFund(e.target.checked)} /> Take the coins out of the party fund
                </label>
              )}
            </div>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Found in Death House" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={give} disabled={!to || actions.give.isPending || (!what && isEmpty(coins))}>
                Give
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
