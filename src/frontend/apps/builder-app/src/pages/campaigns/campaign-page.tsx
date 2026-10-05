import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CoinsIcon, CrownIcon, EyeIcon, EyeOffIcon, LockIcon, PencilIcon, PlusIcon, ScrollTextIcon, SearchIcon, SettingsIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api-client";
import { CampaignLockedError, unlockCampaignDm, useCampaign, useCampaignActions, type CampaignEntry, type CampaignView, type EntryKind, type PartyMember } from "@/lib/api/campaigns";
import { shrinkImage } from "@/lib/image";
import type { CompendiumLink } from "@/lib/lore/campaign-links";
import { formatCoins, gpValue, ledgerRows, partyFund, totalsByRecipient, type LedgerLine } from "@/lib/rules/ledger";
import { normalizeText } from "@/lib/rules/picker";
import { cn } from "@/lib/utils";
import { ItemPicker } from "@/components/item-picker";
import { CODEX_KINDS, DmNotes, EntryDialog, GiveDialog, KIND_NAMES, Prose, ShareOutDialog, textareaClass, UnlockCampaign } from "./campaign-dialogs";
import { PartySummary } from "./party-summary";

type Editing = { kind: EntryKind; entry?: CampaignEntry | null } | null;

/**
 * A campaign: its party and, in tabs, the sessions, the codex (people, places, factions, items, handouts), quests
 * and the ledger. The DM (master password) adds and edits everything and can look at it as a player sees it, which
 * asks the server as a player would; players see what the DM revealed and never the DM's notes.
 */
export function CampaignPage() {
  const { id = "" } = useParams();
  const [asPlayer, setAsPlayer] = useState(false);
  const own = useCampaign(id, false);
  const player = useCampaign(id, true);
  const query = asPlayer ? player : own;
  const [editing, setEditing] = useState<Editing>(null);
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState("sessions");

  if (query.error instanceof CampaignLockedError) {
    return (
      <div className="py-10">
        <UnlockCampaign campaignId={id} onUnlocked={() => void own.refetch()} />
      </div>
    );
  }
  if (query.error) return <p className="py-10 text-center text-sm text-destructive">{query.error.message}</p>;
  if (!query.data) return <Spinner className="mx-auto my-10 size-5" />;

  const view = query.data;
  const dm = own.data?.dm === true;
  const canEdit = dm && !asPlayer;
  const edit = (kind: EntryKind, entry?: CampaignEntry | null) => setEditing({ kind, entry });
  const nextSession = Math.max(0, ...view.entries.filter((e) => e.kind === "session").map((e) => e.number ?? 0)) + 1;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Campaigns
      </Link>

      <header className="space-y-4">
        {view.campaign.coverUrl && <img src={view.campaign.coverUrl} alt="" className="max-h-56 w-full rounded-lg border object-cover" />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-heading text-3xl tracking-wide">
              {view.campaign.name}
              {view.campaign.locked && <LockIcon className="size-5 text-muted-foreground" aria-label="Has a password" />}
            </h1>
            {view.campaign.dmName && <p className="text-sm text-muted-foreground">DM: {view.campaign.dmName}</p>}
            <Prose text={view.campaign.description} className="mt-1 text-muted-foreground" />
          </div>
          {!dm && view.campaign.hasDmPassword && <BecomeDm campaignId={id} onDone={() => void own.refetch()} />}
          {dm && (
            <div className="flex flex-wrap gap-2">
              <Button variant={asPlayer ? "default" : "outline"} size="sm" onClick={() => setAsPlayer(!asPlayer)} aria-pressed={asPlayer}>
                {asPlayer ? <EyeIcon /> : <EyeOffIcon />} {asPlayer ? "Seeing it as a player" : "View as player"}
              </Button>
              {!asPlayer && (
                <Button variant="outline" size="sm" onClick={() => setSettings(true)}>
                  <SettingsIcon /> Campaign settings
                </Button>
              )}
            </div>
          )}
        </div>
        <Party party={view.party} />
      </header>

      <Tabs value={!canEdit && tab === "party" ? "sessions" : tab} onValueChange={setTab}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {canEdit && <TabsTrigger value="party">Party</TabsTrigger>}
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="npcs">NPCs</TabsTrigger>
          <TabsTrigger value="encounters">Encounters</TabsTrigger>
          <TabsTrigger value="codex">Codex</TabsTrigger>
          <TabsTrigger value="quests">Quests</TabsTrigger>
          <TabsTrigger value="maps">Maps</TabsTrigger>
          <TabsTrigger value="items">Magic items</TabsTrigger>
          <TabsTrigger value="gold">Gold</TabsTrigger>
        </TabsList>
        {canEdit && (
          <TabsContent value="party" className="mt-4">
            <PartySummary party={view.party} />
          </TabsContent>
        )}
        <TabsContent value="sessions" className="mt-4">
          <Sessions view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
        <TabsContent value="npcs" className="mt-4">
          <Codex view={view} canEdit={canEdit} onEdit={edit} kinds={["npc"]} />
        </TabsContent>
        <TabsContent value="encounters" className="mt-4">
          <Encounters view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
        <TabsContent value="codex" className="mt-4">
          <Codex view={view} canEdit={canEdit} onEdit={edit} kinds={CODEX_KINDS} />
        </TabsContent>
        <TabsContent value="quests" className="mt-4">
          <Quests view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
        <TabsContent value="maps" className="mt-4">
          <Maps view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
        <TabsContent value="items" className="mt-4">
          <MagicItems view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
        <TabsContent value="gold" className="mt-4">
          <Ledger view={view} canEdit={canEdit} onEdit={edit} />
        </TabsContent>
      </Tabs>

      {editing && (
        <EntryDialog
          key={editing.entry?.id ?? editing.kind}
          campaignId={id}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          kind={editing.kind}
          entry={editing.entry}
          party={view.party}
          nextNumber={nextSession}
          sort={view.entries.length}
        />
      )}
      {settings && <CampaignSettings view={view} onClose={() => setSettings(false)} />}
    </div>
  );
}

