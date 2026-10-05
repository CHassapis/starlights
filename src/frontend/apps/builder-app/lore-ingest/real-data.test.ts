/**
 * Checks against the real 5etools data, read from LORE_SRC (a 5etools-src checkout) when it is there; skipped
 * otherwise, so the repository never needs the data. Run with LORE_SRC=/path/to/5etools-src.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entryKey } from "../src/lib/lore/keys";
import { ingestBestiary } from "./bestiary";
import { ingestBooks } from "./books";
import { ingestClasses } from "./classes";
import { Report, Writer, type Context, type Json } from "./common";
import { ingestItems } from "./items";
import { readSources } from "./sources";

const SRC = process.env.LORE_SRC ?? "";
const present = !!SRC && existsSync(join(SRC, "data", "books.json"));

describe.skipIf(!present)("the real 5etools data", () => {
  const report = new Report();
  const ctx: Context = { data: join(SRC, "data"), sources: present ? readSources(SRC).sources : {}, report };

  it("knows every source's edition", () => {
    expect(ctx.sources.XPHB.edition).toBe("2024");
    expect(ctx.sources.PHB.edition).toBe("2014");
    expect(ctx.sources.CoS.kind).toBe("adventure");
  });

  it("builds the bestiary: both stat block formats, copies, lore with pictures", () => {
    const { chunks } = ingestBestiary(ctx);
    const goblin = chunks.MM[entryKey("Goblin", "MM")];
    const warrior = chunks.XMM[entryKey("Goblin Warrior", "XMM")];
    expect(goblin.action).toBeDefined();
    expect(warrior.initiative ?? warrior.action).toBeDefined();
    expect((goblin._fluff?.images ?? []).length).toBeGreaterThan(0);
    // a copy: the Amber Golem is a stone golem
    const amber = chunks.CoS[entryKey("Amber Golem", "CoS")];
    expect(amber.hp).toEqual(chunks.MM[entryKey("Stone Golem", "MM")].hp);
    expect(amber._copy).toBeUndefined();
    expect(report.problems.filter((p) => p.startsWith("bestiary copy")).length).toBe(0);
  });

  it("makes the specific magic weapons links point to", () => {
    const { rows } = ingestItems(ctx);
    const sword = rows.find((r) => r.name === "+1 Longsword");
    expect(sword?.kind).toBe("specific");
  });

  it("puts class features in place", () => {
    const { chunks } = ingestClasses(ctx);
    const fighter = chunks.XPHB[entryKey("Fighter", "XPHB")];
    const features = fighter._features as { name: string; level: number }[];
    expect(features.find((f) => f.level === 1 && f.name === "Fighting Style")).toBeDefined();
  });

  it("reads an adventure into chapters with its map areas", () => {
    const written: string[] = [];
    const writer = { write: (rel: string) => written.push(rel) } as unknown as Writer;
    const { adventures } = ingestBooks(ctx, writer);
    const cos = adventures.find((a) => a.src === "CoS");
    expect(cos?.chapters).toBeGreaterThan(10);
    expect(written).toContain("reader/adventures/cos/toc.json");
  });
});

export type { Json };
