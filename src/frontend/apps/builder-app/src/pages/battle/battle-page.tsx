/**
 * The Battle Action Simulator for one character: its hit points, defenses and resources, what it can do with its
 * action, bonus action, reaction and movement this turn (with real attack and damage numbers), its spells at any
 * slot level, and short and long rests. Everything comes from the character sheet (lib/api/sheet) and the
 * Magic tab's spellcasting; what happens in the fight is saved with the character (lib/api/combat, lib/api/magic).
 */
import {
  ArrowLeftIcon,
  BedDoubleIcon,
  BrainIcon,
  CoffeeIcon,
  CrosshairIcon,
  FileTextIcon,
  FootprintsIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldIcon,
  SparklesIcon,
  SwordIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { LoreLink } from "@/components/lore/lore-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCombat, useSaveCombat } from "@/lib/api/combat";
import { useActiveFights, useMarkFight, type FightView } from "@/lib/api/encounters";
import { useInventory, useSaveInventory } from "@/lib/api/inventory";
import { useMagic, useSaveMagic, useSpellcasting } from "@/lib/api/magic";
import { useSheetData, type SheetData } from "@/lib/api/sheet";
import { buildBattleModel, type BattleFeature, type BattleModel, type BattleSpell, type Slot, type WeaponAttack } from "@/lib/battle-model";
import { useLoreLookup } from "@/lib/lore/lookup";
import { attackRoll, failChanceWith, inOrder, MARKS, targetSave, type AttackRoll, type Combatant, type FightCondition } from "@/lib/rules/encounter";
import {
  average,
  averageGreatWeapon,
  effectFor,
  effectiveArmorClass,
  effectiveSpeed,
  hitChanceWithDie,
  PICKABLE_EFFECTS,
  SELF_SPELLS,
  type BattleEffect,
  type Roll,
  CONDITIONS,
  critical,
  currentHitPoints,
  exhaustionEffect,
  findPool,
  formatRoll,
  gainTemporary,
  heal,
  longRest as restLong,
  MASTERY,
  maxHitPoints,
  newTurn,
  percent,
  plainSpellText,
  rollDice,
  rollRange,
  shortRest as restShort,
  signed,
  spellEffect,
  takeDamage,
  usesLeft,
  type Advantage,
  type CombatState,
} from "@/lib/rules/battle";
import { expended, expendSlot, isCastable, longRest as slotsLong, ordinal, pactSlots, restoreSlot, setPactSpent, shortRest as slotsShort, spellSlots, type MagicState } from "@/lib/rules/magic";
import { cn } from "@/lib/utils";
import { BattleBackdrop } from "./battle-index";
import { Companions } from "./companions";
import { Items } from "./items";

// ---- this turn (kept for the browser tab, so a reload keeps it)

interface Turn {
  action: boolean;
  bonus: boolean;
  reaction: boolean;
  moved: number;
  dashes: number;
  round: number;
}
const NEW_TURN: Turn = { action: false, bonus: false, reaction: false, moved: 0, dashes: 0, round: 1 };

function useTurn(id: string): [Turn, (change: (t: Turn) => Turn) => void] {
  const key = `starlights.battle-turn.${id}`;
  const [turn, setTurn] = useState<Turn>(() => {
    try {
      return { ...NEW_TURN, ...(JSON.parse(sessionStorage.getItem(key) ?? "null") ?? {}) };
    } catch {
      return NEW_TURN;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(turn));
    } catch {
      // private mode: the turn is not kept over a reload
    }
  }, [key, turn]);
  return [turn, (change) => setTurn((t) => change(t))];
}

const SLOT_FIELD: Partial<Record<Slot, "action" | "bonus" | "reaction">> = { Action: "action", Attack: "action", "Bonus Action": "bonus", Reaction: "reaction" };

// ---- the page