function Party({ party }: { party: PartyMember[] }) {
  if (party.length === 0) return <p className="text-sm text-muted-foreground">No characters in the party yet. Players add theirs from their character's page (Campaigns).</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {party.map((m) => {
        const card = (
          <span className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5", m.missing && "opacity-60")}>
            {m.portraitUrl ? (
              <img src={m.portraitUrl} alt="" className="size-9 rounded-md object-cover" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                {m.locked ? <LockIcon className="size-4 text-muted-foreground" /> : <UsersIcon className="size-4 text-muted-foreground" />}
              </span>
            )}
            <span className="text-sm leading-tight">
              <span className="block font-medium">{m.name}</span>
              <span className="block text-xs text-muted-foreground">
                {m.missing ? "removed from Starlights" : [m.build && `${m.build}${m.level ? ` ${m.level}` : ""}`, m.playerName].filter(Boolean).join(" · ")}
              </span>
            </span>
          </span>
        );
        return m.missing || m.locked ? (
          <span key={m.characterId}>{card}</span>
        ) : (
          <Link key={m.characterId} to={`/characters/${m.characterId}/sheet`} className="hover:opacity-80">
            {card}
          </Link>
        );
      })}
    </div>
  );
}

interface TabProps {
  view: CampaignView;
  canEdit: boolean;
  onEdit: (kind: EntryKind, entry?: CampaignEntry | null) => void;
}

const CompendiumLinks = lazy(() => import("@/components/lore/compendium-picker").then((m) => ({ default: m.CompendiumLinks })));

/** An entry's links into the Compendium of Lore, with previews (players see them once the entry is revealed). */
function EntryLinks({ entry }: { entry: CampaignEntry }) {
  const links = entry.data.links as CompendiumLink[] | undefined;
  if (!links?.length) return null;
  return (
    <Suspense fallback={null}>
      <CompendiumLinks links={links} className="mt-2" />
    </Suspense>
  );
}

function HiddenBadge({ entry, canEdit }: { entry: CampaignEntry; canEdit: boolean }) {
  if (!canEdit || entry.visible) return null;
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-400">
      <EyeOffIcon className="size-3" /> hidden from players
    </Badge>
  );
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="icon-sm" variant="ghost" onClick={onClick} aria-label={label} className="ms-auto shrink-0">
      <PencilIcon />
    </Button>
  );
}

