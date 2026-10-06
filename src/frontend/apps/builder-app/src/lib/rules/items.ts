/*
 * Inventory rules: pure functions over the item catalog (GET /api/elements/items) and a character's inventory,
 * with no React or network, so they are unit tested (items.test.ts). Aurora is the reference: an item's figures
 * come from its base item when it is a magic item made from one ("Weapon, +1" on a longsword), what it adds while
 * active comes through the rules engine (the server registers active items that have rules).
 */

// ---- the catalog (as the server sends it: fields that are empty or false are left out)

export interface MagicInfo {
  rarity?: string | null;
  attunement?: boolean;
  attunementBy?: string | null;
  charges?: number | null;
  cursed?: boolean;
  enhancement?: number | null;
}

export interface WeaponInfo {
  damage: string;
  damageType?: string | null;
  versatile?: string | null;
  range?: string | null;
  properties?: string[];
  martial?: boolean;
  ranged?: boolean;
  proficiencyId?: string | null;
  ammunitionId?: string | null;
  /** the 2024 weapon mastery ("Vex"), shown with the properties as on Aurora's sheet */
  mastery?: string | null;
}

export interface ArmorInfo {
  kind: "Light" | "Medium" | "Heavy" | "Shield";
  armorClass: number;
  strengthRequirement?: number | null;
  stealthDisadvantage?: boolean;
  proficiencyId?: string | null;
}

export interface ItemInfo {
  id: string;
  name: string;
  elementType: string;
  source?: string | null;
  auroraId: string;
  categories: string[];
  magic?: MagicInfo | null;
  buildOption?: boolean;
  hidden?: boolean;
  weight?: number;
  excludeEncumbrance?: boolean;
  cost?: number | null;
  currency?: string | null;
  stackable?: boolean;
  valuable?: boolean;
  slot?: string | null;
  weapon?: WeaponInfo | null;
  armor?: ArmorInfo | null;
  base?: { kind: "Weapon" | "Armor"; rule: string; nameFormat?: string | null } | null;
  container?: { capacityLb?: number | null; weightless?: boolean; detached?: boolean } | null;
  hasRules?: boolean;
  effects?: string[];
}

// ---- a character's inventory (GET/PUT /api/characters/{id}/inventory)

export interface CustomItem {
  category?: string | null;
  weight?: number | null;
  description?: string | null;
  magic?: boolean;
  rarity?: string | null;
  attunement?: boolean;
  container?: boolean;
  capacity?: number | null;
  /** a picture of it (a campaign magic item's) */
  imageUrl?: string | null;
  /** where it comes from, for its card (the campaign that gave it) */
  source?: string | null;
}

export interface InventoryEntry {
  id: string;
  elementId?: string | null;
  baseElementId?: string | null;
  /** the player's own name for it */
  name?: string | null;
  quantity: number;
  equipped?: string | null;
  containerId?: string | null;
  stored?: boolean;
  attuned?: boolean;
  chargesUsed?: number;
  card?: boolean;
  /** its place in the sheet's attack list (Aurora's displayed attacks), or null */
  attack?: number | null;
  /** a picture of this one (the item card the DM handed over with it) */
  imageUrl?: string | null;
  notes?: string | null;
  custom?: CustomItem | null;
  /** set by the server while the item is active and has rules */
  registrationId?: string | null;
}

export const COINS = ["cp", "sp", "ep", "gp", "pp"] as const;
export type Coin = (typeof COINS)[number];
export const COIN_NAMES: Record<Coin, string> = { cp: "Copper", sp: "Silver", ep: "Electrum", gp: "Gold", pp: "Platinum" };

export interface Inventory {
  version?: number;
  /** goes up with every save; a save names the revision it started from (see useSaveInventory) */
  revision?: number;
  items: InventoryEntry[];
  coins: Partial<Record<Coin, number>>;
  treasure?: string | null;
  questItems?: string | null;
}

export type Catalog = ReadonlyMap<string, ItemInfo>;

