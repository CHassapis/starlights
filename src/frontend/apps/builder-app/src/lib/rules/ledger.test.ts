import { describe, expect, it } from "vitest";
import { addCoins, formatCoins, gpValue, ledgerRows, partyFund, shareOut, totalsByRecipient, type LedgerLine } from "./ledger";

const line = (id: string, coins: LedgerLine["coins"], to = "party", occurredOn?: string, items: string[] = []): LedgerLine => ({ id, title: id, coins, to, items, occurredOn });

describe("the campaign ledger", () => {
  it("keeps coins whole per kind and adds them up in gold", () => {
    expect(addCoins({ gp: 10, sp: 5 }, { gp: -3, cp: 20 })).toEqual({ gp: 7, sp: 5, cp: 20 });
    expect(addCoins({ gp: 10 }, { gp: 10 }, -1)).toEqual({});
    expect(gpValue({ pp: 1, gp: 2, ep: 1, sp: 3, cp: 7 })).toBe(12.87);
    expect(formatCoins({ gp: 1200, sp: 5 })).toBe("1,200 gp 5 sp");
    expect(formatCoins({ gp: 30, sp: -4 }, true)).toBe("+30 gp −4 sp");
    expect(formatCoins({})).toBe("—");
  });

  it("runs the party fund's balance in date order, untouched by lines for others", () => {
    const rows = ledgerRows([
      line("rooms", { gp: -2 }, "party", "2026-09-28"),
      line("wolf pelts", { gp: 12, sp: 6 }, "party", "2026-09-21"),
      line("Mira's share", { gp: 5 }, "mira", "2026-09-29"),
      line("tithe to the church", { sp: -6 }, "party", "2026-09-29"),
    ]);
    expect(rows.map((r) => [r.line.id, r.balance])).toEqual([
      ["wolf pelts", { gp: 12, sp: 6 }],
      ["rooms", { gp: 10, sp: 6 }],
      ["Mira's share", { gp: 10, sp: 6 }],
      ["tithe to the church", { gp: 10 }],
    ]);
    expect(rows[1].balanceGp).toBe(10.6);
  });

  it("totals what each recipient got, coins and items", () => {
    const lines = [line("a", { gp: 50 }), line("b", { gp: 20 }, "mira", "", ["Sunsword"]), line("c", { gp: -20 }), line("d", { gp: 5 }, "mira")];
    expect(partyFund(lines)).toEqual({ gp: 30 });
    expect(totalsByRecipient(lines).get("mira")).toEqual({ coins: { gp: 25 }, items: ["Sunsword"] });
  });

  it("shares out evenly in whole coins and leaves the rest in the fund", () => {
    expect(shareOut({ gp: 125, sp: 7, cp: 3 }, 4)).toEqual({ each: { gp: 31, sp: 1 }, remainder: { gp: 1, sp: 3, cp: 3 } });
    expect(shareOut({ gp: 10 }, 0)).toEqual({ each: {}, remainder: { gp: 10 } });
  });
});
