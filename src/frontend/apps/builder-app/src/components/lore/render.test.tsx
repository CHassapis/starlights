// The renderer, drawn to HTML without a browser, on made-up entries.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { LoreMeta } from "@/lib/lore/types";
import { Entries, LoreRenderProvider } from "./render";

const meta: LoreMeta = { version: "t", built: "", imageBase: "https://img.example/", sources: {}, tagDefaults: {}, categories: {}, redirects: {} };
const html = (entries: unknown) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <LoreRenderProvider value={{ meta }}>
        <Entries entries={entries} depth={0} />
      </LoreRenderProvider>
    </MemoryRouter>,
  );

describe("the entry renderer", () => {
  it("draws sections, run-in names, lists and tables", () => {
    const out = html([
      { type: "section", name: "Chapter", id: "001", entries: ["Text {@b bold}.", { type: "entries", name: "Deep", entries: [{ type: "entries", name: "Deeper", entries: [{ type: "entries", name: "Run-in", entries: ["After."] }] }] }] },
      { type: "list", items: ["one", { type: "item", name: "Two", entry: "second" }] },
      { type: "table", caption: "Roll", colLabels: ["d6", "Result"], rows: [[{ type: "cell", roll: { min: 1, max: 3 } }, "Low"], ["4–6", "High"]] },
    ]);
    expect(out).toContain('<h2 id="e-001"');
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("Run-in.</strong>");
    expect(out).toContain("<li");
    expect(out).toContain("1–3");
    expect(out).toContain("<caption");
  });

  it("draws insets, read-aloud boxes, quotes, pictures and dice", () => {
    const out = html([
      { type: "insetReadaloud", entries: ["You enter a room."] },
      { type: "inset", name: "Note", entries: ["Aside."] },
      { type: "quote", entries: ["Words."], by: "Someone" },
      { type: "image", href: { type: "internal", path: "covers/X.webp" }, title: "Cover" },
      "Roll {@dice 2d6} or hit {@hit 5}; {@spell nowhere} stays text.",
    ]);
    expect(out).toContain("font-serif");
    expect(out).toContain("Aside.");
    expect(out).toContain("— Someone");
    expect(out).toContain('src="https://img.example/covers/X.webp"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain("Roll 2d6");
    expect(out).toContain("+5");
    expect(out).toContain("nowhere");
  });
});