/** An inventory entry with its catalog items worked out. */
export interface Resolved {
  entry: InventoryEntry;
  item?: ItemInfo;
  base?: ItemInfo;
  name: string;
  /** weight of one, in pounds */
  weight: number;
  categories: string[];
  magic: boolean;
  requiresAttunement: boolean;
  weapon?: WeaponInfo | null;
  armor?: ArmorInfo | null;
  container: { capacity: number | null; weightless: boolean; detached: boolean } | null;
}

export function resolve(entry: InventoryEntry, catalog: Catalog): Resolved {
  const item = entry.elementId ? catalog.get(entry.elementId) : undefined;
  const base = entry.baseElementId ? catalog.get(entry.baseElementId) : undefined;
  const custom = entry.custom ?? undefined;
  const weight = custom?.weight ?? (base ? (base.weight ?? 0) + (item?.weight ?? 0) : (item?.weight ?? 0));
  const container = item?.container
    ? { capacity: item.container.capacityLb ?? null, weightless: !!item.container.weightless, detached: !!item.container.detached }
    : custom?.container
      ? { capacity: custom.capacity ?? null, weightless: false, detached: false }
      : null;
  return {
    entry,
    item,
    base,
    name: displayName(entry, item, base),
    weight,
    categories: item ? [...new Set([...item.categories, ...(base?.categories ?? [])])] : custom?.category ? [custom.category] : ["Adventuring Gear"],
    magic: !!item?.magic || !!custom?.magic,
    requiresAttunement: !!item?.magic?.attunement || !!custom?.attunement,
    // a magic weapon with dice of its own (a homebrew "Dagger of the Unbodied" doing 1d6) keeps its base's other figures
    weapon: base?.weapon && item?.weapon ? { ...base.weapon, damage: item.weapon.damage, damageType: item.weapon.damageType ?? base.weapon.damageType } : (base?.weapon ?? item?.weapon),
    armor: base?.armor ?? item?.armor,
    container,
  };
}

/** An entry's name as lists show it (the player's own, else the generated one). */
export const generatedNameOf = (r: Resolved) => displayName({ ...r.entry, name: null }, r.item, r.base);

/** The player's name, else Aurora's name-format with the base item ("Flame Tongue Longsword", "Longsword +1"). */
export function displayName(entry: InventoryEntry, item?: ItemInfo, base?: ItemInfo): string {
  if (entry.name?.trim()) return entry.name.trim();
  if (!item) return "Unnamed item";
  if (base && item.base?.nameFormat) {
    return item.base.nameFormat
      .replace("{{parent}}", base.name)
      .replace("{{enhancement}}", String(item.magic?.enhancement ?? ""))
      .replace(/\s+/g, " ")
      .trim();
  }
  if (base) return `${item.name} (${base.name})`;
  return item.name;
}

// ---- where things are, and what they weigh

/** Whether the entry is with the character: not stored, and not inside a stored or detached (mount) container. */
export function isCarried(entry: InventoryEntry, entries: ReadonlyMap<string, Resolved>): boolean {
  const seen = new Set<string>();
  for (let at: InventoryEntry | undefined = entry; at; at = at.containerId ? entries.get(at.containerId)?.entry : undefined) {
    if (seen.has(at.id)) return false;
    seen.add(at.id);
    if (at.stored) return false;
    if (at !== entry && entries.get(at.id)?.container?.detached) return false;
  }
  return true;
}

/** Whether the entry's weight counts toward what the character carries. */
export function countsTowardWeight(entry: InventoryEntry, entries: ReadonlyMap<string, Resolved>): boolean {
  if (!isCarried(entry, entries)) return false;
  const self = entries.get(entry.id);
  if (self?.item?.excludeEncumbrance) return false;
  // inside a weightless container (Bag of Holding) at any depth: only the bag weighs
  for (let at = entry.containerId ? entries.get(entry.containerId) : undefined; at; at = at.entry.containerId ? entries.get(at.entry.containerId) : undefined) {
    if (at.container?.weightless) return false;
  }
  return true;
}

