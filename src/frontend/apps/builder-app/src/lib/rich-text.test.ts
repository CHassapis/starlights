import { describe, expect, it } from "vitest";
import { headingText, inline, parseRichText } from "./rich-text";

describe("parseRichText", () => {
  it("reads headings, lists, tables and paragraphs", () => {
    const blocks = parseRichText(
      ["SESSION PREP · NEXT TIME", "Party: four heroes", "", "# | SCENE | WHAT HAPPENS", "1 | The road | Wolves.", "2 | The town | A festival.", "", "- first", "- second", "1. one", "2. two"].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "table", "list", "list"]);
    const table = blocks[2];
    expect(table.kind === "table" && table.header).toEqual(["#", "SCENE", "WHAT HAPPENS"]);
    expect(table.kind === "table" && table.rows).toHaveLength(2);
    expect(blocks[4].kind === "list" && blocks[4].ordered).toBe(true);
  });

  it("keeps a stat line, a sentence in capitals-free text and a single pipe line as text", () => {
    expect(headingText("STR DEX CON INT WIS CHA")).toBeNull();
    expect(headingText("A quiet road")).toBeNull();
    expect(headingText("DM EYES ONLY")).toBe("DM EYES ONLY");
    expect(parseRichText("Choose this | or that")[0].kind).toBe("paragraph");
  });

  it("gives repeated headings their own ids", () => {
    const ids = parseRichText("TRAITS\ntext\nTRAITS\nmore").filter((b) => b.kind === "heading").map((b) => (b.kind === "heading" ? b.id : ""));
    expect(ids).toEqual(["traits", "traits-2"]);
  });
});

describe("inline", () => {
  it("sets labels, trait names and **bold** in bold", () => {
    expect(inline("WHO: the miller's widow")[0]).toEqual({ text: "WHO: ", bold: true });
    expect(inline("Spider Climb. Walls and ceilings.")[0]).toEqual({ text: "Spider Climb.", bold: true });
    expect(inline("a **bold** word").filter((p) => p.bold).map((p) => p.text)).toEqual(["bold"]);
    expect(inline("It rained. Then it stopped.").some((p) => p.bold)).toBe(false);
  });
});
