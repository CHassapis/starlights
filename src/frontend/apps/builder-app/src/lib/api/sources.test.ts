import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ apiClient: {} }));
import { defaultRestrictedSources, editionOf, homebrewSources, restrictedForEdition, type SourceBook } from "./sources";

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

  it("a character with homebrew ticked is no longer a plain edition", () => {
    const ticked = restrictedForEdition("mixed", books).filter((b) => b !== "Homebrew");
    expect(editionOf(ticked, books)).toBeNull();
  });

  it("lists the homebrew books a campaign hides", () => {
    expect(homebrewSources(books)).toEqual(["Homebrew", "Curse of Strahd (homebrew)"]);
  });
});