export interface WeightSummary {
  carried: number;
  coins: number;
  capacity: number;
  pushDragLift: number;
  encumbered: boolean;
  /** container entry id → pounds inside (for capacity warnings) */
  contents: Map<string, number>;
  /** containers holding more than they can */
  overfull: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Carried weight (items that count, plus coins at 50 to the pound) against a carrying capacity of STR × 15. */
export function weight(inventory: Inventory, catalog: Catalog, strength: number, sizeMultiplier = 1): WeightSummary {
  const entries = new Map(inventory.items.map((e) => [e.id, resolve(e, catalog)]));
  let carried = 0;
  const contents = new Map<string, number>();
  for (const r of entries.values()) {
    const total = r.weight * r.entry.quantity;
    if (countsTowardWeight(r.entry, entries)) carried += total;
    if (r.entry.containerId) contents.set(r.entry.containerId, (contents.get(r.entry.containerId) ?? 0) + total);
  }
  const coins = COINS.reduce((n, k) => n + (inventory.coins[k] ?? 0), 0) / 50;
  const capacity = strength * 15 * sizeMultiplier;
  const overfull = [...contents.entries()]
    .filter(([id, lb]) => {
      const capacity = entries.get(id)?.container?.capacity;
      return capacity !== null && capacity !== undefined && lb > capacity;
    })
    .map(([id]) => id);
  return {
    carried: round(carried + coins),
    coins: round(coins),
    capacity,
    pushDragLift: capacity * 2,
    encumbered: carried + coins > capacity,
    contents,
    overfull,
  };
}

// ---- equipping and attunement

/** Where an item can be equipped, from Aurora's slot and what it is. */
export function equipSlots(r: Resolved): string[] {
  if (r.armor?.kind === "Shield") return ["Off Hand"];
  if (r.armor) return ["Armor"];
  if (r.weapon) {
    const properties = r.weapon.properties ?? [];
    if (properties.includes("Two-Handed")) return ["Two-Handed"];
    return properties.includes("Versatile") ? ["Main Hand", "Off Hand", "Two-Handed"] : ["Main Hand", "Off Hand"];
  }
  const slot = r.base?.slot ?? r.item?.slot;
  if (slot === "onehand" || slot === "onehand,secondary") return ["Main Hand", "Off Hand"];
  if (slot === "twohand") return ["Two-Handed"];
  if (r.magic || (slot && slot !== "misc" && slot !== "companion")) return ["Worn"];
  return [];
}

/**
 * Whether an item is active: equipped, and attuned when it needs attunement (Aurora applies an item's rules only
 * then). Items that need attunement but have no place to be worn are active when attuned.
 */
export function isActive(r: Resolved): boolean {
  if (r.requiresAttunement) return !!r.entry.attuned;
  return !!r.entry.equipped;
}

export interface EquipProblems {
  hands: number;
  armor: number;
  shields: number;
  attuned: number;
  attunementMax: number;
  messages: string[];
}

/** What does not add up: more than two hands, two suits of armor, too many attuned items. */
export function equipProblems(inventory: Inventory, catalog: Catalog, attunementMax = 3): EquipProblems {
  const resolved = inventory.items.map((e) => resolve(e, catalog));
  const equipped = resolved.filter((r) => r.entry.equipped);
  const hands = equipped.reduce((n, r) => n + (r.entry.equipped === "Two-Handed" ? 2 : r.entry.equipped === "Main Hand" || r.entry.equipped === "Off Hand" ? 1 : 0), 0);
  const armor = equipped.filter((r) => r.entry.equipped === "Armor").length;
  const shields = equipped.filter((r) => r.armor?.kind === "Shield").length;
  const attuned = resolved.filter((r) => r.entry.attuned).length;
  const messages: string[] = [];
  if (hands > 2) messages.push(`Holding items in ${hands} hands; you have two.`);
  if (armor > 1) messages.push("Wearing more than one suit of armor.");
  if (shields > 1) messages.push("Carrying more than one shield.");
  if (attuned > attunementMax) messages.push(`Attuned to ${attuned} items; the limit is ${attunementMax}.`);
  return { hands, armor, shields, attuned, attunementMax, messages };
}

// ---- armor class and attacks

type Ability = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";

/** What the rules need from the character. */
export interface CharacterFacts {
  mod: (ability: Ability) => number;
  proficiencyBonus: number;
  /** a statistic's total (the server's statistics, names like "ac:misc") */
  stat: (name: string) => number | undefined;
  statNames: string[];
  /** Aurora ids of every element the character has (weapon proficiencies) */
  has: ReadonlySet<string>;
}

export interface ArmorClass {
  total: number;
  /** without armor: the statistic of the feature whose calculation wins ("ac:draconic-resilience"), if any */
  calculation?: string;
  /** how it adds up, for the info card */
  parts: { label: string; value: number }[];
  armor?: Resolved;
  shield?: Resolved;
  stealthDisadvantage: boolean;
}

// statistics that are not an unarmored calculation of their own
const NOT_A_CALCULATION = /^ac:(misc|shield|calculation|armored)(:|$)/;

/**
 * Armor class, like Aurora: worn armor (DEX capped by its kind: light none, medium 2 or ac:armored:dexterity:cap,
 * heavy none) or the best unarmored calculation (10 + DEX, or a feature's own, such as ac:draconic-resilience;
 * monk-style ones need no shield either), plus the shield, plus magic from active items through the statistics
 * (ac:armored:enhancement for magic armor, ac:shield for a magic shield, ac:misc for a Cloak of Protection).
 */
export function armorClass(inventory: Inventory, catalog: Catalog, c: CharacterFacts): ArmorClass {
  const resolved = inventory.items.map((e) => resolve(e, catalog));
  const armor = resolved.find((r) => r.entry.equipped === "Armor" && r.armor && r.armor.kind !== "Shield");
  const shield = resolved.find((r) => r.entry.equipped && r.armor?.kind === "Shield");
  const dex = c.mod("DEX");
  const parts: { label: string; value: number }[] = [];
  let calculation: string | undefined;

  if (armor?.armor) {
    parts.push({ label: armor.name, value: armor.armor.armorClass });
    const cap = armor.armor.kind === "Heavy" ? 0 : armor.armor.kind === "Medium" ? (c.stat("ac:armored:dexterity:cap") ?? 2) : Infinity;
    const fromDex = Math.min(dex, cap);
    if (armor.armor.kind !== "Heavy") parts.push({ label: cap === Infinity ? "Dexterity" : `Dexterity (max ${cap})`, value: fromDex });
    const enhancement = c.stat("ac:armored:enhancement") ?? 0;
    if (enhancement) parts.push({ label: "Magic armor", value: enhancement });
  } else {
    const options = c.statNames
      .filter((n) => n.startsWith("ac:") && !NOT_A_CALCULATION.test(n))
      .filter((n) => !shield || !/monk|dazzling/.test(n))
      .map((n) => ({ label: n.slice(3).replace(/-/g, " ").replace(/^\w/, (x) => x.toUpperCase()), value: c.stat(n) ?? 0, statistic: n as string | undefined }));
    const best = options.reduce((a, b) => (b.value > a.value ? b : a), { label: "Unarmored (10 + Dexterity)", value: 10 + dex, statistic: undefined as string | undefined });
    parts.push({ label: best.label, value: best.value });
    calculation = best.statistic;
  }
  if (shield?.armor) {
    parts.push({ label: shield.name, value: shield.armor.armorClass });
    // a whole magic shield's own rule puts its +2 in ac:shield too, so only what is above it is magic; a magic
    // shield made from a base shield ("Shield, +1") registers only its magic (+1), the base's +2 coming from here
    const total = c.stat("ac:shield");
    const magic = total === undefined ? 0 : shield.base ? total : total - shield.armor.armorClass;
    if (magic > 0) parts.push({ label: "Magic shield", value: magic });
  }
  const misc = c.stat("ac:misc") ?? 0;
  if (misc) parts.push({ label: "Other bonuses", value: misc });

  return {
    total: parts.reduce((n, p) => n + p.value, 0),
    parts,
    armor,
    shield,
    stealthDisadvantage: !!armor?.armor?.stealthDisadvantage,
    calculation,
  };
}

export interface Attack {
  entryId: string;
  name: string;
  range: string;
  toHit: number;
  attack: string;
  damage: string;
  properties: string[];
  proficient: boolean;
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Fighting styles that change an attack by how the weapon is held (Aurora gives these no numbers to add). */
const STYLES = {
  // 2014 Dueling has a rule (melee:damage +2 while one weapon is held), which the server applies to the grip in use
  dueling2014: ["ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_DUELING"],
  dueling: ["ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_DUELING", "ID_WOTC_PHB24_FEAT_DUELING"],
  greatWeapon2014: ["ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_GREAT_WEAPON_FIGHTING"],
  greatWeapon2024: ["ID_WOTC_PHB24_FEAT_GREAT_WEAPON_FIGHTING"],
  thrown: ["ID_WOTC_TCOE_CLASS_FEATURE_FIGHTING_STYLE_THROWN_WEAPON_FIGHTING", "ID_WOTC_PHB24_FEAT_THROWN_WEAPON_FIGHTING"],
  twoWeapon: ["ID_WOTC_PHB_CLASS_FEATURE_FIGHTINGSTYLE_TWOWEAPON_FIGHTING", "ID_WOTC_PHB24_FEAT_TWOWEAPON_FIGHTING"],
};
const hasAny = (c: CharacterFacts, ids: string[]) => ids.some((id) => c.has.has(id));

/**
 * Whether the character has picked a weapon's mastery (2024 Weapon Mastery: one element per weapon and property,
 * "…_MASTERY_PROPERTY_DAGGER_NICK", "…_CROSSBOW_HAND_VEX").
 */
export function knowsMastery(c: CharacterFacts, weaponName: string, mastery: string | null | undefined): boolean {
  if (!mastery) return false;
  const words = weaponName.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const end = `_${mastery.toUpperCase().replace(/[^A-Z]+/g, "_")}`;
  for (const id of c.has) if (id.includes("_MASTERY_PROPERTY_") && id.endsWith(end) && words.every((w) => id.includes(`_${w}`))) return true;
  return false;
}

interface WeaponLineOptions {
  /** damage dice: the weapon's, or its versatile dice in two hands */
  dice: string;
  /** a ranged attack (a ranged weapon, or a melee weapon thrown) */
  ranged: boolean;
  /** the range or reach to show */
  range: string;
  /** extra damage (a fighting style) */
  extraDamage?: number;
  /** leave a positive ability modifier off the damage (the Light property's extra attack) */
  noAbilityDamage?: boolean;
}

/**
 * One way of attacking with a weapon: STR for melee, DEX for ranged weapons, the better of the two for finesse
 * (thrown weapons keep their melee ability); proficiency from the weapon's own proficiency or its simple/martial
 * group; a magic weapon's +N on both; and the bonuses the character's elements give, as Aurora names them:
 * "ranged:attack" (Archery), "melee:damage", and per weapon "longsword:attack", "longbow:damage".
 */
function weaponLine(r: Resolved, c: CharacterFacts, o: WeaponLineOptions) {
  const w = r.weapon!;
  const properties = w.properties ?? [];
  const finesse = properties.includes("Finesse");
  const ability = w.ranged ? c.mod("DEX") : finesse ? Math.max(c.mod("STR"), c.mod("DEX")) : c.mod("STR");
  const group = w.martial ? "MARTIAL" : "SIMPLE";
  const proficient =
    (!!w.proficiencyId && c.has.has(w.proficiencyId)) ||
    c.has.has(`ID_PROFICIENCY_WEAPON_PROFICIENCY_${group}_WEAPONS`) ||
    c.has.has(`ID_PROFICIENCY_WEAPON_PROFICIENCY_${group}_${w.ranged ? "RANGED" : "MELEE"}_WEAPONS`);
  const enhancement = r.base ? (r.item?.magic?.enhancement ?? 0) : 0;
  const kind = o.ranged ? "ranged" : "melee";
  const weaponName = (r.base?.name ?? r.item?.name ?? "").toLowerCase().trim().replace(/ /g, "-");
  const statBonus = (what: "attack" | "damage") => (c.stat(`${kind}:${what}`) ?? 0) + (weaponName ? (c.stat(`${weaponName}:${what}`) ?? 0) : 0);
  const toHit = ability + (proficient ? c.proficiencyBonus : 0) + enhancement + statBonus("attack");
  const damageBonus = (o.noAbilityDamage && ability > 0 ? 0 : ability) + enhancement + statBonus("damage") + (o.extraDamage ?? 0);
  return {
    entryId: r.entry.id,
    name: r.name,
    range: o.range,
    toHit,
    attack: `${sign(toHit)} vs AC`,
    damage: `${o.dice}${sign(damageBonus)}${w.damageType ? ` ${w.damageType}` : ""}`,
    // the properties and the mastery, in Aurora's order ("Finesse, Vex")
    properties: [...properties, ...(w.mastery ? [w.mastery] : [])].sort((a, b) => a.localeCompare(b)),
    proficient,
  };
}

const reachOf = (r: Resolved) => ((r.weapon?.properties ?? []).includes("Reach") ? "10 ft" : "5 ft");

/**
 * Attack lines for the weapons as they are held now, equipped ones first (Aurora's sheet: versatile dice when
 * wielded two-handed; the damage always shows its modifier, "1d8+0"; an off-hand weapon its full one).
 */
export function attacks(inventory: Inventory, catalog: Catalog, c: CharacterFacts): Attack[] {
  const entries = new Map(inventory.items.map((e) => [e.id, resolve(e, catalog)]));
  const resolved = [...entries.values()].filter((r) => r.weapon && isCarried(r.entry, entries));
  resolved.sort((a, b) => Number(!!b.entry.equipped) - Number(!!a.entry.equipped));
  return resolved.map((r) => {
    const w = r.weapon!;
    const properties = w.properties ?? [];
    return weaponLine(r, c, {
      dice: r.entry.equipped === "Two-Handed" && w.versatile ? w.versatile : w.damage,
      ranged: !!w.ranged,
      range: w.ranged || properties.includes("Thrown") ? (w.range ?? reachOf(r)) : reachOf(r),
    });
  });
}

export type AttackModeName = "One hand" | "Two hands" | "Thrown" | "Ranged" | "Off hand";

export interface AttackMode extends Attack {
  mode: AttackModeName;
  /** an off-hand attack takes a bonus action (2014, and 2024 without the Nick mastery) */
  action: "Attack" | "Bonus Action";
  /** the way the weapon is held now */
  current: boolean;
  equipped: boolean;
  /** what changes the numbers here ("Dueling +2 damage") or what to know ("Great Weapon Fighting: …") */
  notes: string[];
  /** Great Weapon Fighting on this attack's damage dice: 2014 rerolls 1s and 2s once, 2024 counts them as 3 */
  greatWeapon?: "2014" | "2024";
  /** the character has picked this weapon's mastery (2024), so it applies */
  masteryKnown: boolean;
}

/**
 * Every way each carried weapon can attack: one-handed, two-handed (versatile or two-handed weapons), thrown,
 * ranged, and the off-hand attack of a light weapon, with the fighting styles that depend on the grip:
 * Dueling (+2 damage, one hand, no other weapon held), Great Weapon Fighting (two hands), Thrown Weapon Fighting
 * (+2 damage thrown), Two-Weapon Fighting (the off-hand attack keeps the ability modifier). Equipped weapons first.
 */
export function attackModes(inventory: Inventory, catalog: Catalog, c: CharacterFacts, { onePerName = true } = {}): AttackMode[] {
  const entries = new Map(inventory.items.map((e) => [e.id, resolve(e, catalog)]));
  const resolved = [...entries.values()].filter((r) => r.weapon && isCarried(r.entry, entries));
  resolved.sort((a, b) => Number(!!b.entry.equipped) - Number(!!a.entry.equipped));
  const dueling = hasAny(c, STYLES.dueling);
  const greatWeapon = hasAny(c, STYLES.greatWeapon2024) ? "2024" : hasAny(c, STYLES.greatWeapon2014) ? "2014" : undefined;
  const thrownStyle = hasAny(c, STYLES.thrown);
  const twoWeapon = hasAny(c, STYLES.twoWeapon);
  const heldWeapons = (except: Resolved) => resolved.filter((x) => x !== except && x.entry.equipped && x.entry.equipped !== "Armor" && x.weapon).length;
  // 2014 Dueling's +2 is already in melee:damage while its condition holds now (a weapon in the main hand, nothing
  // but a shield in the other): take it out, so each way of holding gets it only when that way qualifies
  const held = [...entries.values()].filter((x) => x.entry.equipped && !x.entry.stored);
  const mainHand = held.find((x) => x.weapon && (x.entry.equipped === "Main Hand" || x.entry.equipped === "Two-Handed"));
  const offHand = held.find((x) => x.entry.equipped === "Off Hand" && x.armor?.kind !== "Shield") ?? held.find((x) => x.entry.equipped === "Two-Handed");
  const dueling2014Counted = hasAny(c, STYLES.dueling2014) && !!mainHand && !offHand ? 2 : 0;

  const seen = new Set<string>();
  const out: AttackMode[] = [];
  for (const r of resolved) {
    // one set of lines per kind of weapon (six daggers are one dagger), the equipped one first
    if (onePerName && seen.has(r.name)) continue;
    seen.add(r.name);
    const w = r.weapon!;
    const p = w.properties ?? [];
    const equipped = !!r.entry.equipped;
    const heldAs = r.entry.equipped;
    const masteryKnown = knowsMastery(c, r.base?.name ?? r.item?.name ?? r.name, w.mastery);
    const push = (mode: AttackModeName, current: boolean, o: WeaponLineOptions, notes: string[] = [], extra: Partial<AttackMode> = {}) =>
      out.push({ ...weaponLine(r, c, o), mode, action: "Attack", current, equipped, notes, masteryKnown, ...extra });

    if (w.ranged) {
      push("Ranged", equipped, { dice: w.damage, ranged: true, range: w.range ?? "" });
      continue;
    }
    if (!p.includes("Two-Handed")) {
      const alone = heldWeapons(r) === 0;
      const duel = dueling && alone;
      push(
        "One hand",
        heldAs === "Main Hand" || heldAs === "Off Hand",
        { dice: w.damage, ranged: false, range: reachOf(r), extraDamage: (duel ? 2 : 0) - dueling2014Counted },
        dueling ? [alone ? "Dueling +2 damage (no other weapon held)" : "Dueling: +2 damage when it is the only weapon you hold"] : [],
      );
    }
    if (p.includes("Versatile") || p.includes("Two-Handed")) {
      push(
        "Two hands",
        heldAs === "Two-Handed",
        { dice: p.includes("Versatile") && w.versatile ? w.versatile : w.damage, ranged: false, range: reachOf(r), extraDamage: -dueling2014Counted },
        greatWeapon ? [greatWeapon === "2024" ? "Great Weapon Fighting: damage dice of 1 or 2 count as 3" : "Great Weapon Fighting: reroll damage dice of 1 or 2 once"] : [],
        greatWeapon ? { greatWeapon } : {},
      );
    }
    if (p.includes("Thrown")) {
      push("Thrown", false, { dice: w.damage, ranged: true, range: w.range ?? "20/60", extraDamage: thrownStyle ? 2 : 0 }, thrownStyle ? ["Thrown Weapon Fighting +2 damage"] : []);
    }
    if (p.includes("Light")) {
      const nick = w.mastery === "Nick" && masteryKnown;
      push(
        "Off hand",
        false,
        { dice: w.damage, ranged: false, range: reachOf(r), noAbilityDamage: !twoWeapon, extraDamage: -dueling2014Counted },
        [
          "After attacking with a different Light weapon",
          twoWeapon ? "Two-Weapon Fighting: keeps the ability modifier" : "No ability modifier to its damage unless it is negative",
          ...(nick ? ["Nick: part of the Attack action, not a bonus action (once per turn)"] : []),
        ],
        { action: nick ? "Attack" : "Bonus Action" },
      );
    }
  }
  return out;
}

/**
 * The sheet's attack rows: the weapons the player put on the attack list (Aurora's displayed attacks), in that
 * order; when none are listed, the equipped weapons, each name once.
 */
export function sheetAttacks(inventory: Inventory, catalog: Catalog, c: CharacterFacts): Attack[] {
  const all = new Map(attacks(inventory, catalog, c).map((a) => [a.entryId, a]));
  const listed = inventory.items.filter((e) => e.attack).sort((a, b) => a.attack! - b.attack!);
  if (listed.length > 0) return listed.map((e) => all.get(e.id)).filter((a): a is Attack => !!a);
  const seen = new Set<string>();
  return inventory.items
    .filter((e) => e.equipped)
    .map((e) => all.get(e.id))
    .filter((a): a is Attack => !!a && !seen.has(a.name) && !!seen.add(a.name));
}

/** The attunement limit: Aurora's attunement:max statistic (artificers raise it), otherwise 3. */
export function attunementMax(c: Pick<CharacterFacts, "stat">): number {
  const max = c.stat("attunement:max");
  return max && max > 0 ? max : 3;
}

// ---- how the inventory is shown

export interface ContainerGroup {
  container: Resolved;
  items: Resolved[];
  /** pounds inside (weightless containers still show what they hold) */
  contents: number;
  capacity: number | null;
  /** its contents are not on the character: a mount, a vehicle, or a stored container */
  away: boolean;
}

export interface InventoryGroups {
  equipped: Resolved[];
  carried: Resolved[];
  containers: ContainerGroup[];
  stored: Resolved[];
}

/**
 * The inventory as the Equipment tab shows it: equipped items, what is carried loose, one group per container
 * (with what it holds and whether that is on the character at all), and what is stored elsewhere.
 */
export function groupInventory(inventory: Inventory, catalog: Catalog): InventoryGroups {
  const entries = new Map(inventory.items.map((e) => [e.id, resolve(e, catalog)]));
  const groups: InventoryGroups = { equipped: [], carried: [], containers: [], stored: [] };
  const byContainer = new Map<string, Resolved[]>();
  for (const r of entries.values()) {
    const container = r.entry.containerId ? entries.get(r.entry.containerId) : undefined;
    if (container) byContainer.set(container.entry.id, [...(byContainer.get(container.entry.id) ?? []), r]);
    else if (r.entry.stored) groups.stored.push(r);
    else if (r.entry.equipped) groups.equipped.push(r);
    else groups.carried.push(r);
  }
  for (const r of entries.values()) {
    if (!r.container && !byContainer.has(r.entry.id)) continue;
    const items = byContainer.get(r.entry.id) ?? [];
    groups.containers.push({
      container: r,
      items,
      contents: round(items.reduce((n, i) => n + i.weight * i.entry.quantity, 0)),
      capacity: r.container?.capacity ?? null,
      away: !isCarried(r.entry, entries) || !!r.container?.detached,
    });
  }
  return groups;
}
