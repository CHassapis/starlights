/** An item's type line and price as words. */
import type { LoreEntry } from "./types.ts";

/** A price in copper pieces as coins: 1500 → "15 gp". */
export function valueText(cp: unknown): string {
  const n = Number(cp);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % 100 === 0) return `${(n / 100).toLocaleString("en-US")} gp`;
  if (n % 10 === 0) return `${(n / 10).toLocaleString("en-US")} sp`;
  return `${n.toLocaleString("en-US")} cp`;
}

export function itemSubtitle(e: LoreEntry): string {
  const type = String(e._type ?? "");
  const weapon = e.weaponCategory ? `${String(e.weaponCategory)} ` : "";
  const rarity = typeof e.rarity === "string" && e.rarity !== "none" ? e.rarity : "";
  const attune = e.reqAttune ? ` (requires attunement${typeof e.reqAttune === "string" ? ` ${e.reqAttune}` : ""})` : "";
  return [`${weapon}${type}`.trim(), rarity].filter(Boolean).join(", ") + attune;
}