function Sessions({ view, canEdit, onEdit }: TabProps) {
  const sessions = view.entries.filter((e) => e.kind === "session").sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  return (
    <div className="space-y-3">
      {canEdit && (
        <Button size="sm" onClick={() => onEdit("session")}>
          <PlusIcon /> Add a session
        </Button>
      )}
      {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
      {sessions.map((s) => (
        <article key={s.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg">
              {s.number != null && <span className="text-muted-foreground">Session {s.number} · </span>}
              {s.title}
            </h3>
            {s.occurredOn && <span className="text-xs text-muted-foreground">{s.occurredOn}</span>}
            <HiddenBadge entry={s} canEdit={canEdit} />
            {canEdit && <EditButton onClick={() => onEdit("session", s)} label={`Edit ${s.title}`} />}
          </div>
          {s.imageUrl && <img src={s.imageUrl} alt="" className="mt-3 max-h-64 rounded-md border object-cover" />}
          <Prose text={s.body} className="mt-2" />
          <EntryLinks entry={s} />
          <DmNotes text={s.dmNotes} />
        </article>
      ))}
    </div>
  );
}

/** A searchable grid of entries with pictures: the NPCs, or the codex's places, factions, items and handouts. */
function Codex({ view, canEdit, onEdit, kinds }: TabProps & { kinds: EntryKind[] }) {
  const [kind, setKind] = useState<EntryKind | "all">("all");
  const CODEX_KINDS = kinds;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<CampaignEntry | null>(null);
  const q = normalizeText(query);
  const entries = view.entries
    .filter((e) => CODEX_KINDS.includes(e.kind) && (kind === "all" || e.kind === kind))
    .filter((e) => !q || normalizeText(`${e.title} ${e.body} ${e.data.status ?? ""}`).includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {CODEX_KINDS.length > 1 && (["all", ...CODEX_KINDS] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn("rounded-full border px-3 py-1 text-sm", kind === k ? "border-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}
          >
            {k === "all" ? "All" : `${KIND_NAMES[k]}s`}
          </button>
        ))}
        <div className="relative min-w-40 flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-8 pl-8" aria-label="Search the codex" />
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => onEdit(kind === "all" ? CODEX_KINDS[0] : kind)}>
            <PlusIcon /> {CODEX_KINDS.length === 1 ? `Add an ${KIND_NAMES[CODEX_KINDS[0]]}` : "Add"}
          </Button>
        )}
      </div>
      {entries.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <button key={e.id} type="button" onClick={() => setOpen(e)} className="flex gap-3 rounded-lg border p-3 text-left hover:bg-muted/50">
            {e.imageUrl ? (
              <img src={e.imageUrl} alt="" className="size-16 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
                <ScrollTextIcon className="size-5 text-muted-foreground" />
              </span>
            )}
            <span className="min-w-0 space-y-1">
              <span className="block font-medium">{e.title}</span>
              {typeof e.data.role === "string" && e.data.role && <span className="block text-xs text-muted-foreground">{e.data.role}</span>}
              <span className="flex flex-wrap gap-1">
                {CODEX_KINDS.length > 1 && <Badge variant="secondary">{KIND_NAMES[e.kind]}</Badge>}
                {typeof e.data.status === "string" && e.data.status && <Badge variant="outline">{e.data.status}</Badge>}
                <HiddenBadge entry={e} canEdit={canEdit} />
              </span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">{e.body}</span>
            </span>
          </button>
        ))}
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
              <DialogDescription>
                {[KIND_NAMES[open.kind], open.data.role, open.data.status].filter((x) => typeof x === "string" && x).join(" · ")}
              </DialogDescription>
            </DialogHeader>
            {open.imageUrl && <img src={open.imageUrl} alt="" className="max-h-80 w-full rounded-md border object-contain" />}
            <Prose text={open.body} />
            <EntryLinks entry={open} />
            <DmNotes text={open.dmNotes} />
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => {
                  onEdit(open.kind, open);
                  setOpen(null);
                }}
              >
                <PencilIcon /> Edit
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const ENCOUNTER_STATES = [
  ["planned", "Planned"],
  ["done", "Done"],
  ["skipped", "Skipped"],
] as const;

