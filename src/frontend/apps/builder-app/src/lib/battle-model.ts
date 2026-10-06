/**
 * What a character can do in a fight, worked out from its sheet (lib/api/sheet) for the Battle Action Simulator:
 * its weapon attacks (and unarmed strike, off-hand attack, opportunity attack), the features it can use as an
 * action, bonus action or reaction, the standard actions of its rules edition, and its spells with the attack
 * bonus or save DC of the spellcasting they belong to. Only what the sheet says the character has is listed.
 */
import type { SheetData, SheetFeature, SheetSpell } from "@/lib/api/sheet";
import { attackBonusOf, castingAction, findPool, itemRiders, type ItemRider, parseRoll, parseUsage, poolFromText, regainsOneOnShortRest, signed, ABILITIES, type Roll, type Usage } from "@/lib/rules/battle";

export type Slot = "Action" | "Bonus Action" | "Reaction" | "Attack" | "Other";

export interface WeaponAttack {
  name: string;
  /** the inventory entry, for its magic item's powers */
  entryId?: string;
  /** how it is used ("Two hands", "Thrown"), when the weapon can be used more than one way */
  mode?: string;
  /** held this way now; an item weapon not equipped must be drawn first */
  current?: boolean;
  equipped?: boolean;
  notes?: string[];
  greatWeapon?: "2014" | "2024";
  /** the character picked this weapon's mastery; without modes (no inventory data), whether it has Weapon Mastery */
  masteryKnown?: boolean;
  range: string;
  bonus: number;
  roll: Roll;
  properties: string[];
  melee: boolean;
  /** "item" when it is on the character's sheet, "unarmed" for the unarmed strike */
  kind: "item" | "unarmed";
}

export interface BattleFeature extends SheetFeature {
  slot: Slot;
  parsedUsage: Usage | null;
  /** one use back on a short rest, all on a long one */
  regainOnShort: boolean;
  /** how many points of its pool one use costs ("spend 2 sorcery points") */
  cost: number;
  /** dice in its text, e.g. Sneak Attack's "2d6" */
  dice: string | null;
}

export interface StandardAction {
  name: string;
  slot: Slot;
  text: string;
  /** the compendium entry ("actions") to link, by name */
  lore?: string;
}

export interface BattleSpell extends SheetSpell {
  slot: Slot;
  /** the spellcasting it is cast with: its attack bonus, save DC and ability modifier */
  attackBonus: number;
  saveDc: number;
  modifier: number;
  castingName: string;
  /** the modifier a feature adds to its damage (Agonizing Blast, Potent Spellcasting, Empowered Evocation) */
  damageBonus: number;
  damageBonusFrom: string | null;
  /** cast from a magic item (a wand, a staff): its charges pay for it, more charges for a higher level when it allows */
  item?: { entryId: string; name: string; cost: number; level: number; upcast: boolean; maxCost: number | null };
}

export interface BattleModel {
  edition: "2014" | "2024";
  mod: (abbreviation: string) => number;
  weapons: WeaponAttack[];
  unarmed: WeaponAttack;
  offHand: WeaponAttack[];
  /** whether each off-hand attack takes a bonus action, or is part of the Attack action (Nick) */
  offHandAction: Record<string, "Attack" | "Bonus Action">;
  opportunity: WeaponAttack | null;
  features: BattleFeature[];
  standard: StandardAction[];
  spells: BattleSpell[];
  /** a magic weapon's extra damage from its text, by inventory entry (Flame Tongue ablaze, Holy Avenger vs fiends) */
  riders: Record<string, ItemRider[]>;
  grapple: string;
  hasWeaponMastery: boolean;
}

const ABBREVIATION: Record<string, string> = Object.fromEntries(ABILITIES.map((a) => [a, a.slice(0, 3).toUpperCase()]));

function slotOf(action: string | null | undefined): Slot {
  const a = (action ?? "").toLowerCase();
  if (a.includes("bonus")) return "Bonus Action";
  if (a.includes("reaction")) return "Reaction";
  if (a === "attack") return "Attack";
  if (a === "rage") return "Bonus Action";
  if (a.includes("action") || a === "dodge") return "Action";
  return "Other";
}

