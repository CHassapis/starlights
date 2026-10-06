import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ apiClient: {} }));
import { defaultRestrictedSources, editionOf, homebrewSources, restrictedForEdition, switchEdition, type SourceBook } from "./sources";

const books: SourceBook[] = [
  { name: "Player's Handbook", group: "core", elements: 1 },
  { name: "Player's Handbook (2024)", group: "core", elements: 1 },
  { name: "Xanathar's Guide to Everything", group: "supplements", elements: 1 },
  { name: "Unearthed Arcana: Artificer", group: "unearthed-arcana", elements: 1 },
  { name: "Homebrew", group: "homebrew", elements: 1 },
  { name: "Curse of Strahd (homebrew)", group: "homebrew", elements: 1 },
];

describe("sources", () => {
  it("new characters start without playtest material or homebrew", () => {
    expect(defaultRestrictedSources(books).sort()).toEqual(["Curse of Strahd (homebrew)", "Homebrew", "Unearthed Arcana: Artificer"]);
  });

  it("every edition keeps homebrew off until it is ticked", () => {
    for (const edition of ["mixed", "2014", "2024"] as const) expect(restrictedForEdition(edition, books)).toContain("Homebrew");
    expect(editionOf(restrictedForEdition("2014", books), books)).toBe("2014");
  });

  it("ticking homebrew keeps the edition, and so do characters made before homebrew started off", () => {
    const ticked = restrictedForEdition("2024", books).filter((b) => b !== "Homebrew");
    expect(editionOf(ticked, books)).toBe("2024");
    expect(editionOf(["Unearthed Arcana: Artificer"], books)).toBe("mixed");
    expect(editionOf(["Unearthed Arcana: Artificer", "Xanathar's Guide to Everything"], books)).toBeNull();
  });

  it("picking an edition leaves the homebrew as the player ticked it", () => {
    const after = switchEdition("2014", ["Unearthed Arcana: Artificer", "Curse of Strahd (homebrew)"], books);
    expect(after.sort()).toEqual(["Curse of Strahd (homebrew)", "Player's Handbook (2024)", "Unearthed Arcana: Artificer"]);
  });

  it("lists the homebrew books a campaign hides", () => {
    expect(homebrewSources(books)).toEqual(["Homebrew", "Curse of Strahd (homebrew)"]);
  });
});