/** Encounters: what the players see, the creatures and where; the DM's tactics apart. */
function Encounters({ view, canEdit, onEdit }: TabProps) {
  const encounters = view.entries.filter((e) => e.kind === "encounter");
  return (
    <div className="space-y-4">
      {canEdit && (
        <Button size="sm" onClick={() => onEdit("encounter")}>
          <PlusIcon /> Add an encounter
        </Button>
      )}
      {encounters.length === 0 && <p className="text-sm text-muted-foreground">No encounters yet.</p>}
      {ENCOUNTER_STATES.map(([state, title]) => {
        const list = encounters.filter((e) => (e.data.status ?? "planned") === state).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
        if (list.length === 0) return null;
        return (
          <section key={state} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
            {list.map((e) => (
              <article key={e.id} className={cn("flex gap-3 rounded-lg border p-3", state !== "planned" && "opacity-80")}>
                {e.imageUrl && <img src={e.imageUrl} alt="" className="size-24 shrink-0 rounded-md border object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-medium">{e.title}</h4>
                    {typeof e.data.location === "string" && e.data.location && <span className="text-xs text-muted-foreground">{e.data.location}</span>}
                    <HiddenBadge entry={e} canEdit={canEdit} />
                    {canEdit && <EditButton onClick={() => onEdit("encounter", e)} label={`Edit ${e.title}`} />}
                  </div>
                  {typeof e.data.creatures === "string" && e.data.creatures.trim() && (
                    <p className="mt-1 text-sm">
                      <span className="text-muted-foreground">Creatures: </span>
                      {e.data.creatures.split("\n").map((c) => c.trim()).filter(Boolean).join(", ")}
                    </p>
                  )}
                  <Prose text={e.body} className="mt-1" />
                  <EntryLinks entry={e} />
                  <DmNotes text={e.dmNotes} />
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const QUEST_STATES = [
  ["open", "Open"],
  ["done", "Done"],
  ["failed", "Failed"],
] as const;

function Quests({ view, canEdit, onEdit }: TabProps) {
  const quests = view.entries.filter((e) => e.kind === "quest");
  return (
    <div className="space-y-4">
      {canEdit && (
        <Button size="sm" onClick={() => onEdit("quest")}>
          <PlusIcon /> Add a quest
        </Button>
      )}
      {quests.length === 0 && <p className="text-sm text-muted-foreground">No quests yet.</p>}
      {QUEST_STATES.map(([state, title]) => {
        const list = quests.filter((q) => (q.data.status ?? "open") === state);
        if (list.length === 0) return null;
        return (
          <section key={state} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
            {list.map((q) => (
              <article key={q.id} className={cn("rounded-lg border p-3", state !== "open" && "opacity-75")}>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className={cn("font-medium", state === "done" && "line-through decoration-muted-foreground/60")}>{q.title}</h4>
                  <HiddenBadge entry={q} canEdit={canEdit} />
                  {canEdit && <EditButton onClick={() => onEdit("quest", q)} label={`Edit ${q.title}`} />}
                </div>
                <Prose text={q.body} className="mt-1" />
                <EntryLinks entry={q} />
                <DmNotes text={q.dmNotes} />
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function toLine(e: CampaignEntry): LedgerLine {
  return {
    id: e.id,
    title: e.title,
    occurredOn: e.occurredOn,
    sort: e.sort,
    coins: (e.data.coins ?? {}) as LedgerLine["coins"],
    to: typeof e.data.to === "string" ? e.data.to : "party",
    items: Array.isArray(e.data.items) ? (e.data.items as string[]) : [],
  };
}

function Ledger({ view, canEdit, onEdit }: TabProps) {
  const entries = useMemo(() => view.entries.filter((e) => e.kind === "ledger"), [view.entries]);
  const lines = useMemo(() => entries.map(toLine), [entries]);
  const rows = ledgerRows(lines);
  const fund = partyFund(lines);
  const totals = totalsByRecipient(lines);
  const [sharing, setSharing] = useState(false);
  const [givingCoins, setGivingCoins] = useState(false);
  const nameOf = (to: string) => (to === "party" ? "Party fund" : to === "other" ? "Someone else" : (view.party.find((p) => p.characterId === to)?.name ?? "A character no longer in the party"));
  const byId = new Map(entries.map((e) => [e.id, e]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="rounded-lg border px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CoinsIcon className="size-3.5" /> Party fund
          </p>
          <p className="text-xl font-semibold tabular-nums">{formatCoins(fund)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">worth {gpValue(fund).toLocaleString("en")} gp</p>
        </div>
        {view.party
          .filter((p) => totals.has(p.characterId))
          .map((p) => {
            const t = totals.get(p.characterId)!;
            return (
              <div key={p.characterId} className="rounded-lg border px-4 py-3">
                <p className="text-xs text-muted-foreground">{p.name} has had</p>
                <p className="font-medium tabular-nums">{formatCoins(t.coins)}</p>
                {t.items.length > 0 && <p className="max-w-56 truncate text-xs text-muted-foreground">{t.items.join(", ")}</p>}
              </div>
            );
          })}
        {canEdit && (
          <div className="ms-auto flex flex-wrap items-start gap-2">
            <Button size="sm" onClick={() => onEdit("ledger")}>
              <PlusIcon /> Add a line
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSharing(true)} disabled={view.party.length === 0 || gpValue(fund) <= 0}>
              Share out the fund
            </Button>
            <Button size="sm" variant="outline" onClick={() => setGivingCoins(true)} disabled={view.party.length === 0}>
              Give coins
            </Button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ledger lines yet: treasure found, coins spent, shares handed out.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 font-medium">For</th>
                <th className="px-3 py-2 text-right font-medium">Coins</th>
                <th className="px-3 py-2 font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Fund after</th>
                <th className="px-3 py-2 text-right font-medium">≈ gp</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ line, balance, balanceGp }) => {
                const entry = byId.get(line.id)!;
                const gp = gpValue(line.coins);
                return (
                  <tr key={line.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{line.occurredOn}</td>
                    <td className="px-3 py-2">
                      {line.title}
                      {entry.body && <span className="block text-xs text-muted-foreground">{entry.body}</span>}
                      {entry.dmNotes && <span className="block text-xs text-amber-700 dark:text-amber-400">DM: {entry.dmNotes}</span>}
                    </td>
                    <td className="px-3 py-2">{nameOf(line.to)}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", gp < 0 ? "text-destructive" : gp > 0 ? "text-green-700 dark:text-green-400" : "")}>
                      {formatCoins(line.coins, true)}
                    </td>
                    <td className="px-3 py-2 text-xs">{line.items.join(", ")}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.to === "party" ? formatCoins(balance) : ""}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{line.to === "party" ? balanceGp.toLocaleString("en") : ""}</td>
                    {canEdit && (
                      <td className="px-1 py-1">
                        <EditButton onClick={() => onEdit("ledger", entry)} label={`Edit ${line.title}`} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sharing && <ShareOutDialog campaignId={view.campaign.id} open onOpenChange={setSharing} fund={fund} party={view.party} />}
      {givingCoins && <GiveDialog campaignId={view.campaign.id} open onOpenChange={setGivingCoins} party={view.party} coinsOnly />}
    </div>
  );
}

/** Maps of the campaign, each shown to the players once the DM reveals it. */
function Maps({ view, canEdit, onEdit }: TabProps) {
  const maps = view.entries.filter((e) => e.kind === "map").sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const [open, setOpen] = useState<CampaignEntry | null>(null);
  return (
    <div className="space-y-3">
      {canEdit && (
        <Button size="sm" onClick={() => onEdit("map")}>
          <PlusIcon /> Add a map
        </Button>
      )}
      {maps.length === 0 && <p className="text-sm text-muted-foreground">No maps yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {maps.map((m) => (
          <figure key={m.id} className="overflow-hidden rounded-lg border">
            <button type="button" onClick={() => setOpen(m)} className="block w-full" aria-label={`Open the map ${m.title}`}>
              {m.imageUrl ? <img src={m.imageUrl} alt={m.title} className="aspect-video w-full object-cover" /> : <span className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">No picture yet</span>}
            </button>
            <figcaption className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium">{m.title}</span>
              <HiddenBadge entry={m} canEdit={canEdit} />
              {canEdit && <EditButton onClick={() => onEdit("map", m)} label={`Edit ${m.title}`} />}
              <Prose text={m.body} className="w-full text-muted-foreground" />
              <EntryLinks entry={m} />
              <div className="w-full">
                <DmNotes text={m.dmNotes} />
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-h-[95dvh] w-[min(96vw,1400px)] max-w-none overflow-auto sm:max-w-none">
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
              <DialogDescription>
                {open.imageUrl && (
                  <a href={open.imageUrl} target="_blank" rel="noreferrer" className="underline">
                    Open full size
                  </a>
                )}
              </DialogDescription>
            </DialogHeader>
            {open.imageUrl && <img src={open.imageUrl} alt={open.title} className="w-full rounded-md" />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The campaign's own magic items (the DM's homebrew, with pictures), which never show up when players build
 * characters; the DM gives them (or items of the books) to party members, straight into their equipment.
 */
function MagicItems({ view, canEdit, onEdit }: TabProps) {
  const items = view.entries.filter((e) => e.kind === "magicitem").sort((a, b) => a.title.localeCompare(b.title));
  const [giving, setGiving] = useState<CampaignEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const [book, setBook] = useState<{ elementId: string; baseElementId?: string | null; name: string } | null>(null);
  const [open, setOpen] = useState<CampaignEntry | null>(null);
  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onEdit("magicitem")}>
            <PlusIcon /> New magic item
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPicking(true)} disabled={view.party.length === 0}>
            Give an item from the books
          </Button>
        </div>
      )}
      {items.length === 0 && <p className="text-sm text-muted-foreground">{canEdit ? "Make your own magic items here; they stay in this campaign." : "No magic items revealed yet."}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <article key={it.id} className="flex flex-col rounded-lg border">
            <button type="button" onClick={() => setOpen(it)} className="flex gap-3 p-3 text-left">
              {it.imageUrl ? (
                <img src={it.imageUrl} alt="" className="size-20 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex size-20 shrink-0 items-center justify-center rounded-md bg-muted">
                  <ScrollTextIcon className="size-5 text-muted-foreground" />
                </span>
              )}
              <span className="min-w-0 space-y-1">
                <span className="block font-medium">{it.title}</span>
                <span className="block text-xs italic text-muted-foreground">
                  {[it.data.category, it.data.rarity, it.data.attunement ? `requires attunement${/^yes$/i.test(String(it.data.attunement)) ? "" : ` ${it.data.attunement}`}` : null]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {canEdit && typeof it.data.bookName === "string" && <span className="block text-xs text-muted-foreground">Given as {it.data.bookName}</span>}
                <HiddenBadge entry={it} canEdit={canEdit} />
                <span className="line-clamp-2 block text-xs text-muted-foreground">{it.body}</span>
              </span>
            </button>
            {canEdit && (
              <div className="mt-auto flex gap-2 border-t p-2">
                <Button size="sm" variant="outline" onClick={() => setGiving(it)} disabled={view.party.length === 0}>
                  Give to…
                </Button>
                <EditButton onClick={() => onEdit("magicitem", it)} label={`Edit ${it.title}`} />
              </div>
            )}
          </article>
        ))}
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
              <DialogDescription>{[open.data.category, open.data.rarity].filter(Boolean).join(", ")}</DialogDescription>
            </DialogHeader>
            {open.imageUrl && <img src={open.imageUrl} alt="" className="max-h-80 w-full rounded-md border object-contain" />}
            <Prose text={open.body} />
            <EntryLinks entry={open} />
            <DmNotes text={open.dmNotes} />
          </DialogContent>
        </Dialog>
      )}
      {giving && <GiveDialog campaignId={view.campaign.id} open onOpenChange={(o) => !o && setGiving(null)} party={view.party} item={giving} />}
      {book && <GiveDialog campaignId={view.campaign.id} open onOpenChange={(o) => !o && setBook(null)} party={view.party} book={book} />}
      <ItemPicker
        open={picking}
        onOpenChange={setPicking}
        restrictedSources={[]}
        onAdd={(add) => {
          if (!add.item) {
            toast.info("Make your own items with \"New magic item\": they get a picture and stay in this campaign.");
            return;
          }
          setPicking(false);
          setBook({ elementId: add.item.id, baseElementId: add.baseElementId ?? null, name: add.item.name });
        }}
      />
    </div>
  );
}

/** Name, description, cover, party, password; deleting the campaign. */
/** The campaign's DM on another device: their DM password makes this browser run the campaign too. */
function BecomeDm({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await unlockCampaignDm(campaignId, password);
      toast.success("You run this campaign on this device now");
      setOpen(false);
      onDone();
    } catch {
      toast.error("That is not the DM password");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CrownIcon /> I'm the DM
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Run this campaign here</DialogTitle>
            <DialogDescription>Give the DM password chosen when the campaign was started.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-label="DM password" />
            <Button type="submit" className="w-full" disabled={!password || busy}>
              Open as the DM
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CampaignSettings({ view, onClose }: { view: CampaignView; onClose: () => void }) {
  const navigate = useNavigate();
  const actions = useCampaignActions(view.campaign.id);
  const [name, setName] = useState(view.campaign.name);
  const [description, setDescription] = useState(view.campaign.description);
  const [coverUrl, setCoverUrl] = useState(view.campaign.coverUrl ?? null);
  const [party, setParty] = useState<string[]>(view.campaign.party);
  const [password, setPassword] = useState("");
  const [dmName, setDmName] = useState(view.campaign.dmName ?? "");
  const [dmPassword, setDmPassword] = useState("");
  const characters = useQuery({
    queryKey: ["campaign-settings-characters"],
    queryFn: () => apiClient.get<{ characters: { characterId: string; name: string; playerName: string }[] }>("/api/characters"),
  });
  const failed = (e: Error) => toast.error("Could not save", { description: e.message });

  async function cover(file: File | undefined) {
    if (!file) return;
    try {
      setCoverUrl((await actions.uploadImage(await shrinkImage(file, 1600))).url);
    } catch (e) {
      failed(e as Error);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Campaign settings</DialogTitle>
          <DialogDescription>Players see the name, description, cover and party.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            Description
            <textarea rows={4} className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="flex items-center gap-2 text-sm">
            {coverUrl && <img src={coverUrl} alt="" className="h-12 w-20 rounded border object-cover" />}
            <label className="cursor-pointer rounded-md border px-3 py-1.5 hover:bg-muted">
              {coverUrl ? "Change cover" : "Add a cover picture"}
              <input type="file" accept="image/*" hidden onChange={(e) => cover(e.target.files?.[0])} />
            </label>
            {coverUrl && (
              <Button size="sm" variant="ghost" onClick={() => setCoverUrl(null)}>
                Remove
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Party</p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {(characters.data?.characters ?? []).map((c) => (
                <label key={c.characterId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={party.includes(c.characterId)}
                    onChange={(e) => setParty(e.target.checked ? [...party, c.characterId] : party.filter((x) => x !== c.characterId))}
                  />
                  {c.name} <span className="text-xs text-muted-foreground">{c.playerName}</span>
                </label>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!name.trim() || actions.update.isPending}
            onClick={() =>
              actions.update.mutate(
                { name, description, coverUrl, party },
                {
                  onSuccess: () => {
                    toast.success("Saved");
                    onClose();
                  },
                  onError: failed,
                },
              )
            }
          >
            Save
          </Button>

          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <LockIcon className="size-4" /> Password {view.campaign.locked ? "(set)" : "(none: anyone on the site can read what you revealed)"}
            </p>
            <p className="text-xs text-muted-foreground">With a password, players give it once to read the campaign or add their character. You always get in.</p>
            <div className="flex gap-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (6+ characters)" aria-label="Campaign password" />
              <Button
                variant="outline"
                disabled={password.length < 6}
                onClick={() => actions.setPassword.mutate(password, { onSuccess: () => (toast.success("Password set"), setPassword("")), onError: failed })}
              >
                Set
              </Button>
            </div>
            {view.campaign.locked && (
              <Button size="sm" variant="ghost" onClick={() => actions.setPassword.mutate("", { onSuccess: () => toast.success("Password removed"), onError: failed })}>
                Remove the password
              </Button>
            )}
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CrownIcon className="size-4" /> The DM
            </p>
            <p className="text-xs text-muted-foreground">
              Whoever has the DM password runs this campaign (“I'm the DM” on its page). Change it to hand the campaign over, or if a player has seen it.
              {view.campaign.hasDmPassword ? "" : " There is none yet: only the site's admin runs it."}
            </p>
            <Input value={dmName} onChange={(e) => setDmName(e.target.value)} maxLength={100} placeholder="The DM's name (everyone sees it)" aria-label="The DM's name" />
            <Input type="password" autoComplete="new-password" value={dmPassword} onChange={(e) => setDmPassword(e.target.value)} placeholder="New DM password (6+ characters; empty keeps it)" aria-label="New DM password" />
            <Button
              variant="outline"
              size="sm"
              disabled={(dmPassword.length > 0 && dmPassword.length < 6) || actions.setDm.isPending}
              onClick={() => actions.setDm.mutate({ name: dmName, password: dmPassword }, { onSuccess: () => (toast.success("Saved"), setDmPassword("")), onError: failed })}
            >
              Save the DM
            </Button>
          </div>

          <Button
            variant="ghost"
            className="w-full text-destructive"
            onClick={() => {
              if (!window.confirm(`Delete "${view.campaign.name}" with all its sessions, codex, quests and ledger? This cannot be undone.`)) return;
              actions.remove.mutate(undefined, { onSuccess: () => navigate("/campaigns"), onError: failed });
            }}
          >
            <Trash2Icon /> Delete the campaign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