/** A feature's action: its sheet entry's own, or what its text says ("As a bonus action, you can…"). */
function featureSlot(f: SheetFeature): Slot {
  // some sheet entries put the action in the usage line ("Slow Fall": Reaction)
  if (!f.action && /^(action|bonus action|reaction)$/i.test((f.usage ?? "").trim())) return slotOf(f.usage);
  if (f.action) {
    // Aurora names some bonus actions after themselves (Flurry of Blows, Step of the Wind)
    if (/^(flurry of blows|step of the wind|blade flourish)$/i.test(f.action)) return "Bonus Action";
    if (/^action surge$/i.test(f.action)) return "Other";
    return slotOf(f.action);
  }
  const t = f.text.slice(0, 400);
  if (/\bwhen you take the attack action\b/i.test(t)) return "Attack";
  if (/\bas a bonus action\b|\buse a bonus action\b|\btake a bonus action\b|\bbonus action\b to\b/i.test(t)) return "Bonus Action";
  if (/\bas a reaction\b|\buse your reaction\b|\btake a reaction\b|\byour reaction to\b/i.test(t)) return "Reaction";
  if (/\bas an action\b|\buse your action\b|\btake the magic action\b|\bas a magic action\b|\btake a magic action\b/i.test(t)) return "Action";
  return "Other";
}

function weaponFrom(line: SheetData["attacks"][number]): WeaponAttack | null {
  const roll = parseRoll(line.damage);
  const bonus = attackBonusOf(line.attack);
  if (!roll || bonus === null) return null;
  const properties = line.description ? line.description.split(/,\s*/).filter(Boolean) : [];
  const ranged = /\//.test(line.range) || /\b(?:[2-9]\d|\d{3,}) ft/.test(line.range);
  return { name: line.name, range: line.range, bonus, roll, properties, melee: !ranged || properties.includes("Thrown"), kind: "item" };
}

/** The spellcasting a spell is cast with: the one named in its origin, else the ability its origin names, else the first. */
function castingFor(data: SheetData, spell: SheetSpell): { attackBonus: number; saveDc: number; modifier: number; castingName: string } {
  const mod = (abbreviation: string) => data.abilities.find((a) => a.abbreviation === abbreviation)?.calculatedModifier ?? 0;
  const own = data.spellcasting.find((c) => spell.origin.includes(c.name));
  const pick = own ?? null;
  if (pick) {
    const m = mod(ABBREVIATION[pick.ability] ?? pick.ability.slice(0, 3).toUpperCase());
    return { attackBonus: pick.attackBonus, saveDc: pick.saveDc, modifier: m, castingName: pick.name };
  }
  const ability = ABILITIES.find((a) => spell.ability === a) ?? ABILITIES.find((a) => spell.origin.startsWith(a) || spell.origin.includes(`(${a})`));
  if (ability) {
    const m = mod(ABBREVIATION[ability]);
    return { attackBonus: data.proficiencyBonus + m, saveDc: 8 + data.proficiencyBonus + m, modifier: m, castingName: ability };
  }
  const first = data.spellcasting[0];
  if (first) {
    const m = mod(ABBREVIATION[first.ability] ?? first.ability.slice(0, 3).toUpperCase());
    return { attackBonus: first.attackBonus, saveDc: first.saveDc, modifier: m, castingName: first.name };
  }
  const best = Math.max(mod("INT"), mod("WIS"), mod("CHA"));
  return { attackBonus: data.proficiencyBonus + best, saveDc: 8 + data.proficiencyBonus + best, modifier: best, castingName: "" };
}

/** The standard actions every creature has, in the character's edition's words. */
function standardActions(edition: "2014" | "2024", data: SheetData, speed: number): StandardAction[] {
  const skill = (name: string) => data.skills.find((s) => s.name === name)?.calculatedBonus ?? 0;
  const both: StandardAction[] = [
    { name: "Dash", slot: "Action", text: `Gain extra movement equal to your speed (+${speed} ft this turn).`, lore: "Dash" },
    { name: "Disengage", slot: "Action", text: "Your movement doesn't provoke opportunity attacks for the rest of the turn.", lore: "Disengage" },
    { name: "Dodge", slot: "Action", text: "Until your next turn, attacks against you have disadvantage (if you can see the attacker) and you have advantage on Dexterity saves.", lore: "Dodge" },
    { name: "Help", slot: "Action", text: "Give an ally advantage on its next ability check, or on its next attack against a creature within 5 ft of you.", lore: "Help" },
    { name: "Hide", slot: "Action", text: `Dexterity (Stealth) check: ${signed(skill("Stealth"))}${edition === "2024" ? " against DC 15, out of sight and behind cover." : "."}`, lore: "Hide" },
    { name: "Ready", slot: "Action", text: "Choose a trigger and an action (or a spell, holding concentration); use your reaction when it happens.", lore: "Ready" },
    { name: "Search", slot: "Action", text: `Wisdom (Perception) ${signed(skill("Perception"))} or Intelligence (Investigation) ${signed(skill("Investigation"))}.`, lore: "Search" },
  ];
  if (edition === "2024") {
    both.push(
      { name: "Influence", slot: "Action", text: `Persuade or deceive a creature: Persuasion ${signed(skill("Persuasion"))}, Deception ${signed(skill("Deception"))}, Intimidation ${signed(skill("Intimidation"))}.`, lore: "Influence" },
      { name: "Magic", slot: "Action", text: "Cast a spell with a casting time of an action, use a magic item, or a magical feature.", lore: "Magic" },
      { name: "Study", slot: "Action", text: `Recall or work something out: Arcana ${signed(skill("Arcana"))}, History ${signed(skill("History"))}, Nature ${signed(skill("Nature"))}, Religion ${signed(skill("Religion"))}.`, lore: "Study" },
      { name: "Utilize", slot: "Action", text: "Use a nonmagical object (pull a lever, light a torch, drink a potion).", lore: "Utilize" },
    );
  } else {
    both.push({ name: "Use an Object", slot: "Action", text: "Interact with a second object, or one that takes an action (drink a potion, pull a lever).", lore: "Use an Object" });
  }
  return both;
}