export function CharacterBattlePage() {
  const { id = "" } = useParams();
  const sheet = useSheetData(id);
  const casting = useSpellcasting(id);
  const magic = useMagic(id);
  const combat = useCombat(id);
  const saveMagic = useSaveMagic(id);
  const saveCombat = useSaveCombat(id);
  // the inventory, for spending an item's charges and using up a potion (the same as the Equipment tab)
  useInventory(id);
  const saveInventory = useSaveInventory(id);
  const [turn, setTurn] = useTurn(id);
  const [targetAc, setTargetAc] = useState(15);
  const [advantage, setAdvantage] = useState<Advantage>("normal");
  const [rest, setRest] = useState<"short" | "long" | null>(null);
  // encounter mode: the fights this character's party is in, and the creature it aims at (or one described by hand)
  const fights = useActiveFights(id);
  const markFight = useMarkFight();
  const [targetPick, setTargetPick] = useState<TargetPick | null>(null);
  const [within5, setWithin5] = useState(true);
  const [manualTarget, setManualTarget] = useState<string[]>([]);

  if (sheet.isLoading || combat.isLoading) return <Loading />;
  if (sheet.error || !sheet.data)
    return (
      <Shell>
        <p className="py-24 text-center text-white/80">
          {(sheet.error as { status?: number } | null)?.status === 401 ? "This character's player locked their characters with a password." : "This character could not be loaded."}
        </p>
      </Shell>
    );

  const data = sheet.data;
  const model = buildBattleModel(data);
  const state = combat.data ?? ({} as CombatState);
  const magicState = magic.data;
  const casters = casting.data?.casters ?? [];
  const failed = (e: Error) => toast.error("Could not save", { description: e.message });
  const updateCombat = (change: (c: CombatState) => CombatState) => saveCombat.update(change, failed);
  const updateMagic = (change: (m: MagicState) => MagicState) => saveMagic.update(change, failed);

  const edition = model.edition;
  // spells, features and situations in effect (Shield, Bladesong, Bless…): they change AC, attacks, speed, hit points
  const effectCtx = { edition, mod: model.mod, proficiencyBonus: data.proficiencyBonus, rageDamage: data.rageDamage ?? 0 };
  const effects = (state.effects ?? []).map((k) => effectFor(k, effectCtx)).filter((e): e is BattleEffect => e !== null);
  const ac = effectiveArmorClass({ total: data.armorClass, base: data.armor.base ?? data.armorClass, armorKind: data.armor.armorKind ?? null, shield: !!data.armor.hasShield }, effects);
  const fx: Fx = {
    attackBonus: effects.reduce((n, e) => n + (e.attackBonus ?? 0), 0),
    die: effects.find((e) => e.d20Die)?.d20Die ?? null,
    dieFrom: effects.filter((e) => e.d20Die).map((e) => e.name).join(", "),
    weaponDamage: effects.filter((e) => e.weaponDamage).map((e) => ({ label: e.name, roll: e.weaponDamage! })),
    strengthMelee: effects.reduce((n, e) => n + (e.strengthMeleeDamage ?? 0), 0),
  };
  const setEffect = (key: string, on: boolean) =>
    updateCombat((c) => {
      const others = (c.effects ?? []).filter((k) => k.split("@")[0].toLowerCase() !== key.split("@")[0].toLowerCase());
      return { ...c, effects: on ? [...others, key] : others };
    });
  const maxHp = maxHitPoints(data.hitPoints ?? 0, state, edition) + effects.reduce((n, e) => n + (e.maxHpBonus ?? 0), 0);
  const hp = currentHitPoints(maxHp, state);
  const conditionInfo = CONDITIONS.filter((c) => state.conditions.includes(c.name));
  const exhaustion = exhaustionEffect(state.exhaustion, edition);
  const incapacitated = conditionInfo.some((c) => c.noActions) || hp === 0;
  const noReactions = conditionInfo.some((c) => c.noReactions) || hp === 0;
  const speedZero = conditionInfo.some((c) => c.speedZero) || exhaustion.speedZero;
  const baseSpeed = Math.max(0, (exhaustion.speedHalved ? Math.floor(data.speeds.walk / 2) : data.speeds.walk) - exhaustion.speedPenalty);
  const speed = speedZero ? 0 : effectiveSpeed(baseSpeed, effects);
  const forcedDisadvantage = conditionInfo.some((c) => c.attackDisadvantage) || exhaustion.attackDisadvantage;
  const d20Penalty = exhaustion.d20Penalty;

  // the target: a creature of a running fight (its conditions as the DM and party marked them, its AC when shared)
  const fightList = fights.data ?? [];
  const pickedFight = targetPick ? fightList.find((f) => f.campaignId === targetPick.campaignId && f.entryId === targetPick.entryId) : undefined;
  const target = (targetPick && pickedFight?.fight.combatants.find((c) => c.id === targetPick.combatantId)) || null;
  const targetConditions: FightCondition[] = target ? target.conditions : manualTarget.map((name) => ({ name }));
  const usedAc = target?.ac ?? targetAc;
  const ownDisadvantage = [...conditionInfo.filter((c) => c.attackDisadvantage).map((c) => c.name), ...(exhaustion.attackDisadvantage ? ["exhausted"] : [])];
  const rollFor = (melee: boolean) => attackRoll({ melee, within5, manual: advantage, ownDisadvantage, ownInvisible: state.conditions.includes("Invisible"), target: targetConditions });
  const targetSaveFor = (ability: string) => ({ ...targetSave(targetConditions, ability), bonus: target?.saves?.[ability.slice(0, 3).toLowerCase()] });
  const toggleMark = (name: string, on: boolean) => {
    if (target && pickedFight) {
      markFight.mutate(
        { campaignId: pickedFight.campaignId, entryId: pickedFight.entryId, characterId: id, combatantId: target.id, condition: name, on },
        { onError: (e) => toast.error(`Could not mark ${target.name}`, { description: e.message }) },
      );
    } else {
      setManualTarget((list) => (on ? [...list.filter((n) => n !== name), name] : list.filter((n) => n !== name)));
    }
  };
  // a spell that puts a condition on its target offers to mark it ("if it fails its save")
  const offerMark = (spellName: string) => {
    const mark = SPELL_MARKS[spellName.toLowerCase()];
    if (!mark) return;
    const who = target?.name ?? "the target";
    toast(`${spellName}: mark ${who} ${mark.condition}?`, { description: mark.when, action: { label: `Mark ${mark.condition}`, onClick: () => toggleMark(mark.condition, true) }, duration: 12000 });
  };

  // slots: the Magic tab's numbers, spent ones shared with it
  const slotTotals = spellSlots(casters);
  const pact = pactSlots(casters);
  const slotsLeft = (level: number) => (slotTotals[level] ?? 0) - (magicState ? expended(magicState, level) : 0);
  const pactLeft = pact ? pact.count - (magicState?.expendedPactSlots ?? 0) : 0;

  // spells that cannot be cast now: in a spellbook or class list but not prepared
  const unprepared = new Set<string>();
  if (magicState) for (const c of casters) for (const s of c.spells) if (!isCastable(c, magicState, s)) unprepared.add(s.name);
  const castable = (s: BattleSpell) => !!s.item || !unprepared.has(s.name) || s.origin.startsWith("Prepared");

  const markUsed = (slot: Slot) => {
    const field = SLOT_FIELD[slot];
    if (field) setTurn((t) => ({ ...t, [field]: true }));
  };

  const spendFeature = (f: BattleFeature, amount = 1) => {
    const u = f.parsedUsage;
    const owner = u?.kind === "count" ? f : u?.kind === "pool" ? findPool(model.features, u.pool) : undefined;
    if (owner) {
      const left = usesLeft(owner.parsedUsage, state.uses, owner.title) ?? 0;
      if (left < amount) return toast.error(left > 0 ? `Only ${left} ${u?.kind === "pool" ? u.pool : `use${left === 1 ? "" : "s"} of ${f.title}`} left` : `No ${u?.kind === "pool" ? u.pool : `uses of ${f.title}`} left`);
      updateCombat((c) => ({ ...c, uses: { ...c.uses, [owner.title]: (c.uses[owner.title] ?? 0) + amount } }));
    }
    // a feature that changes the numbers while it lasts (Rage, Bladesong) starts its effect
    if (effectFor(f.title, effectCtx)) {
      setEffect(f.title, true);
      toast.info(`${f.title}: ${effectFor(f.title, effectCtx)!.summary}`);
    }
    markUsed(f.slot);
  };

  // a spell from a magic item with charges (a wand, a staff, Enspelled Armor) spends a charge, not a slot
  const chargedItemOf = (spell: BattleSpell) =>
    spell.item
      ? (data.items ?? []).find((i) => i.entryId === spell.item!.entryId)
      : (data.items ?? []).find((i) => i.charges && spell.origin && (spell.origin.includes(i.elementName) || spell.origin.includes(i.name)));

  const cast = (spell: BattleSpell, level: number, usePact: boolean) => {
    const item = chargedItemOf(spell);
    // an item spell's charges for the level; a spell the item's rules gave (Enspelled Armor) one charge
    const charges = spell.item ? chargesFor(spell, level) : 1;
    if (spell.item && item?.requiresAttunement && !item.attuned) return toast.error(`Attune to ${item.name} first (Equipment tab)`);
    if (item && (item.charges || spell.item)) {
      const left = Math.max(0, (item.charges ?? 0) - item.chargesUsed);
      if (charges > left) return toast.error(left > 0 ? `${item.name} has only ${left} charge${left === 1 ? "" : "s"} left` : `${item.name} has no charges left`);
      if (charges > 0) saveInventory.updateEntry(item.entryId, { chargesUsed: item.chargesUsed + charges }, failed);
    } else if (spell.level > 0) {
      if (usePact) {
        if (!pact || pactLeft <= 0) return toast.error("No pact slots left");
        updateMagic((m) => setPactSpent(m, m.expendedPactSlots + 1, pact.count));
      } else {
        if (slotsLeft(level) <= 0) return toast.error(`No ${ordinal(level)}-level slots left`);
        updateMagic((m) => expendSlot(m, level, slotTotals[level] ?? 0));
      }
    }
    if (spell.concentration) {
      if (state.concentration && state.concentration !== spell.name) toast.info(`${state.concentration} ends: you can concentrate on one spell at a time.`);
      // the spell concentrated on before ends, and its effect with it
      updateCombat((c) => ({ ...c, concentration: spell.name, effects: (c.effects ?? []).filter((k) => !c.concentration || k.split("@")[0].toLowerCase() !== c.concentration.toLowerCase()) }));
    }
    markUsed(spell.slot);
    const key = /^(aid|magic weapon)$/i.test(spell.name) ? `${spell.name}@${level}` : spell.name;
    const effect = effectFor(key, { ...effectCtx, edition: /\(2024\)/.test(spell.source) ? "2024" : spell.source ? "2014" : edition });
    const done = spell.item
      ? `${spell.name} cast from ${spell.item.name}${level > 0 ? ` at ${ordinal(level)} level` : ""} (${charges ? `${charges} charge${charges === 1 ? "" : "s"}` : "no charges"})`
      : `${spell.name} cast${spell.level > 0 ? ` with a ${usePact ? `pact (${ordinal(level)}-level)` : `${ordinal(level)}-level`} slot` : ""}`;
    if (effect && SELF_SPELLS.has(spell.name.toLowerCase())) {
      setEffect(key, true);
      toast.success(`${done}: ${effect.summary}`);
    } else if (effect) {
      // a buff that may be on someone else (Bless, Haste): the player says whether it is on them
      toast.success(done, { description: effect.summary, action: { label: "It's on me too", onClick: () => setEffect(key, true) }, duration: 10000 });
    } else {
      toast.success(done);
    }
    offerMark(spell.name);
  };

  const damage = (amount: number) => {
    updateCombat((c) => takeDamage(c, amount, maxHp));
    if (state.concentration && amount > 0) {
      const con = data.saves.find((s) => s.abilityScoreAbbreviation === "CON")?.calculatedBonus ?? model.mod("CON");
      toast.warning(`Concentration on ${state.concentration}: Constitution save DC ${Math.min(30, Math.max(10, Math.floor(amount / 2)))} (your save ${signed(con)})`, { duration: 8000 });
    }
  };

  const nextTurn = () => {
    setTurn((t) => ({ ...NEW_TURN, round: t.round + 1 }));
    // Shield and Dodge last until the start of your next turn
    updateCombat((c) => ({ ...newTurn(c, model.features), effects: (c.effects ?? []).filter((k) => !effectFor(k, effectCtx)?.untilNextTurn) }));
  };

  // ?model: what the simulator worked out, for checking it against every class (scripts/starlights-battle-check.py)
  const readout = new URLSearchParams(window.location.search).has("model")
    ? JSON.stringify({
        name: data.name,
        classLine: data.classLine,
        edition,
        level: data.level,
        maxHp,
        weapons: model.weapons.map((w) => `${w.name} ${signed(w.bonus)} ${formatRoll(w.roll)}`),
        unarmed: `${signed(model.unarmed.bonus)} ${formatRoll(model.unarmed.roll)}`,
        features: model.features.map((f) => ({
          title: f.title,
          slot: f.slot,
          usage: f.usage ?? null,
          parsed: f.parsedUsage,
          regainOnShort: f.regainOnShort,
          pool: f.parsedUsage?.kind === "pool" ? (findPool(model.features, f.parsedUsage.pool)?.title ?? null) : undefined,
        })),
        slots: slotTotals,
        pact,
        spells: model.spells.map((sp) => {
          const e = withBonus(spellEffect(sp, sp.level, data.level, sp.modifier), sp.damageBonus);
          return {
            name: sp.name,
            level: sp.level,
            time: sp.time,
            slot: sp.slot,
            castable: castable(sp),
            attackBonus: sp.attackBonus,
            saveDc: sp.saveDc,
            casting: sp.castingName,
            attack: e.attack,
            save: e.save,
            damage: e.damage.map((r) => formatRoll(r)),
            healing: e.healing ? formatRoll(e.healing, false) : null,
            beams: e.beams,
            mentionsDamage: /\d+d\d+[^.]{0,40}damage/i.test(plainSpellText(sp.description)),
          };
        }),
      })
    : null;

  const setCharges = (entryId: string, used: number) => {
    const item = (data.items ?? []).find((i) => i.entryId === entryId);
    if (item?.charges) saveInventory.updateEntry(entryId, { chargesUsed: Math.max(0, Math.min(item.charges, used)) }, failed);
  };
  const consume = (entryId: string) =>
    saveInventory.update(
      (current) => ({
        ...current,
        items: current.items.flatMap((e) => (e.id !== entryId ? [e] : e.quantity > 1 ? [{ ...e, quantity: e.quantity - 1 }] : [])),
      }),
      failed,
    );

  const ctx: Ctx = { data, model, state, targetAc: usedAc, rollFor, targetSaveFor, d20Penalty, turn, incapacitated, noReactions, use: markUsed, spendFeature, cast, castable, slotsLeft, slotTotals, pact, pactLeft, updateMagic, updateCombat, setCharges, consume, chargedItemOf, fx, effects, setEffect, effectCtx };

  return (
    <Shell>
      {readout && (
        <pre id="battle-model" hidden>
          {readout}
        </pre>
      )}
      <Header id={id} data={data} model={model} onRest={setRest} />
      <Vitals data={data} model={model} state={state} hp={hp} maxHp={maxHp} speed={speed} ac={ac} onDamage={damage} onHeal={(n) => updateCombat((c) => heal(c, n))} onTemp={(n) => updateCombat((c) => gainTemporary(c, n))} />
      <Status data={data} state={state} edition={edition} exhaustionText={exhaustion.text} updateCombat={updateCombat} hp={hp} />
      <Effects ctx={ctx} />
      <TurnBar
        turn={turn}
        setTurn={setTurn}
        speed={speed}
        incapacitated={incapacitated}
        noReactions={noReactions}
        onNextTurn={nextTurn}
        forcedDisadvantage={forcedDisadvantage}
        d20Penalty={d20Penalty}
      />
      <TargetPanel
        me={id}
        fights={fightList}
        pick={targetPick}
        setPick={setTargetPick}
        target={target}
        conditions={targetConditions}
        manualAc={targetAc}
        setManualAc={setTargetAc}
        advantage={advantage}
        setAdvantage={setAdvantage}
        within5={within5}
        setWithin5={setWithin5}
        rollFor={rollFor}
        toggle={toggleMark}
        busy={markFight.isPending}
      />
      <Choices ctx={ctx} speed={speed} />
      <RestDialog kind={rest} onClose={() => setRest(null)} ctx={ctx} totalHitDice={data.level} />
    </Shell>
  );
}

/** What the active effects add to attacks: flat bonus, a die (Bless, Bane), weapon damage, Rage's bonus. */
interface Fx {
  attackBonus: number;
  die: { sides: number; sign: 1 | -1 } | null;
  dieFrom: string;
  weaponDamage: { label: string; roll: Roll }[];
  strengthMelee: number;
}

interface Ctx {
  data: SheetData;
  model: BattleModel;
  state: CombatState;
  targetAc: number;
  /** an attack's roll against the target: advantage or disadvantage from both sides' conditions, and why */
  rollFor: (melee: boolean) => AttackRoll;
  /** what the target's conditions do to its save, and its save bonus when the DM shares it */
  targetSaveFor: (ability: string) => ReturnType<typeof targetSave> & { bonus?: number };
  d20Penalty: number;
  turn: Turn;
  incapacitated: boolean;
  noReactions: boolean;
  use: (slot: Slot) => void;
  spendFeature: (f: BattleFeature, amount?: number) => void;
  cast: (spell: BattleSpell, level: number, usePact: boolean) => void;
  castable: (s: BattleSpell) => boolean;
  slotsLeft: (level: number) => number;
  slotTotals: Record<number, number>;
  pact: { level: number; count: number } | null;
  pactLeft: number;
  updateMagic: (change: (m: MagicState) => MagicState) => void;
  updateCombat: (change: (c: CombatState) => CombatState) => void;
  setCharges: (entryId: string, used: number) => void;
  fx: Fx;
  effects: BattleEffect[];
  setEffect: (key: string, on: boolean) => void;
  effectCtx: Parameters<typeof effectFor>[1];
  consume: (entryId: string) => void;
  chargedItemOf: (spell: BattleSpell) => SheetData["items"][number] | undefined;
}

