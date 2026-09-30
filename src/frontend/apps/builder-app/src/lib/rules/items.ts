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
    weapon: base?.weapon ?? item?.weapon,
    armor: base?.armor ?? item?.armor,
    container,
  };
}

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
      .map((n) => ({ label: n.slice(3).replace(/-/g, " ").replace(/^\w/, (x) => x.toUpperCase()), value: c.stat(n) ?? 0 }));
    const best = options.reduce((a, b) => (b.value > a.value ? b : a), { label: "Unarmored (10 + Dexterity)", value: 10 + dex });
    parts.push(best);
  }
  if (shield?.armor) {
    parts.push({ label: shield.name, value: shield.armor.armorClass });
    const magic = c.stat("ac:shield") ?? 0;
    if (magic) parts.push({ label: "Magic shield", value: magic });
  }
  const misc = c.stat("ac:misc") ?? 0;
  if (misc) parts.push({ label: "Other bonuses", value: misc });

  return {
    total: parts.reduce((n, p) => n + p.value, 0),
    parts,
    armor,
    shield,
    stealthDisadvantage: !!armor?.armor?.stealthDisadvantage,
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

/**
 * Attack lines for the weapons, equipped ones first: STR for melee, DEX for ranged, the better of the two for
 * finesse; proficiency from the weapon's own proficiency or its simple/martial group; a magic weapon's +N on
 * both; versatile dice when wielded two-handed; no positive ability modifier on off-hand damage.
 */
export function attacks(inventory: Inventory, catalog: Catalog, c: CharacterFacts): Attack[] {
  const entries = new Map(inventory.items.map((e) => [e.id, resolve(e, catalog)]));
  const resolved = [...entries.values()].filter((r) => r.weapon && isCarried(r.entry, entries));
  resolved.sort((a, b) => Number(!!b.entry.equipped) - Number(!!a.entry.equipped));
  return resolved.map((r) => {
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
    const toHit = ability + (proficient ? c.proficiencyBonus : 0) + enhancement;
    const dice = r.entry.equipped === "Two-Handed" && w.versatile ? w.versatile : w.damage;
    const damageBonus = (r.entry.equipped === "Off Hand" && ability > 0 ? 0 : ability) + enhancement;
    const reach = properties.includes("Reach") ? "10 ft" : "5 ft";
    return {
      entryId: r.entry.id,
      name: r.name,
      range: w.ranged || properties.includes("Thrown") ? (w.range ?? reach) : reach,
      toHit,
      attack: `${sign(toHit)} vs AC`,
      damage: `${dice}${damageBonus ? sign(damageBonus) : ""}${w.damageType ? ` ${w.damageType}` : ""}`,
      properties,
      proficient,
    };
  });
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