export function buildBattleModel(data: SheetData): BattleModel {
  const edition = data.edition;
  const mod = (abbreviation: string) => data.abilities.find((a) => a.abbreviation === abbreviation)?.calculatedModifier ?? 0;
  const str = mod("STR");
  const dex = mod("DEX");
  const has = (title: RegExp) => [...data.features, ...data.speciesTraits].some((f) => title.test(f.title));

  // every way each carried weapon can attack (one hand, two hands, thrown); the sheet's lines when there are none
  const byWeapon = new Map<string, number>();
  for (const m of data.attackModes ?? []) byWeapon.set(m.entryId, (byWeapon.get(m.entryId) ?? 0) + (m.mode === "Off hand" ? 0 : 1));
  const fromMode = (m: SheetData["attackModes"][number]): WeaponAttack | null => {
    const roll = parseRoll(m.damage);
    if (!roll) return null;
    return {
      name: m.name,
      entryId: m.entryId,
      mode: (byWeapon.get(m.entryId) ?? 0) > 1 || m.mode === "Thrown" || m.mode === "Off hand" ? m.mode : undefined,
      current: m.current,
      equipped: m.equipped,
      notes: m.notes,
      greatWeapon: m.greatWeapon,
      masteryKnown: m.masteryKnown,
      range: m.range,
      bonus: m.toHit,
      roll,
      properties: m.properties,
      melee: m.mode !== "Ranged" && m.mode !== "Thrown",
      kind: "item",
    };
  };
  const modes = data.attackModes ?? [];
  const weapons = modes.length
    ? modes.filter((m) => m.mode !== "Off hand").map(fromMode).filter((w): w is WeaponAttack => w !== null)
    : data.attacks.map(weaponFrom).filter((w): w is WeaponAttack => w !== null);

  // unarmed strike: 1 + Strength bludgeoning; a monk's Martial Arts die and Dexterity
  const martialArts = data.features.find((f) => /^Martial Arts\b/i.test(f.title));
  const martialDie = martialArts?.text.match(/\b1?d(4|6|8|10|12)\b/)?.[1];
  const unarmedAbility = martialArts ? Math.max(str, dex) : str;
  const unarmed: WeaponAttack = {
    name: "Unarmed Strike",
    range: "5 ft",
    bonus: unarmedAbility + data.proficiencyBonus,
    roll: martialDie ? { dice: [{ count: 1, sides: Number(martialDie) }], bonus: unarmedAbility, type: "bludgeoning" } : { dice: [], bonus: 1 + unarmedAbility, type: "bludgeoning" },
    properties: martialArts ? ["Martial Arts"] : [],
    melee: true,
    kind: "unarmed",
  };

  // the extra attack of the Light property, with what the fighting styles and Nick change (lib/rules/items)
  const offHand = modes.filter((m) => m.mode === "Off hand").map(fromMode).filter((w): w is WeaponAttack => w !== null);
  const offHandAction = Object.fromEntries(modes.filter((m) => m.mode === "Off hand").map((m) => [m.name, m.action]));

  const meleeWeapons = weapons.filter((w) => w.melee && w.equipped !== false);
  const opportunity = [...(meleeWeapons.length ? meleeWeapons : weapons.filter((w) => w.melee))].sort((a, b) => b.bonus + avgOf(b.roll) - (a.bonus + avgOf(a.roll)))[0] ?? unarmed;

  const features: BattleFeature[] = [...data.features, ...data.speciesTraits, ...(data.backgroundFeature ? [data.backgroundFeature] : [])].map((f) => ({
    ...f,
    slot: featureSlot(f),
    parsedUsage: parseUsage(f.usage),
    regainOnShort: regainsOneOnShortRest(f.text),
    cost: (() => {
      const u = parseUsage(f.usage);
      return u?.kind === "pool" && u.cost ? u.cost : costOf(f.text);
    })(),
    dice: f.text.match(/\b(\d+d\d+)\b/)?.[1] ?? null,
  }));
  // pools other features spend from but no feature counts ("You have 4 Sorcery Points"): a resource of their own
  for (const f of [...features]) {
    const u = f.parsedUsage;
    if (u?.kind !== "pool" || findPool(features, u.pool)) continue;
    const found = poolFromText(features.map((x) => x.text), u.pool);
    if (!found) continue;
    const title = u.pool.replace(/(?<![sy])$/, "s").replace(/ Dies$/, " Dice");
    features.push({ title, text: `${found.max} ${title}, back on a ${found.recharge} rest.`, usage: `${found.max}/${found.recharge === "short" ? "Short" : "Long"} Rest`, slot: "Other", parsedUsage: { kind: "count", max: found.max, recharge: found.recharge }, regainOnShort: false, cost: 1, dice: null });
  }

  const grappleDc = 8 + str + data.proficiencyBonus;
  const athletics = data.skills.find((s) => s.name === "Athletics")?.calculatedBonus ?? str;
  const grapple =
    edition === "2024"
      ? `Unarmed Strike, in place of damage: the target (no more than one size larger) makes a Strength or Dexterity save (its choice) against DC ${grappleDc}. Grapple: it is Grappled. Shove: pushed 5 ft or knocked Prone.`
      : `Replaces one attack of the Attack action: your Athletics ${signed(athletics)} against the target's Athletics or Acrobatics. Grapple: it is Grappled. Shove: knocked Prone or pushed 5 ft.`;

  // features that add the spellcasting modifier to some spells' damage
  const agonizing = has(/^Agonizing Blast$/i);
  const potent = has(/^Potent Spellcasting$/i);
  const empowered = has(/^Empowered Evocation$/i);
  const spells: BattleSpell[] = data.cardSpells.map((s) => {
    const casting = castingFor(data, s);
    const bonus =
      (agonizing && /^Eldritch Blast$/i.test(s.name)) ||
      (potent && s.level === 0 && /cleric|druid/i.test(casting.castingName)) ||
      (empowered && /evocation/i.test(s.school) && /wizard/i.test(casting.castingName))
        ? Math.max(0, casting.modifier)
        : 0;
    const reason = bonus ? (agonizing && /^Eldritch Blast$/i.test(s.name) ? "Agonizing Blast" : potent && s.level === 0 ? "Potent Spellcasting" : "Empowered Evocation") : null;
    return { ...s, slot: castingAction(s.time) as Slot, ...casting, damageBonus: bonus, damageBonusFrom: reason };
  });
  // the spells magic items cast, unless the item's rules already gave the spell (Enspelled Armor)
  for (const item of data.items ?? []) {
    for (const ref of item.spells ?? []) {
      if (data.cardSpells.some((s) => s.name === ref.spell.name && (s.origin.includes(item.elementName) || s.origin.includes(item.name)))) continue;
      const casting = castingFor(data, ref.spell);
      spells.push({
        ...ref.spell,
        slot: ref.bonusAction ? "Bonus Action" : (castingAction(ref.spell.time) as Slot),
        attackBonus: ref.attack ?? casting.attackBonus,
        saveDc: ref.dc ?? casting.saveDc,
        modifier: casting.modifier,
        castingName: item.name,
        damageBonus: 0,
        damageBonusFrom: null,
        item: { entryId: item.entryId, name: item.name, cost: ref.cost, level: ref.level, upcast: ref.upcast, maxCost: ref.maxCost },
      });
    }
  }

  return {
    edition,
    mod,
    weapons,
    unarmed,
    offHand,
    offHandAction,
    opportunity,
    features,
    standard: standardActions(edition, data, data.speeds.walk),
    spells,
    riders: Object.fromEntries((data.items ?? []).map((i) => [i.entryId, itemRiders(i.html, i.weaponDamageType ?? "")]).filter(([, r]) => (r as ItemRider[]).length > 0)),
    grapple,
    hasWeaponMastery: has(/^Weapon Mastery$/i),
  };
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** The points a use costs, from its text: "spend 2 sorcery points", "expend 1 Focus Point" (1 when it says nothing). */
function costOf(text: string): number {
  const m = text.match(/\b(?:spend|expend)s?(?:ing)? (\d+|one|two|three|four|five|six) (?:of your )?(?:sorcery|ki|focus|psi|psionic)? ?points?\b/i);
  return m ? (NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1])) || 1 : 1;
}

function avgOf(roll: Roll): number {
  return roll.dice.reduce((s, d) => s + (d.count * (d.sides + 1)) / 2, 0) + roll.bonus;
}
