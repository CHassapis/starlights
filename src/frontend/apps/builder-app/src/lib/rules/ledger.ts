/**
 * The campaign ledger's arithmetic: coins are whole numbers per kind (never converted on their own), positive
 * coming in and negative going out; the party fund's running balance is kept per kind, with its worth in gold
 * beside it; sharing out splits each kind evenly in whole coins and leaves the rest in the fund.
 */

export const COIN_KINDS = ["pp", "gp", "ep", "sp", "cp"] as const;
export type CoinKind = (typeof COIN_KINDS)[number];
export type Coins = Partial<Record<CoinKind, number>>;

/** What a coin is worth in gold pieces. */
export const GP_VALUE: Record<CoinKind, number> = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** Who a ledger line is for: the party fund, a character (its id), or someone else (a merchant, a temple). */
export type Recipient = "party" | "other" | string;

export interface LedgerLine {
  id: string;
  title: string;
  occurredOn?: string | null;
  number?: number | null;
  sort?: number;
  coins: Coins;
  to: Recipient;
  items: string[];
}

export interface LedgerRow {
  line: LedgerLine;
  /** the party fund after this line (unchanged by lines for others) */
  balance: Coins;
  balanceGp: number;
}

const clean = (c: Coins): Coins => Object.fromEntries(COIN_KINDS.filter((k) => (c[k] ?? 0) !== 0).map((k) => [k, c[k]!])) as Coins;

export function addCoins(a: Coins, b: Coins, sign = 1): Coins {
  return clean(Object.fromEntries(COIN_KINDS.map((k) => [k, (a[k] ?? 0) + sign * (b[k] ?? 0)])) as Coins);
}

/** Worth in gold, to the copper (2 decimals). */
export function gpValue(c: Coins): number {
  return Math.round(COIN_KINDS.reduce((sum, k) => sum + (c[k] ?? 0) * GP_VALUE[k] * 100, 0)) / 100;
}

export const isEmpty = (c: Coins) => COIN_KINDS.every((k) => !c[k]);

/** "12 gp 5 sp", "+30 gp", "−4 sp"; "—" for nothing. */
export function formatCoins(c: Coins, signed = false): string {
  const parts = COIN_KINDS.filter((k) => c[k]).map((k) => {
    const n = c[k]!;
    const sign = n < 0 ? "−" : signed ? "+" : "";
    return `${sign}${Math.abs(n).toLocaleString("en")} ${k}`;
  });
  return parts.length ? parts.join(" ") : "—";
}

/** The lines in ledger order: by date as written, then the DM's order, then as entered. */
export function orderLines(lines: LedgerLine[]): LedgerLine[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => (a.line.occurredOn ?? "").localeCompare(b.line.occurredOn ?? "") || (a.line.sort ?? 0) - (b.line.sort ?? 0) || a.index - b.index)
    .map((x) => x.line);
}

/** Every line with the party fund's running balance after it. */
export function ledgerRows(lines: LedgerLine[]): LedgerRow[] {
  let balance: Coins = {};
  return orderLines(lines).map((line) => {
    if (line.to === "party") balance = addCoins(balance, line.coins);
    return { line, balance, balanceGp: gpValue(balance) };
  });
}

export function partyFund(lines: LedgerLine[]): Coins {
  return lines.filter((l) => l.to === "party").reduce((sum, l) => addCoins(sum, l.coins), {} as Coins);
}

/** What each recipient has had from the ledger, coins and items. */
export function totalsByRecipient(lines: LedgerLine[]): Map<Recipient, { coins: Coins; items: string[] }> {
  const totals = new Map<Recipient, { coins: Coins; items: string[] }>();
  for (const line of orderLines(lines)) {
    const t = totals.get(line.to) ?? { coins: {}, items: [] };
    totals.set(line.to, { coins: addCoins(t.coins, line.coins), items: [...t.items, ...line.items] });
  }
  return totals;
}

/**
 * Shares coins out among n people: each gets the same whole coins of each kind, and what does not divide stays
 * behind (in the fund), as a table would do it.
 */
export function shareOut(coins: Coins, n: number): { each: Coins; remainder: Coins } {
  if (n <= 0) return { each: {}, remainder: clean(coins) };
  const each: Coins = {};
  const remainder: Coins = {};
  for (const k of COIN_KINDS) {
    const total = coins[k] ?? 0;
    if (total <= 0) continue;
    each[k] = Math.floor(total / n);
    remainder[k] = total - each[k]! * n;
  }
  return { each: clean(each), remainder: clean(remainder) };
}