// ---- layout pieces

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-neutral-950 text-neutral-100">
      <BattleBackdrop />
      <div className="relative mx-auto max-w-6xl space-y-4 px-3 py-6 sm:px-4">{children}</div>
    </div>
  );
}

function Loading() {
  return (
    <Shell>
      <Spinner className="mx-auto my-24 size-6 text-white" />
    </Shell>
  );
}

function Panel({ title, icon, children, className, action }: { title?: string; icon?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-white/10 bg-neutral-900/75 p-3 shadow-xl backdrop-blur-md sm:p-4", className)}>
      {title && (
        <header className="mb-2 flex items-center gap-2">
          {icon}
          <h2 className="font-heading text-sm uppercase tracking-[0.2em] text-amber-200/90">{title}</h2>
          <span className="flex-1" />
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center justify-center rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-center", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/55">{label}</span>
      <span className="font-heading text-2xl leading-tight text-white">{value}</span>
      {sub && <span className="text-[11px] leading-tight text-white/60">{sub}</span>}
    </div>
  );
}

function Chip({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "gold" | "red" | "blue" | "green"; className?: string }) {
  const tones = {
    neutral: "border-white/15 bg-white/5 text-white/80",
    gold: "border-amber-300/40 bg-amber-300/10 text-amber-100",
    red: "border-red-400/40 bg-red-500/10 text-red-100",
    blue: "border-sky-300/40 bg-sky-400/10 text-sky-100",
    green: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", tones[tone], className)}>{children}</span>;
}

function Header({ id, data, model, onRest }: { id: string; data: SheetData; model: BattleModel; onRest: (k: "short" | "long") => void }) {
  return (
    <div className="flex flex-wrap items-end gap-4 pt-2">
      <Link to="/battle" className="absolute left-3 top-2 inline-flex items-center gap-1 text-xs text-white/60 hover:text-white sm:left-4">
        <ArrowLeftIcon className="size-3.5" /> All characters
      </Link>
      {data.portraitUrl ? (
        <img src={data.portraitUrl} alt="" className="mt-4 size-20 rounded-xl border-2 border-amber-200/40 object-cover shadow-2xl sm:size-24" />
      ) : (
        <div className="mt-4 flex size-20 items-center justify-center rounded-xl border-2 border-amber-200/30 bg-black/40 sm:size-24">
          <SwordIcon className="size-8 text-amber-200/60" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80">Battle Action Simulator</p>
        <h1 className="line-clamp-2 break-words font-heading text-3xl tracking-wide text-white drop-shadow sm:text-4xl">{data.name}</h1>
        <p className="truncate text-sm text-white/75">
          {data.classLine}
          {data.player ? ` · ${data.player}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Chip tone="gold">{model.edition} rules</Chip>
          {data.attacksPerAction > 1 && <Chip>{data.attacksPerAction} attacks per Attack action</Chip>}
          {data.defenses.resistances.length > 0 && <Chip tone="blue">Resists {data.defenses.resistances.join(", ")}</Chip>}
          {data.defenses.immunities.length > 0 && <Chip tone="green">Immune to {data.defenses.immunities.join(", ")}</Chip>}
          {data.defenses.vulnerabilities.length > 0 && <Chip tone="red">Vulnerable to {data.defenses.vulnerabilities.join(", ")}</Chip>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" asChild>
          <Link to={`/characters/${id}/sheet`}>
            <FileTextIcon /> Sheet
          </Link>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onRest("short")}>
          <CoffeeIcon /> Short rest
        </Button>
        <Button size="sm" onClick={() => onRest("long")} className="bg-amber-500 text-black hover:bg-amber-400">
          <BedDoubleIcon /> Long rest
        </Button>
      </div>
    </div>
  );
}

function Vitals({
  data,
  model,
  state,
  hp,
  maxHp,
  speed,
  ac,
  onDamage,
  onHeal,
  onTemp,
}: {
  data: SheetData;
  model: BattleModel;
  state: CombatState;
  hp: number;
  maxHp: number;
  speed: number;
  ac: { total: number; changes: string[] };
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  onTemp: (n: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const caster = data.spellcasting[0];
  const dicePools = hitDiceOf(data, state, data.level);
  const hitDiceLeft = dicePools.pools.reduce((n, p) => n + dicePools.leftOf(p.sides), 0);
  const apply = (fn: (n: number) => void) => {
    if (n > 0) fn(n);
    setAmount("");
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
      <Panel title="Hit points" icon={<HeartIcon className="size-4 text-red-300" />}>
        <div className="flex items-end gap-3">
          <div className="font-heading text-5xl leading-none text-white">
            {hp}
            <span className="text-2xl text-white/50"> / {maxHp}</span>
          </div>
          {state.temporaryHitPoints > 0 && <Chip tone="blue">+{state.temporaryHitPoints} temporary</Chip>}
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10" role="meter" aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp} aria-label="Hit points">
          <div className={cn("h-full rounded-full transition-all", ratio > 0.5 ? "bg-emerald-400" : ratio > 0.25 ? "bg-amber-400" : "bg-red-500")} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input inputMode="numeric" aria-label="Amount" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="h-8 w-24 border-white/20 bg-black/40 text-white" />
          <Button size="sm" variant="destructive" disabled={!n} onClick={() => apply(onDamage)}>
            Damage
          </Button>
          <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={!n} onClick={() => apply(onHeal)}>
            Heal
          </Button>
          <Button size="sm" variant="secondary" disabled={!n} onClick={() => apply(onTemp)}>
            Temp HP
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-white/50">
          Hit dice {hitDiceLeft} of {data.hitDice || `${data.level}`} left · damage takes temporary hit points first
        </p>
      </Panel>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Stat label="Armor class" value={ac.total} sub={ac.changes.length ? ac.changes.join(" · ") : data.armor.label + (data.armor.shield ? ` + ${data.armor.shield}` : "")} className={ac.total !== data.armorClass ? "border-sky-300/50" : undefined} />
        <Stat label="Initiative" value={signed(data.initiative)} />
        <Stat label="Speed" value={`${speed} ft`} sub={[data.speeds.fly && `fly ${data.speeds.fly}`, data.speeds.climb && `climb ${data.speeds.climb}`, data.speeds.swim && `swim ${data.speeds.swim}`].filter(Boolean).join(" · ") || undefined} />
        <Stat label="Proficiency" value={signed(data.proficiencyBonus)} />
        <Stat label="Passive Perception" value={data.passivePerception} sub={data.vision.join(", ") || undefined} />
        {caster ? <Stat label="Spell save DC" value={caster.saveDc} sub={`${signed(caster.attackBonus)} to hit · ${caster.ability}`} /> : <Stat label="Attacks per action" value={data.attacksPerAction} />}
        <Stat
          label="Hit dice"
          value={hitDiceLeft}
          sub={dicePools.multi ? dicePools.pools.map((p) => `${dicePools.leftOf(p.sides)} d${p.sides}`).join(" · ") : data.hitDie ? `d${data.hitDie} + ${model.mod("CON")} each` : undefined}
        />
        <Stat label="Saves" value={<span className="text-sm leading-6">{data.saves.filter((s) => s.proficiency !== "none").map((s) => s.abilityScoreAbbreviation).join(" ") || "—"}</span>} sub="proficient" />
      </div>
    </div>
  );
}

function Status({ data, state, edition, exhaustionText, updateCombat, hp }: { data: SheetData; state: CombatState; edition: "2014" | "2024"; exhaustionText: string; updateCombat: (c: (s: CombatState) => CombatState) => void; hp: number }) {
  const lookup = useLoreLookup();
  const [adding, setAdding] = useState(false);
  const toggle = (name: string) => updateCombat((c) => ({ ...c, conditions: c.conditions.includes(name) ? c.conditions.filter((x) => x !== name) : [...c.conditions, name] }));
  return (
    <Panel title="Condition" icon={<BrainIcon className="size-4 text-sky-300" />} action={<Button size="sm" variant="ghost" className="h-7 text-white/80" onClick={() => setAdding((a) => !a)}>{adding ? "Done" : "Conditions…"}</Button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {state.concentration ? (
          <Chip tone="gold">
            Concentrating on {state.concentration}
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => updateCombat((c) => ({ ...c, concentration: null, effects: (c.effects ?? []).filter((k) => !c.concentration || k.split("@")[0].toLowerCase() !== c.concentration.toLowerCase()) }))}
            >
              end
            </button>
          </Chip>
        ) : (
          <Chip>Not concentrating</Chip>
        )}
        {state.conditions.map((name) => {
          const key = lookup("conditions", name, edition);
          return (
            <Chip key={name} tone="red">
              {key ? <LoreLink category="conditions" k={key}>{name}</LoreLink> : name}
              <button type="button" aria-label={`Remove ${name}`} className="ml-0.5" onClick={() => toggle(name)}>
                ×
              </button>
            </Chip>
          );
        })}
        <span className="inline-flex items-center gap-1">
          <span className="text-xs text-white/60">Exhaustion</span>
          <Button size="icon" variant="ghost" className="size-6 text-white" aria-label="Less exhaustion" onClick={() => updateCombat((c) => ({ ...c, exhaustion: Math.max(0, c.exhaustion - 1) }))}>
            <MinusIcon />
          </Button>
          <span className="w-4 text-center font-semibold">{state.exhaustion}</span>
          <Button size="icon" variant="ghost" className="size-6 text-white" aria-label="More exhaustion" onClick={() => updateCombat((c) => ({ ...c, exhaustion: Math.min(6, c.exhaustion + 1) }))}>
            <PlusIcon />
          </Button>
        </span>
        <button
          type="button"
          aria-pressed={state.heroicInspiration}
          onClick={() => updateCombat((c) => ({ ...c, heroicInspiration: !c.heroicInspiration }))}
          className={cn("rounded-full border px-2 py-0.5 text-[11px]", state.heroicInspiration ? "border-amber-300 bg-amber-300/20 text-amber-100" : "border-white/15 text-white/60")}
        >
          <SparklesIcon className="mr-1 inline size-3" />
          {edition === "2024" ? "Heroic Inspiration" : "Inspiration"}
        </button>
      </div>
      {exhaustionText && <p className="mt-2 text-xs text-red-200/90">Exhaustion {state.exhaustion}: {exhaustionText}</p>}
      {state.conditions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-white/70">
          {CONDITIONS.filter((c) => state.conditions.includes(c.name)).map((c) => (
            <li key={c.name}>
              <span className="font-semibold text-white/85">{c.name}.</span> {c.effect}
            </li>
          ))}
        </ul>
      )}
      {hp === 0 && (
        <div className="mt-3 rounded-lg border border-red-400/40 bg-red-950/40 p-2 text-sm">
          <p className="font-semibold text-red-100">At 0 hit points: death saving throws (DC 10) at the start of each turn.</p>
          <div className="mt-1 flex flex-wrap gap-4">
            <DeathSaves label="Successes" value={state.deathSaveSuccesses} tone="bg-emerald-400" onChange={(v) => updateCombat((c) => ({ ...c, deathSaveSuccesses: v }))} />
            <DeathSaves label="Failures" value={state.deathSaveFailures} tone="bg-red-500" onChange={(v) => updateCombat((c) => ({ ...c, deathSaveFailures: v }))} />
          </div>
          {state.deathSaveSuccesses >= 3 && <p className="mt-1 text-emerald-200">Stable.</p>}
          {state.deathSaveFailures >= 3 && <p className="mt-1 text-red-200">Dead.</p>}
        </div>
      )}
      {adding && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CONDITIONS.map((c) => (
            <button
              key={c.name}
              type="button"
              title={c.effect}
              aria-pressed={state.conditions.includes(c.name)}
              onClick={() => toggle(c.name)}
              className={cn("rounded-full border px-2.5 py-1 text-xs", state.conditions.includes(c.name) ? "border-red-300 bg-red-500/20 text-red-50" : "border-white/15 text-white/75 hover:bg-white/10")}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      <span className="sr-only">{data.name}</span>
    </Panel>
  );
}

/** What is in effect on the character (from its own spells and features, allies' spells, cover) and adding more. */
function Effects({ ctx }: { ctx: Ctx }) {
  const [adding, setAdding] = useState(false);
  const active = new Set((ctx.state.effects ?? []).map((k) => k.split("@")[0].toLowerCase()));
  // what it could have: its own spells and features that change numbers, and what allies or the table bring
  const own = [...ctx.model.spells.map((sp) => sp.name), ...ctx.model.features.map((f) => f.title)].filter((n) => effectFor(n, ctx.effectCtx));
  const choices = [...new Set([...own, ...PICKABLE_EFFECTS])].filter((k) => !active.has(k.split("@")[0].toLowerCase()));
  return (
    <Panel
      title="In effect"
      icon={<SparklesIcon className="size-4 text-sky-300" />}
      action={
        <Button size="sm" variant="ghost" className="h-7 text-white/80" onClick={() => setAdding((a) => !a)}>
          {adding ? "Done" : "Add an effect…"}
        </Button>
      }
    >
      {ctx.effects.length === 0 ? (
        <p className="text-xs text-white/55">Nothing yet. Casting a spell or using a feature that changes your numbers (Shield, Mage Armor, Bladesong, Rage) turns it on here; so can you.</p>
      ) : (
        <ul className="space-y-1.5">
          {ctx.effects.map((e) => (
            <li key={e.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Chip tone={e.kind === "situation" ? "neutral" : "blue"}>{e.key.replace("@", " at level ")}</Chip>
              <span className="text-xs text-white/75">{e.summary}</span>
              {e.untilNextTurn && <span className="text-[11px] text-white/45">ends at the start of your next turn</span>}
              {e.concentration && <span className="text-[11px] text-white/45">concentration</span>}
              {e.notes && <span className="text-[11px] text-white/45">{e.notes}</span>}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-6 text-white/60" aria-label={`End ${e.name}`} onClick={() => ctx.setEffect(e.key, false)}>
                End
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {choices.map((k) => (
            <button
              key={k}
              type="button"
              title={effectFor(k, ctx.effectCtx)?.summary}
              onClick={() => ctx.setEffect(k, true)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:border-sky-300/60 hover:bg-white/10"
            >
              {k.replace("@2", "")}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function DeathSaves({ label, value, tone, onChange }: { label: string; value: number; tone: string; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-white/70">{label}</span>
      {[1, 2, 3].map((i) => (
        <button key={i} type="button" aria-label={`${label} ${i}`} aria-pressed={value >= i} onClick={() => onChange(value >= i ? i - 1 : i)} className={cn("size-4 rounded-full border border-white/40", value >= i && tone)} />
      ))}
    </span>
  );
}

function TurnBar({
  turn,
  setTurn,
  speed,
  incapacitated,
  noReactions,
  onNextTurn,
  forcedDisadvantage,
  d20Penalty,
}: {
  turn: Turn;
  setTurn: (c: (t: Turn) => Turn) => void;
  speed: number;
  incapacitated: boolean;
  noReactions: boolean;
  onNextTurn: () => void;
  forcedDisadvantage: boolean;
  d20Penalty: number;
}) {
  const total = speed * (1 + turn.dashes);
  const left = Math.max(0, total - turn.moved);
  const pip = (label: string, used: boolean, field: "action" | "bonus" | "reaction", disabled: boolean) => (
    <button
      type="button"
      aria-pressed={used}
      disabled={disabled}
      onClick={() => setTurn((t) => ({ ...t, [field]: !t[field] }))}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition",
        disabled ? "border-white/10 text-white/30 line-through" : used ? "border-white/10 bg-white/5 text-white/40 line-through" : "border-amber-300/50 bg-amber-300/10 text-amber-50 hover:bg-amber-300/20",
      )}
    >
      <span className={cn("size-2.5 rotate-45", used || disabled ? "bg-white/20" : "bg-amber-300")} />
      {label}
    </button>
  );
  return (
    <Panel title={`Round ${turn.round} · this turn`} icon={<TimerIcon className="size-4 text-amber-300" />} action={
      <Button size="sm" onClick={onNextTurn} className="h-7 bg-amber-500 text-black hover:bg-amber-400">
        <RotateCcwIcon /> Next turn
      </Button>
    }>
      <div className="flex flex-wrap items-center gap-2">
        {pip("Action", turn.action, "action", incapacitated)}
        {pip("Bonus action", turn.bonus, "bonus", incapacitated)}
        {pip("Reaction", turn.reaction, "reaction", noReactions)}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1.5 text-sm">
          <FootprintsIcon className="size-4 text-white/60" />
          <span className="font-semibold">{left}</span>
          <span className="text-white/60">/ {total} ft</span>
          <Button size="icon" variant="ghost" className="size-6 text-white" aria-label="Move 5 feet" onClick={() => setTurn((t) => ({ ...t, moved: Math.min(total, t.moved + 5) }))}>
            <MinusIcon />
          </Button>
          <Button size="icon" variant="ghost" className="size-6 text-white" aria-label="Give back 5 feet" onClick={() => setTurn((t) => ({ ...t, moved: Math.max(0, t.moved - 5) }))}>
            <PlusIcon />
          </Button>
        </div>
      </div>
      {(incapacitated || forcedDisadvantage || d20Penalty > 0) && (
        <p className="mt-2 text-xs text-red-200/90">
          {incapacitated && "You can't take actions or bonus actions right now. "}
          {forcedDisadvantage && "Your conditions give your attacks disadvantage (counted in the target's roll below). "}
          {d20Penalty > 0 && `Exhaustion: −${d20Penalty} to attack rolls (counted below).`}
        </p>
      )}
    </Panel>
  );
}

// ---- what the character can do

function Choices({ ctx, speed }: { ctx: Ctx; speed: number }) {
  const { model, data } = ctx;
  const bySlot = (slot: Slot) => model.features.filter((f) => f.slot === slot);
  const spellsBy = (slot: Slot) => model.spells.filter((s) => s.slot === slot && ctx.castable(s));
  const limited = model.features.filter((f) => f.parsedUsage);
  return (
    <Tabs defaultValue="action" className="gap-3">
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1 border border-white/10 bg-neutral-900/80 p-1 backdrop-blur">
        <TabsTrigger value="action" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Action</TabsTrigger>
        <TabsTrigger value="bonus" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Bonus action</TabsTrigger>
        <TabsTrigger value="reaction" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Reaction</TabsTrigger>
        <TabsTrigger value="spells" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Spells</TabsTrigger>
        <TabsTrigger value="resources" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Resources</TabsTrigger>
        <TabsTrigger value="items" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Items</TabsTrigger>
        <TabsTrigger value="companions" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Familiars & companions{(ctx.state.companions ?? []).length ? ` (${ctx.state.companions.length})` : ""}</TabsTrigger>
        <TabsTrigger value="move" className="text-white/70 data-[state=active]:bg-amber-400 data-[state=active]:text-black">Movement & free</TabsTrigger>
      </TabsList>

      <TabsContent value="action" className="space-y-3">
        <Panel title={`Attack action${data.attacksPerAction > 1 ? ` · ${data.attacksPerAction} attacks` : ""}`} icon={<SwordIcon className="size-4 text-amber-300" />}>
          <div className="grid gap-2 md:grid-cols-2">
            {[...model.weapons.filter((w) => w.equipped !== false), ...model.offHand.filter((w) => w.equipped !== false && model.offHandAction[w.name] === "Attack"), model.unarmed].map((w) => (
              <WeaponCard key={`${w.name}|${w.mode ?? ""}`} ctx={ctx} weapon={w} slot="Attack" attacks={w.mode === "Off hand" ? 1 : data.attacksPerAction} />
            ))}
          </div>
          {model.weapons.some((w) => w.equipped === false) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-white/60">Weapons in your pack ({new Set(model.weapons.filter((w) => w.equipped === false).map((w) => w.name)).size}): drawing one is your free object interaction</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {[...model.weapons, ...model.offHand].filter((w) => w.equipped === false).map((w) => (
                  <WeaponCard key={`${w.name}|${w.mode ?? ""}`} ctx={ctx} weapon={w} slot="Attack" attacks={data.attacksPerAction} />
                ))}
              </div>
            </details>
          )}
          <p className="mt-2 text-xs text-white/60">Grapple or shove: {model.grapple}</p>
          {bySlot("Attack").length > 0 && <FeatureList ctx={ctx} features={bySlot("Attack")} note="Part of the Attack action" />}
        </Panel>
        {spellsBy("Action").length > 0 && (
          <Panel title="Cast a spell" icon={<ZapIcon className="size-4 text-sky-300" />}>
            <SpellList ctx={ctx} spells={spellsBy("Action")} />
          </Panel>
        )}
        {bySlot("Action").length > 0 && (
          <Panel title="Your features" icon={<SparklesIcon className="size-4 text-amber-300" />}>
            <FeatureList ctx={ctx} features={bySlot("Action")} />
          </Panel>
        )}
        <Panel title="Every creature can" icon={<ShieldIcon className="size-4 text-white/60" />}>
          <StandardList ctx={ctx} />
        </Panel>
      </TabsContent>

      <TabsContent value="bonus" className="space-y-3">
        {model.offHand.some((w) => w.equipped !== false && model.offHandAction[w.name] !== "Attack") && (
          <Panel title="Two-weapon fighting" icon={<SwordIcon className="size-4 text-amber-300" />}>
            <p className="mb-2 text-xs text-white/60">After attacking with a light melee weapon, attack with the other one as a bonus action{model.edition === "2024" ? " (with the Nick mastery it is part of the Attack action instead)" : ""}. No ability modifier to its damage unless it is negative or you have the Two-Weapon Fighting style.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {model.offHand.filter((w) => w.equipped !== false && model.offHandAction[w.name] !== "Attack").map((w) => (
                <WeaponCard key={`${w.name}|off`} ctx={ctx} weapon={w} slot="Bonus Action" attacks={1} />
              ))}
            </div>
          </Panel>
        )}
        <SlotSection ctx={ctx} features={bySlot("Bonus Action")} spells={spellsBy("Bonus Action")} empty="Nothing on the sheet uses a bonus action. Some spells and features may still give you one." />
      </TabsContent>

      <TabsContent value="reaction" className="space-y-3">
        <Panel title="Opportunity attack" icon={<SwordIcon className="size-4 text-amber-300" />}>
          <p className="mb-2 text-xs text-white/60">When a creature you can see leaves your reach, make one melee attack against it.</p>
          {model.opportunity && <WeaponCard ctx={ctx} weapon={model.opportunity} slot="Reaction" attacks={1} />}
        </Panel>
        <SlotSection ctx={ctx} features={bySlot("Reaction")} spells={spellsBy("Reaction")} empty="" />
      </TabsContent>

      <TabsContent value="spells" className="space-y-3">
        <SlotsPanel ctx={ctx} />
        {model.spells.length === 0 ? (
          <Panel>
            <p className="text-sm text-white/70">{data.name} has no spells.</p>
          </Panel>
        ) : (
          <Panel title="Spells" icon={<ZapIcon className="size-4 text-sky-300" />}>
            <SpellList ctx={ctx} spells={model.spells} grouped />
          </Panel>
        )}
      </TabsContent>

      <TabsContent value="resources" className="space-y-3">
        <SlotsPanel ctx={ctx} />
        <Panel title="Limited uses" icon={<SparklesIcon className="size-4 text-amber-300" />}>
          {limited.length === 0 ? <p className="text-sm text-white/60">No features with limited uses.</p> : <FeatureList ctx={ctx} features={limited} />}
        </Panel>
      </TabsContent>

      <TabsContent value="items">
        <Items
          items={data.items ?? []}
          riders={model.riders}
          state={ctx.state}
          edition={model.edition}
          update={ctx.updateCombat}
          setCharges={ctx.setCharges}
          consume={ctx.consume}
          heal={(n) => ctx.updateCombat((c) => heal(c, n))}
          markUsed={ctx.use}
        />
      </TabsContent>

      <TabsContent value="companions">
        <Companions edition={model.edition} state={ctx.state} featureTitles={model.features.map((f) => f.title)} spellNames={model.spells.map((s) => s.name)} update={ctx.updateCombat} />
      </TabsContent>

      <TabsContent value="move" className="space-y-3">
        <Panel title="Movement" icon={<FootprintsIcon className="size-4 text-white/70" />}>
          <ul className="space-y-1 text-sm text-white/80">
            <li>Walk {speed} ft{data.speeds.fly ? `, fly ${data.speeds.fly} ft` : ""}{data.speeds.climb ? `, climb ${data.speeds.climb} ft` : ""}{data.speeds.swim ? `, swim ${data.speeds.swim} ft` : ""}. You can split it before and after your action.</li>
            <li>Standing up from prone costs half your speed ({Math.floor(speed / 2)} ft); dropping prone is free.</li>
            <li>Difficult terrain costs 1 extra foot per foot. Climbing or swimming without a speed for it costs the same.</li>
            <li>The Dash action adds your speed again (+{speed} ft).</li>
          </ul>
        </Panel>
        <Panel title="Free on your turn" icon={<SparklesIcon className="size-4 text-white/70" />}>
          <ul className="space-y-1 text-sm text-white/80">
            <li>One object interaction: draw or stow a weapon, open a door, pick up an item.</li>
            <li>Speak a few words, gesture.</li>
            {model.features.filter((f) => f.slot === "Other" && /\bfree\b|no action required/i.test(f.text)).map((f) => (
              <li key={f.title}>
                <span className="font-semibold">{f.title}.</span> {f.text.slice(0, 200)}
                {f.text.length > 200 ? "…" : ""}
              </li>
            ))}
          </ul>
        </Panel>
      </TabsContent>
    </Tabs>
  );
}

function SlotSection({ ctx, features, spells, empty }: { ctx: Ctx; features: BattleFeature[]; spells: BattleSpell[]; empty: string }) {
  if (features.length === 0 && spells.length === 0) return empty ? <Panel><p className="text-sm text-white/60">{empty}</p></Panel> : null;
  return (
    <>
      {features.length > 0 && (
        <Panel title="Your features" icon={<SparklesIcon className="size-4 text-amber-300" />}>
          <FeatureList ctx={ctx} features={features} />
        </Panel>
      )}
      {spells.length > 0 && (
        <Panel title="Spells" icon={<ZapIcon className="size-4 text-sky-300" />}>
          <SpellList ctx={ctx} spells={spells} />
        </Panel>
      )}
    </>
  );
}

function WeaponCard({ ctx, weapon, slot, attacks }: { ctx: Ctx; weapon: WeaponAttack; slot: Slot; attacks: number }) {
  const lookup = useLoreLookup();
  const bonus = weapon.bonus - ctx.d20Penalty + ctx.fx.attackBonus;
  const roll = ctx.rollFor(weapon.melee);
  const chance = hitChanceWithDie(bonus, ctx.targetAc, roll.advantage, ctx.fx.die);
  const hit = chance.hit;
  // a hit within 5 ft on a Paralyzed or Unconscious target is a critical hit
  const crit = roll.autoCrit && weapon.melee ? chance.hit : chance.crit;
  // Rage: attacks using Strength (melee; thrown too under the 2024 rules), finesse ones when Strength is the better
  const usesStrength = !weapon.properties.includes("Finesse") || ctx.model.mod("STR") >= ctx.model.mod("DEX");
  const strengthBased = usesStrength && (weapon.mode === "Thrown" ? ctx.model.edition === "2024" : weapon.melee);
  const rage = strengthBased ? ctx.fx.strengthMelee : 0;
  // Great Weapon Fighting raises the average of the dice
  const avgOf = (r: typeof weapon.roll) => (weapon.greatWeapon ? averageGreatWeapon(r, weapon.greatWeapon) : average(r));
  // a magic weapon's extra damage that applies now (always on, or switched on in the Items tab)
  const powers = (weapon.entryId ? ctx.model.riders[weapon.entryId] : undefined) ?? [];
  const on = [
    ...powers.filter((p) => !p.critOnly && (p.always || (ctx.state.active ?? []).includes(`${weapon.entryId}:${p.id}`))),
    // spells on the character that add to weapon hits (Hunter's Mark, Divine Favor, Rage's bonus)
    ...ctx.fx.weaponDamage.map((w, i) => ({ id: `fx${i}`, label: w.label, roll: w.roll, always: true, critOnly: false })),
    ...(rage ? [{ id: "rage", label: "Rage", roll: { dice: [], bonus: rage, type: "" }, always: true, critOnly: false }] : []),
  ];
  const onCrit = powers.filter((p) => p.critOnly);
  const extraAvg = on.reduce((n, p) => n + average(p.roll), 0);
  const extraCrit = on.reduce((n, p) => n + average(critical(p.roll)), 0) + onCrit.reduce((n, p) => n + average(critical(p.roll)), 0);
  const avg = avgOf(weapon.roll) + extraAvg;
  const critAvg = avgOf(critical(weapon.roll)) + extraCrit;
  const expected = (hit - crit) * avg + crit * critAvg;
  const [lo, hi] = rollRange(weapon.roll);
  const itemKey = weapon.kind === "item" ? lookup("items", weapon.name, ctx.model.edition) : null;
  const field = SLOT_FIELD[slot];
  const spent = field ? ctx.turn[field] : false;
  return (
    <div className="rounded-lg border border-white/10 bg-black/35 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold text-white">{itemKey ? <LoreLink category="items" k={itemKey}>{weapon.name}</LoreLink> : weapon.name}</span>
            {weapon.mode && <Chip tone={weapon.current ? "gold" : "neutral"}>{weapon.mode}{weapon.current ? " · held now" : ""}</Chip>}
          </div>
          <div className="text-xs text-white/60">{weapon.range}{weapon.properties.length ? ` · ${weapon.properties.join(", ")}` : ""}</div>
        </div>
        <Button size="sm" variant="secondary" className="h-7" disabled={(ctx.incapacitated && slot !== "Reaction") || spent} onClick={() => ctx.use(slot)}>
          Use
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        <Mini label="To hit" value={`${signed(bonus)}${ctx.fx.die ? `${ctx.fx.die.sign > 0 ? "+" : "−"}1d${ctx.fx.die.sides}` : ""}`} sub={ctx.fx.die ? ctx.fx.dieFrom : undefined} />
        <Mini label="Damage" value={`${formatRoll(weapon.roll, false)}${on.map((p) => `+${formatRoll(p.roll, false)}`).join("")}`} sub={`${+avg.toFixed(1)} avg · ${lo}–${hi}${on.length ? "+" : ""}`} />
        <Mini label="Critical" value={formatRoll(critical(weapon.roll), false)} sub={`${+critAvg.toFixed(1)} avg`} />
        <Mini label={`vs AC ${ctx.targetAc}`} value={percent(hit)} sub={`${expected.toFixed(1)} dmg/attack`} />
      </div>
      <RollNote roll={roll} />
      <p className="mt-1.5 text-[11px] text-white/50">
        {weapon.roll.type}
        {attacks > 1 ? ` · ${attacks} attacks: about ${(expected * attacks).toFixed(1)} damage per Attack action` : ""}
        {crit > 0.05 ? ` · critical ${percent(crit)}` : ""}
      </p>
      {on.map((p) => (
        <p key={p.id} className="mt-1 text-[11px] text-red-100/90">
          +{formatRoll(p.roll)} ({p.label.toLowerCase()})
        </p>
      ))}
      {(weapon.notes ?? []).map((n) => (
        <p key={n} className="mt-1 text-[11px] text-sky-100/80">
          {n}
        </p>
      ))}
      {(weapon.masteryKnown ?? ctx.model.hasWeaponMastery) && weapon.properties.filter((p) => MASTERY[p]).map((p) => (
        <p key={p} className="mt-1 text-[11px] text-amber-100/80">
          <span className="font-semibold">Mastery: {p}.</span> {MASTERY[p]}
        </p>
      ))}
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-white/5 px-1 py-1">
      <div className="text-[9px] uppercase tracking-wider text-white/45">{label}</div>
      <div className="truncate text-sm font-semibold text-white">{value}</div>
      {sub && <div className="truncate text-[10px] text-white/50">{sub}</div>}
    </div>
  );
}

function UsePips({ max, spent }: { max: number; spent: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${max - spent} of ${max} left`}>
      {Array.from({ length: Math.min(max, 20) }, (_, i) => (
        <span key={i} className={cn("size-2.5 rotate-45 border border-amber-300/60", i < max - spent ? "bg-amber-300" : "bg-transparent")} />
      ))}
    </span>
  );
}

const RECHARGE: Record<string, string> = { turn: "per turn", short: "per short rest", long: "per long rest" };

function FeatureList({ ctx, features, note }: { ctx: Ctx; features: BattleFeature[]; note?: string }) {
  return (
    <ul className="mt-1 space-y-2">
      {note && <li className="text-[11px] uppercase tracking-wider text-white/45">{note}</li>}
      {features.map((f) => (
        <FeatureItem key={f.title} ctx={ctx} f={f} />
      ))}
    </ul>
  );
}

function FeatureItem({ ctx, f }: { ctx: Ctx; f: BattleFeature }) {
  const u = f.parsedUsage;
  const pool = u?.kind === "pool" ? findPool(ctx.model.features, u.pool) : undefined;
  const counted = u?.kind === "count" ? u : pool?.parsedUsage?.kind === "count" ? pool.parsedUsage : null;
  const owner = u?.kind === "count" ? f.title : pool?.title;
  const regainOne = u?.kind === "count" ? f.regainOnShort : !!pool?.regainOnShort;
  const spent = owner ? (ctx.state.uses[owner] ?? 0) : 0;
  const left = counted ? Math.max(0, counted.max - spent) : null;
  // big pools (Lay on Hands' hit points) and features that cost several points spend more than one at a time
  const [amount, setAmount] = useState(String(f.cost));
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  const many = !!counted && (counted.max > 10 || f.cost > 1);
  const field = SLOT_FIELD[f.slot];
  const blocked = (field && ctx.turn[field]) || (f.slot === "Reaction" ? ctx.noReactions : ctx.incapacitated && f.slot !== "Other");
  return (
    <li className="rounded-lg border border-white/10 bg-black/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{f.title}</span>
        {f.slot !== "Other" && <Chip>{f.slot}</Chip>}
        {u?.kind === "pool" && <Chip tone="gold">uses {f.cost > 1 ? `${f.cost} ` : ""}{u.pool}</Chip>}
        {f.dice && <Chip tone="blue">{f.dice}</Chip>}
        {counted && (
          <span className="inline-flex items-center gap-1.5 text-xs text-white/70">
            <UsePips max={counted.max} spent={spent} /> {left}/{counted.max} {RECHARGE[counted.recharge]}
            {regainOne ? " (one back per short rest)" : ""}
          </span>
        )}
        <span className="flex-1" />
        {many && (
          <Input inputMode="numeric" aria-label={`How much ${f.title} spends`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="h-7 w-14 border-white/20 bg-black/40 text-center text-white" />
        )}
        {(counted || f.slot !== "Other") && (
          <Button size="sm" variant="secondary" className="h-7" disabled={!!blocked || (left !== null && left < (many ? n : 1))} onClick={() => ctx.spendFeature(f, many ? n : 1)}>
            {many ? "Spend" : "Use"}
          </Button>
        )}
        {counted && spent > 0 && owner && (
          <Button size="sm" variant="ghost" className="h-7 text-white/60" onClick={() => ctx.updateCombat((c) => ({ ...c, uses: { ...c.uses, [owner]: Math.max(0, (c.uses[owner] ?? 0) - (many ? n : 1)) } }))}>
            Undo
          </Button>
        )}
      </div>
      <p className="mt-1 line-clamp-3 text-xs text-white/70 hover:line-clamp-none">{f.text}</p>
    </li>
  );
}

function StandardList({ ctx }: { ctx: Ctx }) {
  const lookup = useLoreLookup();
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {ctx.model.standard.map((a) => {
        const key = a.lore ? lookup("actions", a.lore, ctx.model.edition) : null;
        return (
          <li key={a.name} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/25 p-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">{key ? <LoreLink category="actions" k={key}>{a.name}</LoreLink> : a.name}</div>
              <p className="text-xs text-white/65">{a.text}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-white/80" disabled={ctx.turn.action || ctx.incapacitated} onClick={() => ctx.use("Action")}>
              Use
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function SlotsPanel({ ctx }: { ctx: Ctx }) {
  const levels = Object.keys(ctx.slotTotals).map(Number).sort((a, b) => a - b);
  if (levels.length === 0 && !ctx.pact) return null;
  return (
    <Panel title="Spell slots" icon={<ZapIcon className="size-4 text-sky-300" />}>
      <div className="flex flex-wrap gap-3">
        {levels.map((level) => {
          const total = ctx.slotTotals[level];
          const left = ctx.slotsLeft(level);
          return (
            <div key={level} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-white/55">{ordinal(level)} level</div>
              <div className="mt-1 flex gap-1">
                {Array.from({ length: total }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={i < left ? `Spend a ${ordinal(level)}-level slot` : `Get back a ${ordinal(level)}-level slot`}
                    onClick={() => ctx.updateMagic((m) => (i < left ? expendSlot(m, level, total) : restoreSlot(m, level)))}
                    className={cn("size-4 rounded-full border border-sky-300/60", i < left ? "bg-sky-400" : "bg-transparent")}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {ctx.pact && (
          <div className="rounded-lg border border-violet-300/30 bg-black/30 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-white/55">Pact slots · {ordinal(ctx.pact.level)} level · short rest</div>
            <div className="mt-1 flex gap-1">
              {Array.from({ length: ctx.pact.count }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={i < ctx.pactLeft ? "Spend a pact slot" : "Get back a pact slot"}
                  onClick={() => ctx.updateMagic((m) => setPactSpent(m, m.expendedPactSlots + (i < ctx.pactLeft ? 1 : -1), ctx.pact!.count))}
                  className={cn("size-4 rounded-full border border-violet-300/60", i < ctx.pactLeft ? "bg-violet-400" : "bg-transparent")}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-white/50">The same slots as the Magic tab: spending one here spends it there.</p>
    </Panel>
  );
}

function SpellList({ ctx, spells, grouped }: { ctx: Ctx; spells: BattleSpell[]; grouped?: boolean }) {
  const all = [...spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  if (!grouped) return <div className="grid gap-2 md:grid-cols-2">{all.map((s) => <SpellCard key={`${s.name}|${s.level}|${s.origin}|${s.item?.entryId ?? ""}`} ctx={ctx} spell={s} />)}</div>;
  // spells the character has but cannot cast now (a wizard's unprepared spellbook) go last, folded away
  const sorted = all.filter((s) => ctx.castable(s) && !s.item);
  const resting = all.filter((s) => !ctx.castable(s));
  // spells cast from magic items, by item
  const fromItems = all.filter((s) => s.item);
  const levels = [...new Set(sorted.map((s) => s.level))];
  return (
    <div className="flex flex-col gap-4">
      {resting.length > 0 && (
        <details className="order-last rounded-lg border border-dashed border-white/10 p-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-white/55">Not prepared ({resting.length}): prepare them on the Magic tab</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {resting.map((s) => (
              <SpellCard key={`${s.name}|${s.level}|${s.origin}|${s.item?.entryId ?? ""}`} ctx={ctx} spell={s} />
            ))}
          </div>
        </details>
      )}
      {levels.map((level) => (
        <div key={level}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/55">{level === 0 ? "Cantrips" : `${ordinal(level)} level`}</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {sorted.filter((s) => s.level === level).map((s) => (
              <SpellCard key={`${s.name}|${s.level}|${s.origin}|${s.item?.entryId ?? ""}`} ctx={ctx} spell={s} />
            ))}
          </div>
        </div>
      ))}
      {fromItems.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-violet-200/70">From magic items (their charges)</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {[...fromItems].sort((a, b) => a.castingName.localeCompare(b.castingName) || a.item!.cost - b.item!.cost).map((s) => (
              <SpellCard key={`${s.name}|${s.level}|${s.origin}|${s.item?.entryId ?? ""}`} ctx={ctx} spell={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpellCard({ ctx, spell }: { ctx: Ctx; spell: BattleSpell }) {
  const lookup = useLoreLookup();
  const item = ctx.chargedItemOf(spell);
  const chargesLeft = item ? Math.max(0, (item.charges ?? 0) - item.chargesUsed) : 0;
  const levels = spell.item
    ? itemLevels(spell, chargesLeft)
    : spell.level === 0
      ? [0]
      : Array.from({ length: 10 - spell.level }, (_, i) => spell.level + i).filter((l) => (ctx.slotTotals[l] ?? 0) > 0 || l === spell.level);
  const pactUsable = !spell.item && !!ctx.pact && spell.level > 0 && spell.level <= ctx.pact.level;
  const firstFree = levels.find((l) => ctx.slotsLeft(l) > 0);
  const [choice, setChoice] = useState<string>(spell.item ? String(spell.item.level) : pactUsable && ctx.pactLeft > 0 ? "pact" : String(firstFree ?? spell.level));
  const usePact = choice === "pact";
  const castAt = usePact && ctx.pact ? ctx.pact.level : Number(choice);
  const effect = withBonus(spellEffect(spell, castAt, ctx.data.level, spell.modifier), spell.damageBonus);
  const key = lookup("spells", spell.name, ctx.model.edition);
  const ready = ctx.castable(spell);
  const field = SLOT_FIELD[spell.slot];
  const spent = field ? ctx.turn[field] : false;
  const needsAttunement = !!spell.item && !!item?.requiresAttunement && !item.attuned;
  const noSlot = spell.item ? chargesFor(spell, castAt) > chargesLeft : item ? item.chargesUsed >= (item.charges ?? 0) : spell.level > 0 && (usePact ? ctx.pactLeft <= 0 : ctx.slotsLeft(castAt) <= 0);
  const blocked = spell.slot === "Reaction" ? ctx.noReactions : ctx.incapacitated;
  const bonus = spell.attackBonus - ctx.d20Penalty + ctx.fx.attackBonus;
  // touch and melee spell attacks count as melee for the target's conditions (Prone)
  const attackRollOf = ctx.rollFor(effect.attack === "melee");
  const save = effect.save ? ctx.targetSaveFor(effect.save) : null;
  return (
    <div className={cn("rounded-lg border bg-black/35 p-3", ready ? "border-white/10" : "border-dashed border-white/10 opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">
            {key ? <LoreLink category="spells" k={key}>{spell.name}</LoreLink> : spell.name}
            {spell.concentration && <span title="Concentration" className="ml-1.5 rounded bg-amber-300/20 px-1 text-[10px] text-amber-100">C</span>}
            {spell.ritual && <span title="Ritual" className="ml-1 rounded bg-white/10 px-1 text-[10px] text-white/70">R</span>}
          </div>
          <div className="text-[11px] text-white/55">
            {[spell.time, spell.range, spell.duration, spell.components].filter(Boolean).join(" · ")}
          </div>
          {!ready && <div className="text-[11px] text-amber-200/80">Not prepared</div>}
          {needsAttunement && <div className="text-[11px] text-amber-200/80">Attune to {item!.name} first (Equipment tab)</div>}
        </div>
        {spell.item && levels.length > 1 ? (
          <select aria-label="Charges" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-7 rounded-md border border-violet-300/40 bg-black/60 px-1 text-xs text-violet-100">
            {levels.map((l) => (
              <option key={l} value={l}>
                {ordinal(l)}: {chargesFor(spell, l)} of {chargesLeft} charges
              </option>
            ))}
          </select>
        ) : spell.item ? (
          <span className="rounded-md border border-violet-300/40 px-1.5 py-1 text-[11px] text-violet-100">
            {chargesFor(spell, castAt) ? `${chargesFor(spell, castAt)} of ${chargesLeft} charges` : "no charge"}
          </span>
        ) : item && (
          <span className="rounded-md border border-violet-300/40 px-1.5 py-1 text-[11px] text-violet-100">
            {item.name}: {Math.max(0, (item.charges ?? 0) - item.chargesUsed)} charges
          </span>
        )}
        {spell.level > 0 && !item && (
          <select aria-label="Cast with" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-7 rounded-md border border-white/20 bg-black/60 px-1 text-xs text-white">
            {levels.map((l) => (
              <option key={l} value={l}>
                {ordinal(l)} ({ctx.slotsLeft(l)} left)
              </option>
            ))}
            {pactUsable && <option value="pact">Pact {ordinal(ctx.pact!.level)} ({ctx.pactLeft} left)</option>}
          </select>
        )}
        <Button size="sm" className="h-7 bg-sky-500 text-black hover:bg-sky-400" disabled={!ready || noSlot || spent || blocked || needsAttunement} onClick={() => ctx.cast(spell, castAt, usePact)}>
          Cast
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {effect.attack && <Chip tone="gold">{signed(bonus)} {effect.attack} spell attack · {percent(hitChanceWithDie(bonus, ctx.targetAc, attackRollOf.advantage, ctx.fx.die).hit)} vs AC {ctx.targetAc}</Chip>}
        {effect.save && <Chip tone="gold">DC {spell.saveDc} {effect.save} save{effect.halfOnSave ? " · half on a success" : ""}</Chip>}
        {save && (save.autoFail || save.advantage !== "normal" || save.bonus !== undefined || save.notes.length > 0) && (
          <Chip tone={save.autoFail ? "red" : "blue"}>
            {save.autoFail
              ? save.notes[0]
              : [save.bonus !== undefined && `fails ${percent(failChanceWith(spell.saveDc, save.bonus, save.advantage))} (its save ${signed(save.bonus)})`, ...save.notes].filter(Boolean).join(" · ")}
          </Chip>
        )}
        {effect.damage.map((r) => (
          <Chip key={r.type} tone="red">
            {effect.beams > 1 ? `${effect.beams} × ` : ""}
            {formatRoll(r)} ({average(r)} avg{effect.attack ? `, crit ${formatRoll(critical(r), false)}` : ""})
          </Chip>
        ))}
        {effect.beams > 1 && effect.damage[0] && <Chip>{(effect.beams * average(effect.damage[0])).toFixed(1)} if all hit</Chip>}
        {effect.healing && <Chip tone="green">Heals {formatRoll(effect.healing, false)} ({average(effect.healing)} avg)</Chip>}
        {effect.temporary && <Chip tone="blue">{formatRoll(effect.temporary, false)} temporary hit points</Chip>}
        {castAt > spell.level && spell.level > 0 && (effect.upcastDice.length > 0 || effect.upcastHealing.length > 0) && <Chip tone="blue">upcast +{castAt - spell.level} level{castAt - spell.level > 1 ? "s" : ""}</Chip>}
        {spell.damageBonusFrom && <Chip tone="gold">+{spell.damageBonus} {spell.damageBonusFrom}</Chip>}
        <Chip>{spell.castingName ? `${spell.castingName} · ` : ""}{spell.slot === "Other" ? spell.time : spell.slot}</Chip>
      </div>
      {effect.attack && <RollNote roll={attackRollOf} />}
      {effect.upcastNote && <p className="mt-1.5 text-[11px] text-sky-100/70">Higher slot: {effect.upcastNote}</p>}
      <details className="mt-1.5 text-xs text-white/65">
        <summary className="cursor-pointer text-white/50">Description</summary>
        <p className="mt-1 whitespace-pre-line">{plainSpellText(spell.description)}</p>
      </details>
    </div>
  );
}

/** The charges an item spell costs at a level: its cost, plus one per level above the item's own when it allows that. */
function chargesFor(spell: BattleSpell, level: number): number {
  return spell.item ? spell.item.cost + Math.max(0, level - spell.item.level) : 0;
}

/** The levels an item can cast its spell at: its own, and higher ones for more charges (no more than it allows, 9th at most). */
function itemLevels(spell: BattleSpell, chargesLeft: number): number[] {
  const it = spell.item!;
  if (!it.upcast || it.level === 0) return [it.level];
  const most = Math.max(it.cost, Math.min(it.maxCost ?? Infinity, chargesLeft));
  return Array.from({ length: Math.min(9, it.level + most - it.cost) - it.level + 1 }, (_, i) => it.level + i);
}

/** A feature's bonus to a spell's damage, added to its first damage roll (each beam's, for Eldritch Blast). */
function withBonus(effect: ReturnType<typeof spellEffect>, bonus: number) {
  if (!bonus || effect.damage.length === 0) return effect;
  return { ...effect, damage: [{ ...effect.damage[0], bonus: effect.damage[0].bonus + bonus }, ...effect.damage.slice(1)] };
}

// ---- rests

/**
 * Hit dice by size: one pool per die (a fighter 5 / wizard 2 has 5 d10 and 2 d6). A single-class character keeps
 * the one count it always had; a multiclass character's spent dice are kept per size ("Hit Dice d10" in uses).
 */
function hitDiceOf(data: SheetData, state: CombatState, total: number) {
  const pools = data.hitDicePools?.length ? data.hitDicePools : [{ sides: data.hitDie ?? 8, count: total }];
  const multi = pools.length > 1;
  const key = (sides: number) => `Hit Dice d${sides}`;
  const leftOf = (sides: number) => {
    const count = pools.find((p) => p.sides === sides)?.count ?? 0;
    return Math.max(0, count - (multi ? (state.uses[key(sides)] ?? 0) : state.hitDiceSpent));
  };
  return { pools, multi, leftOf, key };
}

function RestDialog({ kind, onClose, ctx, totalHitDice }: { kind: "short" | "long" | null; onClose: () => void; ctx: Ctx; totalHitDice: number }) {
  const { data, model, state } = ctx;
  const [dice, setDice] = useState(0);
  const [rolled, setRolled] = useState<number[] | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const { pools, multi, leftOf, key } = hitDiceOf(data, state, totalHitDice);
  const con = model.mod("CON");
  // a multiclass character picks which hit dice to spend (the biggest with some left, to start)
  const die = size ?? pools.find((p) => leftOf(p.sides) > 0)?.sides ?? pools[0]?.sides ?? 8;
  const left = leftOf(die);
  const averageHeal = dice * Math.max(0, Math.floor(die / 2) + 1 + con);
  const shortBack = model.features.filter((f) => f.parsedUsage?.kind === "count" && (f.parsedUsage.recharge === "short" || f.parsedUsage.recharge === "turn" || f.regainOnShort) && (state.uses[f.title] ?? 0) > 0);
  const longBack = model.features.filter((f) => f.parsedUsage?.kind === "count" && (state.uses[f.title] ?? 0) > 0);
  const close = () => {
    setDice(0);
    setRolled(null);
    onClose();
  };
  const finishShort = (healed: number) => {
    ctx.updateCombat((c) => {
      const rested = { ...restShort(c, model.features, healed, dice), effects: (c.effects ?? []).filter((k) => effectFor(k, ctx.effectCtx)?.longLasting) };
      // a multiclass character's spent dice are kept by size too
      return multi && dice > 0 ? { ...rested, uses: { ...rested.uses, [key(die)]: (rested.uses[key(die)] ?? 0) + dice } } : rested;
    });
    if (ctx.pact) ctx.updateMagic(slotsShort);
    toast.success(`Short rest: ${healed} hit points back${shortBack.length ? `, ${shortBack.map((f) => f.title).join(", ")} back` : ""}${ctx.pact ? ", pact slots back" : ""}.`);
    close();
  };
  const finishLong = () => {
    ctx.updateCombat((c) => {
      const rested = restLong(c, model.features, totalHitDice, model.edition);
      if (!multi) return rested;
      // dice back by size, the biggest first: all of them (2024) or half the total (2014)
      let back = model.edition === "2024" ? Infinity : Math.max(1, Math.floor(totalHitDice / 2));
      const uses = { ...rested.uses };
      for (const p of pools) {
        const spent = c.uses[key(p.sides)] ?? 0;
        const regained = Math.min(spent, back);
        back -= regained;
        if (spent - regained > 0) uses[key(p.sides)] = spent - regained;
        else delete uses[key(p.sides)];
      }
      return { ...rested, uses };
    });
    ctx.updateMagic(slotsLong);
    toast.success("Long rest: hit points, spell slots and features are back.");
    close();
  };
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {kind === "short" ? (
          <>
            <DialogHeader>
              <DialogTitle>Short rest</DialogTitle>
              <DialogDescription>
                At least an hour of rest. Spend hit dice to heal: each heals its roll {con >= 0 ? "+" : "−"} {Math.abs(con)} (Constitution).{" "}
                {multi ? `You have ${pools.map((p) => `${leftOf(p.sides)} d${p.sides}`).join(" and ")} left.` : `You have ${left} of ${totalHitDice} d${die} left.`}
              </DialogDescription>
            </DialogHeader>
            {multi && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which hit dice">
                {pools.map((p) => (
                  <Button
                    key={p.sides}
                    size="sm"
                    variant={p.sides === die ? "default" : "outline"}
                    disabled={leftOf(p.sides) === 0}
                    onClick={() => {
                      setSize(p.sides);
                      setDice(0);
                      setRolled(null);
                    }}
                  >
                    d{p.sides} ({leftOf(p.sides)} left)
                  </Button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" aria-label="One die fewer" onClick={() => setDice((d) => Math.max(0, d - 1))}>
                <MinusIcon />
              </Button>
              <span className="w-24 text-center text-lg font-semibold">
                {dice} d{die}
              </span>
              <Button size="icon" variant="outline" aria-label="One die more" onClick={() => setDice((d) => Math.min(left, d + 1))}>
                <PlusIcon />
              </Button>
            </div>
            {rolled && (
              <p className="text-sm">
                Rolled {rolled.join(" + ")} {con !== 0 ? `${con > 0 ? "+" : "−"} ${Math.abs(con)} × ${dice}` : ""} = <strong>{rolled.reduce((s, r) => s + Math.max(0, r + con), 0)}</strong>
              </p>
            )}
            <ul className="text-sm text-muted-foreground">
              <li>Comes back: {shortBack.length ? shortBack.map((f) => f.title).join(", ") : "no short-rest features are spent"}{ctx.pact ? "; pact magic slots" : ""}.</li>
            </ul>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                disabled={dice === 0}
                onClick={() => setRolled(Array.from({ length: dice }, () => rollDice({ dice: [{ count: 1, sides: die }], bonus: 0, type: "" })))}
              >
                Roll {dice} d{die}
              </Button>
              <Button onClick={() => finishShort(rolled ? rolled.reduce((s, r) => s + Math.max(0, r + con), 0) : averageHeal)}>
                Rest{dice > 0 ? (rolled ? " with the roll" : ` (average ${averageHeal})`) : ""}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Long rest</DialogTitle>
              <DialogDescription>At least 8 hours, sleeping for most of it.</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>All hit points back; temporary hit points end.</li>
              <li>All spell slots back{ctx.pact ? ", pact slots too" : ""}.</li>
              <li>{model.edition === "2024" ? "All spent hit dice back." : `Half your hit dice back (${Math.max(1, Math.floor(totalHitDice / 2))}).`}</li>
              <li>Features back: {longBack.length ? longBack.map((f) => f.title).join(", ") : "none are spent"}.</li>
              {state.exhaustion > 0 && <li>Exhaustion goes down by one (to {state.exhaustion - 1}).</li>}
              {state.concentration && <li>Concentration on {state.concentration} ends.</li>}
            </ul>
            <DialogFooter>
              <Button onClick={finishLong}>Take the long rest</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- the target (encounter mode)

type TargetPick = { campaignId: string; entryId: string; combatantId: string };

/** Spells that put a condition on their target, offered as a mark after casting. */
const SPELL_MARKS: Record<string, { condition: string; when: string }> = {
  "faerie fire": { condition: "Faerie Fire", when: "If it failed its Dexterity save." },
  "guiding bolt": { condition: "Guiding Bolt", when: "If it hit: the next attack against it has advantage." },
  hex: { condition: "Hex", when: "Your hits on it deal an extra 1d6 necrotic." },
  "hunter's mark": { condition: "Hunter's Mark", when: "Your hits on it deal an extra 1d6." },
  "hunter’s mark": { condition: "Hunter's Mark", when: "Your hits on it deal an extra 1d6." },
  bane: { condition: "Bane", when: "If it failed its Charisma save." },
  "hold person": { condition: "Paralyzed", when: "If it failed its Wisdom save." },
  "hold monster": { condition: "Paralyzed", when: "If it failed its Wisdom save." },
  web: { condition: "Restrained", when: "If it failed its Dexterity save." },
  entangle: { condition: "Restrained", when: "If it failed its Strength save." },
  "ensnaring strike": { condition: "Restrained", when: "If it failed its Strength save." },
  "cause fear": { condition: "Frightened", when: "If it failed its Wisdom save." },
  fear: { condition: "Frightened", when: "If it failed its Wisdom save." },
  "blindness/deafness": { condition: "Blinded", when: "If it failed its Constitution save." },
  sleep: { condition: "Unconscious", when: "If it fell asleep." },
  "tasha's hideous laughter": { condition: "Prone", when: "If it failed its Wisdom save (it is Incapacitated too)." },
  "tasha’s hideous laughter": { condition: "Prone", when: "If it failed its Wisdom save (it is Incapacitated too)." },
  command: { condition: "Prone", when: "If you commanded it to grovel and it failed its save." },
  "ray of enfeeblement": { condition: "Poisoned", when: "2024: if it failed its Constitution save." },
  "color spray": { condition: "Blinded", when: "If it was blinded." },
  "tidal wave": { condition: "Prone", when: "If it failed its Dexterity save." },
  thunderwave: { condition: "Prone", when: "Only if a feature knocks it prone." },
};

/** Why an attack has advantage or disadvantage, and a critical hit by itself. */
function RollNote({ roll }: { roll: AttackRoll }) {
  if (roll.advantage === "normal" && !roll.for.length && !roll.against.length && !roll.autoCrit && !roll.notes.length) return null;
  const word = roll.advantage === "advantage" ? "Advantage" : roll.advantage === "disadvantage" ? "Disadvantage" : "Normal roll";
  return (
    <p className={cn("mt-1.5 text-[11px]", roll.advantage === "advantage" ? "text-emerald-200" : roll.advantage === "disadvantage" ? "text-red-200" : "text-white/60")}>
      <span className="font-semibold">{word}</span>
      {roll.for.length > 0 && ` · for: ${roll.for.join(", ")}`}
      {roll.against.length > 0 && ` · against: ${roll.against.join(", ")}`}
      {roll.autoCrit && " · a hit within 5 ft is a critical hit"}
      {roll.notes.length > 0 && ` · ${roll.notes.join(", ")}`}
    </p>
  );
}

/**
 * Who the character attacks: a creature of a running fight in its campaigns (with the conditions the DM and party
 * marked, its armor class when the DM shares it), or a target described by hand (armor class and conditions).
 * Conditions marked here are marked in the fight for everyone.
 */
function TargetPanel(p: {
  me: string;
  fights: FightView[];
  pick: TargetPick | null;
  setPick: (t: TargetPick | null) => void;
  target: Combatant | null;
  conditions: FightCondition[];
  manualAc: number;
  setManualAc: (n: number) => void;
  advantage: Advantage;
  setAdvantage: (a: Advantage) => void;
  within5: boolean;
  setWithin5: (b: boolean) => void;
  rollFor: (melee: boolean) => AttackRoll;
  toggle: (name: string, on: boolean) => void;
  busy: boolean;
}) {
  const value = p.pick ? `${p.pick.campaignId}|${p.pick.entryId}|${p.pick.combatantId}` : "";
  const melee = p.rollFor(true);
  const ranged = p.rollFor(false);
  const word = (r: AttackRoll) => (r.advantage === "advantage" ? "advantage" : r.advantage === "disadvantage" ? "disadvantage" : "normal");
  const myTurn = p.fights.find((f) => f.fight.turn && f.fight.combatants.find((c) => c.id === f.fight.turn)?.characterId === p.me);
  return (
    <Panel title={p.target ? `Target: ${p.target.name}` : "Target"} icon={<CrosshairIcon className="size-4 text-amber-300" />}>
      {p.fights.map((f) => {
        const current = f.fight.combatants.find((c) => c.id === f.fight.turn);
        return (
          <p key={f.entryId} className={cn("mb-2 text-xs", myTurn === f ? "font-semibold text-amber-200" : "text-white/65")}>
            {f.campaignName}: {f.title}, round {f.fight.round}
            {current ? ` · ${myTurn === f ? "your turn!" : `${current.name}'s turn`}` : ""}{" "}
            <Link to={`/campaigns/${f.campaignId}/fight/${f.entryId}`} className="underline decoration-white/30 hover:text-white">
              order of play
            </Link>
          </p>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.fights.length > 0 && (
          <select
            aria-label="Target"
            value={value}
            onChange={(e) => {
              const [campaignId, entryId, combatantId] = e.target.value.split("|");
              p.setPick(e.target.value ? { campaignId, entryId, combatantId } : null);
            }}
            className="h-7 max-w-64 rounded-md border border-white/20 bg-black/60 px-1 text-white"
          >
            <option value="">Someone else (describe below)</option>
            {p.fights.map((f) => (
              <optgroup key={f.entryId} label={f.title}>
                {inOrder(f.fight.combatants)
                  .filter((c) => c.characterId !== p.me)
                  .map((c) => (
                    <option key={c.id} value={`${f.campaignId}|${f.entryId}|${c.id}`}>
                      {c.name}
                      {c.health ? ` (${c.health})` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-white/70">
          AC
          {p.target?.ac != null ? (
            <span className="font-semibold text-white">{p.target.ac}</span>
          ) : (
            <Input aria-label="Target AC" inputMode="numeric" value={p.manualAc} onChange={(e) => p.setManualAc(Math.min(40, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)))} className="h-7 w-14 border-white/20 bg-black/40 text-center text-white" />
          )}
        </label>
        <label className="flex items-center gap-1.5 text-white/70">
          <input type="checkbox" checked={p.within5} onChange={(e) => p.setWithin5(e.target.checked)} /> within 5 ft
        </label>
        <span className="flex-1" />
        <span className="text-white/55">Your own:</span>
        <div className="flex overflow-hidden rounded-md border border-white/15" role="group" aria-label="Attack rolls">
          {(["disadvantage", "normal", "advantage"] as const).map((a) => (
            <button key={a} type="button" aria-pressed={p.advantage === a} onClick={() => p.setAdvantage(a)} className={cn("px-2 py-1 capitalize", p.advantage === a ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10")}>
              {a === "normal" ? "Normal" : a === "advantage" ? "Adv." : "Disadv."}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {MARKS.map((m) => {
          const on = p.conditions.some((c) => c.name === m.name);
          const by = p.conditions.find((c) => c.name === m.name)?.by;
          return (
            <button
              key={m.name}
              type="button"
              aria-pressed={on}
              disabled={p.busy}
              title={`${m.note}${by ? ` · marked by ${by}` : ""}`}
              onClick={() => p.toggle(m.name, !on)}
              className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-violet-300/70 bg-violet-500/30 text-violet-50" : "border-white/15 text-white/55 hover:bg-white/10")}
            >
              {m.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-white/70">
        Melee: <span className={melee.advantage === "advantage" ? "text-emerald-200" : melee.advantage === "disadvantage" ? "text-red-200" : ""}>{word(melee)}</span> · Ranged:{" "}
        <span className={ranged.advantage === "advantage" ? "text-emerald-200" : ranged.advantage === "disadvantage" ? "text-red-200" : ""}>{word(ranged)}</span>
        {p.target ? " · marks are shared with the DM and party" : ""}
      </p>
    </Panel>
  );
}
