import { describe, expect, it } from "vitest";
import { EMPTY_MONSTER, saveBonuses, signedMod } from "./homebrew";

describe("homebrew monsters", () => {
  it("takes listed saves and the ability modifier for the rest", () => {
    const m = { ...EMPTY_MONSTER, abilities: { str: 18, dex: 14, con: 16, int: 8, wis: 10, cha: 12 }, saves: "Dex +5, Wisdom +3" };
    expect(saveBonuses(m)).toEqual({ str: 4, dex: 5, con: 3, int: -1, wis: 3, cha: 1 });
    expect(signedMod(8)).toBe("-1");
  });
});
