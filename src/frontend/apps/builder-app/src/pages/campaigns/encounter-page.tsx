/**
 * Encounter mode: the DM runs a campaign's encounter as a fight (who is in it, initiative, rounds and turns, hit
 * points, conditions), and players follow it: the order, whose turn it is, how hurt the monsters look and their
 * conditions, never the monsters' hit points or what the DM keeps hidden (the server leaves those out). Players mark
 * conditions on creatures from their Battle Action Simulator, where the conditions then give advantage or
 * disadvantage on their attacks by themselves.
 */
import { ArrowLeftIcon, DicesIcon, EyeIcon, EyeOffIcon, HeartIcon, PlayIcon, PlusIcon, ShieldIcon, SkipForwardIcon, SquareIcon, SwordsIcon, Trash2Icon, XIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { HomebrewStatBlock } from "@/components/homebrew-stat-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CampaignLockedError, useCampaign } from "@/lib/api/campaigns";
import { useChangeFight, useFight } from "@/lib/api/encounters";
import { useHomebrewMonsters } from "@/lib/api/homebrew";
import { creatureStats, type CompendiumLink } from "@/lib/lore/campaign-links";
import { useLoreMeta } from "@/lib/lore/data";
import { health, inOrder, MARKS, nextTurn, type Combatant, type Fight } from "@/lib/rules/encounter";
import { modifier, saveBonuses, type HomebrewMonster } from "@/lib/rules/homebrew";
import { cn } from "@/lib/utils";
import { UnlockCampaign } from "./campaign-dialogs";

const CompendiumPicker = lazy(() => import("@/components/lore/compendium-picker").then((m) => ({ default: m.CompendiumPicker })));

const newId = () => Math.random().toString(36).slice(2, 10);
const d20 = () => 1 + Math.floor(Math.random() * 20);

export function EncounterPage() {
  const { id = "", entryId = "" } = useParams();
  const campaign = useCampaign(id, false);
  const fightQuery = useFight(id, entryId);
  const change = useChangeFight(id, entryId);
  const lore = useLoreMeta();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const homebrew = useHomebrewMonsters(!!campaign.data?.campaign.useHomebrew && !!campaign.data.dm);

  if (campaign.error instanceof CampaignLockedError) {
    return (
      <div className="py-10">
        <UnlockCampaign campaignId={id} onUnlocked={() => void campaign.refetch()} />
      </div>
    );
  }
  if (campaign.error) return <p className="py-10 text-center text-sm text-destructive">{campaign.error.message}</p>;
  if (!campaign.data || fightQuery.isLoading) return <Spinner className="mx-auto my-10 size-5" />;

  const view = campaign.data;
  const dm = fightQuery.data?.dm ?? view.dm;
  const entry = view.entries.find((e) => e.id === entryId);
  const fight = fightQuery.data?.fight ?? null;
  const title = fightQuery.data?.title ?? entry?.title ?? "Encounter";
  const back = (
    <Link to={`/campaigns/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> {view.campaign.name}
    </Link>
  );

  if (!dm && !fight) {
    return (
      <div className="container mx-auto max-w-4xl space-y-4 px-4 py-6">
        {back}
        <p className="text-sm text-muted-foreground">This encounter is not running right now. When the DM starts it, the order of play shows here and in your Battle Action Simulator.</p>
      </div>
    );
  }

  const f = fight ?? { revision: 0, active: false, round: 1, turn: null, shareStats: false, combatants: [] };
  // the change applies to the fight as shown now (read before the change itself shows)
  const apply = (fn: (x: Fight) => Fight) => change.mutate({ change: fn, base: fightQuery.data?.fight ?? f }, { onError: (e) => toast.error(e.message) });
  const order = inOrder(f.combatants);
  const links = ((entry?.data.links as CompendiumLink[] | undefined) ?? []).filter((l) => l.category === "bestiary");

  async function addCreature(link: CompendiumLink, count: number) {
    if (!lore.data) return toast.error("The Compendium is not available.");
    const stats = await creatureStats(lore.data, link).catch(() => null);
    if (!stats) return toast.error(`${link.name}: no stat block found.`);
    apply((x) => {
      const same = x.combatants.filter((c) => c.link?.key === link.key).length;
      const added: Combatant[] = Array.from({ length: count }, (_, i) => ({
        id: newId(),
        kind: "monster",
        name: count + same > 1 ? `${link.name} ${same + i + 1}` : link.name,
        link: { category: link.category, key: link.key, name: link.name },
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        saves: stats.saves,
        initiativeBonus: stats.initiativeBonus,
        initiative: null,
        conditions: [],
      }));
      return { ...x, combatants: [...x.combatants, ...added] };
    });
  }

  function addHomebrew(m: HomebrewMonster, count: number) {
    apply((x) => {
      const same = x.combatants.filter((c) => c.link?.key === m.id).length;
      const added: Combatant[] = Array.from({ length: count }, (_, i) => ({
        id: newId(),
        kind: "monster",
        name: count + same > 1 ? `${m.name} ${same + i + 1}` : m.name,
        link: { category: "homebrew", key: m.id ?? m.name, name: m.name },
        hp: m.hp,
        maxHp: m.hp,
        ac: m.ac,
        saves: saveBonuses(m),
        initiativeBonus: modifier(m.abilities.dex ?? 10),
        initiative: null,
        conditions: [],
      }));
      return { ...x, combatants: [...x.combatants, ...added] };
    });
  }
  const homebrewOf = (c: Combatant) => (c.link?.category === "homebrew" ? homebrew.data?.find((m) => m.id === c.link?.key) : undefined);
  const addParty = () =>
    apply((x) => ({
      ...x,
      combatants: [
        ...x.combatants,
        ...view.party
          .filter((p) => !p.missing && !x.combatants.some((c) => c.characterId === p.characterId))
          .map((p): Combatant => ({ id: newId(), kind: "pc", characterId: p.characterId, name: p.name, initiative: null, conditions: [] })),
      ],
    }));

  const update = (cid: string, patch: Partial<Combatant>) => apply((x) => ({ ...x, combatants: x.combatants.map((c) => (c.id === cid ? { ...c, ...patch } : c)) }));

  return (
    <div className="container mx-auto max-w-5xl space-y-5 px-4 py-6 pb-24">
      {back}
      <header className="flex flex-wrap items-center gap-3">
        <SwordsIcon className="size-6 text-amber-500" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {f.active ? `Round ${f.round}${f.turn ? ` · ${f.combatants.find((c) => c.id === f.turn)?.name ?? ""}'s turn` : ""}` : dm ? "Set up the fight, then start it: players see it in their simulators." : "Not running."}
          </p>
        </div>
        {dm && (
          <div className="flex flex-wrap gap-2">
            {f.active ? (
              <>
                <Button onClick={() => apply(nextTurn)} className="bg-amber-500 text-black hover:bg-amber-400">
                  <SkipForwardIcon /> Next turn
                </Button>
                <Button variant="outline" onClick={() => apply((x) => ({ ...x, active: false, turn: null }))}>
                  <SquareIcon /> End the fight
                </Button>
              </>
            ) : (
              <Button disabled={f.combatants.length === 0} onClick={() => apply((x) => nextTurn({ ...x, active: true, round: 1, turn: null }))} className="bg-amber-500 text-black hover:bg-amber-400">
                <PlayIcon /> Start the fight
              </Button>
            )}
          </div>
        )}
      </header>

      {dm && (
        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={addParty} disabled={view.party.every((p) => p.missing || f.combatants.some((c) => c.characterId === p.characterId))}>
              <PlusIcon /> The party
            </Button>
            {links.map((l) => (
              <AddLinked key={l.key} link={l} onAdd={(n) => void addCreature(l, n)} />
            ))}
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              <PlusIcon /> A creature from the Compendium
            </Button>
            {view.campaign.useHomebrew && homebrew.data && homebrew.data.length > 0 && <AddHomebrew monsters={homebrew.data} onAdd={addHomebrew} />}
            <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
              <PlusIcon /> Your own
            </Button>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              disabled={!f.combatants.some((c) => c.kind !== "pc")}
              onClick={() => apply((x) => ({ ...x, combatants: x.combatants.map((c) => (c.kind !== "pc" && (c.initiative ?? null) === null ? { ...c, initiative: d20() + (c.initiativeBonus ?? 0) } : c)) }))}
            >
              <DicesIcon /> Roll initiative for the creatures
            </Button>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={f.shareStats} onChange={(e) => apply((x) => ({ ...x, shareStats: e.target.checked }))} />
              Players see armor class and saves
            </label>
          </div>
          {adding && (
            <OwnCreature
              onAdd={(c) => {
                apply((x) => ({ ...x, combatants: [...x.combatants, c] }));
                setAdding(false);
              }}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Type the players' initiative rolls in the order below. Players never see a monster's hit points, its notes or what it really is; hide a creature (the eye) until it shows itself.
          </p>
        </section>
      )}

      {order.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one in this fight yet.</p>
      ) : (
        <ol className="space-y-2">
          {order.map((c) => (
            <Row key={c.id} c={c} stats={dm ? homebrewOf(c) : undefined} dm={dm} current={f.active && f.turn === c.id} shareStats={f.shareStats} update={(patch) => update(c.id, patch)} remove={() => apply((x) => ({ ...x, combatants: x.combatants.filter((y) => y.id !== c.id), turn: x.turn === c.id ? null : x.turn }))} />
          ))}
        </ol>
      )}
      {!dm && <p className="text-xs text-muted-foreground">Mark conditions on creatures from your Battle Action Simulator: pick the creature as your target there.</p>}

      {picking && (
        <Suspense fallback={null}>
          <CompendiumPicker
            open
            mode="creatures"
            onOpenChange={(o) => !o && setPicking(false)}
            onPick={(link) => {
              setPicking(false);
              void addCreature(link, 1);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function AddLinked({ link, onAdd }: { link: CompendiumLink; onAdd: (count: number) => void }) {
  const [count, setCount] = useState(1);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm">
      <Input aria-label={`How many ${link.name}`} inputMode="numeric" value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))} className="h-7 w-10 px-1 text-center" />
      <Button size="sm" variant="ghost" className="h-7" onClick={() => onAdd(count)}>
        <PlusIcon /> {link.name}
      </Button>
    </span>
  );
}

/** A homebrew monster (Homebrew page), when the campaign uses homebrew: its HP, AC, saves and initiative filled in. */
function AddHomebrew({ monsters, onAdd }: { monsters: HomebrewMonster[]; onAdd: (m: HomebrewMonster, count: number) => void }) {
  const [id, setId] = useState("");
  const [count, setCount] = useState(1);
  const sorted = [...monsters].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = sorted.find((m) => m.id === id);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm">
      <select aria-label="A homebrew monster" value={id} onChange={(e) => setId(e.target.value)} className="h-7 max-w-44 rounded-md bg-transparent px-1 text-sm">
        <option value="">A homebrew monster…</option>
        {sorted.map((m) => (
          <option key={m.id} value={m.id ?? ""}>
            {m.name}
            {m.cr ? ` (CR ${m.cr})` : ""}
          </option>
        ))}
      </select>
      <Input aria-label="How many" inputMode="numeric" value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))} className="h-7 w-10 px-1 text-center" />
      <Button size="sm" variant="ghost" className="h-7" disabled={!chosen} onClick={() => chosen && onAdd(chosen, count)}>
        <PlusIcon /> Add
      </Button>
    </span>
  );
}

function OwnCreature({ onAdd }: { onAdd: (c: Combatant) => void }) {
  const [name, setName] = useState("");
  const [hp, setHp] = useState("10");
  const [ac, setAc] = useState("12");
  const [init, setInit] = useState("0");
  const n = (s: string) => Number(s.replace(/[^\d-]/g, "")) || 0;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd({ id: newId(), kind: "npc", name: name.trim().slice(0, 100), hp: n(hp), maxHp: n(hp), ac: n(ac), initiativeBonus: n(init), initiative: null, conditions: [] });
      }}
    >
      <label className="text-xs">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-48" />
      </label>
      <label className="text-xs">
        Hit points
        <Input value={hp} onChange={(e) => setHp(e.target.value)} className="h-8 w-20" />
      </label>
      <label className="text-xs">
        AC
        <Input value={ac} onChange={(e) => setAc(e.target.value)} className="h-8 w-16" />
      </label>
      <label className="text-xs">
        Initiative bonus
        <Input value={init} onChange={(e) => setInit(e.target.value)} className="h-8 w-16" />
      </label>
      <Button size="sm" type="submit">
        Add
      </Button>
    </form>
  );
}

const HEALTH_TONE: Record<string, string> = { unhurt: "text-emerald-600", hurt: "text-amber-600", bloodied: "text-red-600", down: "text-muted-foreground line-through" };

function Row({ c, stats, dm, current, shareStats, update, remove }: { c: Combatant; stats?: HomebrewMonster; dm: boolean; current: boolean; shareStats: boolean; update: (p: Partial<Combatant>) => void; remove: () => void }) {
  const [amount, setAmount] = useState("");
  const [showStats, setShowStats] = useState(false);
  const looks = c.kind === "pc" ? null : dm && c.hp !== undefined && c.maxHp !== undefined ? health(c.hp, c.maxHp) : c.health;
  const n = Number(amount) || 0;
  return (
    <li className={cn("rounded-lg border p-2.5", current && "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500", c.hidden && "border-dashed opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        {dm ? (
          <Input aria-label={`${c.name}'s initiative`} inputMode="numeric" value={c.initiative ?? ""} placeholder="init" onChange={(e) => update({ initiative: e.target.value === "" ? null : Number(e.target.value.replace(/[^\d-]/g, "")) || 0 })} className="h-8 w-14 text-center" />
        ) : (
          <span className="w-10 text-center font-mono text-sm">{c.initiative ?? "–"}</span>
        )}
        <span className={cn("font-medium", c.kind === "pc" && "text-sky-700 dark:text-sky-300")}>{c.name}</span>
        {current && <Badge className="bg-amber-500 text-black">Their turn</Badge>}
        {looks && <span className={cn("text-xs font-medium", HEALTH_TONE[looks])}>{looks}</span>}
        {(dm || shareStats) && c.ac != null && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title={c.kind === "pc" ? "From their simulator: armor, magic items and active effects" : undefined}>
            <ShieldIcon className="size-3" /> AC {c.ac}
          </span>
        )}
        {dm && c.kind === "pc" && c.passive != null && <span className="text-xs text-muted-foreground" title="Passive Perception">PP {c.passive}</span>}
        <span className="flex-1" />
        {dm && c.kind === "pc" && <PartyHp c={c} />}
        {dm && c.kind !== "pc" && c.hp !== undefined && (
          <span className="inline-flex items-center gap-1 text-sm">
            <HeartIcon className="size-3.5 text-red-500" />
            <span className="font-mono">
              {c.hp}/{c.maxHp}
            </span>
            <Input aria-label={`Damage or healing for ${c.name}`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="h-7 w-14 text-center" />
            <Button size="sm" variant="outline" className="h-7" disabled={!n} onClick={() => {
                update({ hp: Math.max(0, (c.hp ?? 0) - n) });
                setAmount("");
              }}>
              Hit
            </Button>
            <Button size="sm" variant="outline" className="h-7" disabled={!n} onClick={() => {
                update({ hp: Math.min(c.maxHp ?? 0, (c.hp ?? 0) + n) });
                setAmount("");
              }}>
              Heal
            </Button>
          </span>
        )}
        {stats && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowStats((v) => !v)}>
            {showStats ? "Hide stats" : "Stats"}
          </Button>
        )}
        {dm && (
          <>
            <Button size="icon" variant="ghost" className="size-7" aria-label={c.hidden ? `Show ${c.name} to players` : `Hide ${c.name} from players`} onClick={() => update({ hidden: !c.hidden })}>
              {c.hidden ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${c.name}`} onClick={remove}>
              <Trash2Icon />
            </Button>
          </>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {c.conditions.map((k) => (
          <span key={k.name} title={[MARKS.find((m) => m.name === k.name)?.note, k.fromSheet ? (k.name === "Concentrating" ? `concentrating ${k.by}` : "set by the player in their simulator") : k.by && `marked by ${k.by}`].filter(Boolean).join(" · ")} className={cn("inline-flex items-center gap-1 rounded-full border border-violet-400/50 bg-violet-500/10 px-2 py-0.5 text-xs", k.fromSheet && "border-dashed")}>
            {k.name}
            {dm && !k.fromSheet && (
              <button type="button" aria-label={`Take ${k.name} off ${c.name}`} onClick={() => update({ conditions: c.conditions.filter((x) => x.name !== k.name) })}>
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
        {dm && (
          <select
            aria-label={`Add a condition to ${c.name}`}
            value=""
            onChange={(e) => e.target.value && update({ conditions: [...c.conditions, { name: e.target.value, by: "DM" }] })}
            className="h-7 rounded-md border bg-transparent px-1 text-xs text-muted-foreground"
          >
            <option value="">+ condition</option>
            {MARKS.filter((m) => !c.conditions.some((k) => k.name === m.name)).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {dm && c.notes !== undefined && <span className="text-xs text-muted-foreground">{c.notes}</span>}
      </div>
      {stats && showStats && (
        <div className="mt-2 rounded-md border bg-background/60 p-2">
          <HomebrewStatBlock monster={stats} />
        </div>
      )}
    </li>
  );
}

/**
 * A player character's hit points as their own simulator has them (refreshed every few seconds): current of
 * maximum, temporary hit points, and death saves at 0. Unknown until the player opens their simulator once.
 */
function PartyHp({ c }: { c: Combatant }) {
  if (c.hp === undefined || c.maxHp === undefined) {
    return <span className="text-xs text-muted-foreground">HP shows once they open their simulator</span>;
  }
  const share = c.maxHp > 0 ? c.hp / c.maxHp : 0;
  const tone = c.hp <= 0 ? "bg-zinc-500" : share <= 0.5 ? "bg-red-500" : share < 1 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title="From the player's simulator">
      <HeartIcon className="size-3.5 text-red-500" />
      <span className="font-mono">
        {c.hp}/{c.maxHp}
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full", tone)} style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
      </span>
      {!!c.tempHp && <span className="rounded bg-sky-500/15 px-1 text-xs text-sky-700 dark:text-sky-300">+{c.tempHp} temp</span>}
      {c.hp <= 0 && c.deathSaves && (
        <span className="text-xs text-muted-foreground">
          death saves {c.deathSaves.successes}✓ {c.deathSaves.failures}✗
        </span>
      )}
    </span>
  );
}
