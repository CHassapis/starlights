/**
 * Books and adventures for the reader: per book a table of contents (chapters and their headers, with the
 * section ids the data gives them, which {@area} and section links use), one file per chapter, and a slim text
 * index (header and plain text of each section) for searching inside the book.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { keyPart } from "../src/lib/lore/keys.ts";
import { stripTags } from "../src/lib/lore/tags.ts";
import type { BookRow } from "../src/lib/lore/types.ts";
import { readJson, str, type Context, type Json, type Writer } from "./common.ts";

interface Header {
  name: string;
  id?: string;
  depth: number;
}

function headersOf(chapter: Json): Header[] {
  const out: Header[] = [];
  const walk = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) return;
    const o = e as Json;
    const named = typeof o.name === "string" && (o.type === "section" || o.type === "entries" || o.type === undefined);
    if (named && depth > 0 && depth <= 3) out.push({ name: o.name as string, ...(typeof o.id === "string" ? { id: o.id } : {}), depth: depth - 1 });
    if (Array.isArray(o.entries)) for (const c of o.entries) walk(c, named ? depth + 1 : depth);
  };
  for (const c of (chapter.entries as unknown[]) ?? []) walk(c, 1);
  return out;
}

/** Every id in a chapter (sections, map areas) → the chapter it is in. */
function idsOf(chapter: unknown, ch: number, out: Record<string, number>) {
  const walk = (e: unknown) => {
    if (Array.isArray(e)) return e.forEach(walk);
    if (!e || typeof e !== "object") return;
    const o = e as Json;
    if (typeof o.id === "string" && !(o.id in out)) out[o.id] = ch;
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk(chapter);
}

/** Plain text of each section with an id, for the search inside the book. */
function searchOf(chapter: Json, ch: number) {
  const sections: { ch: number; id: string; name: string; parts: string[] }[] = [];
  const walk = (e: unknown, current: { parts: string[] } | null) => {
    if (typeof e === "string") {
      current?.parts.push(stripTags(e));
      return;
    }
    if (Array.isArray(e)) return e.forEach((x) => walk(x, current));
    if (!e || typeof e !== "object") return;
    const o = e as Json;
    let here = current;
    if (typeof o.id === "string" && typeof o.name === "string") {
      const section = { ch, id: o.id, name: o.name, parts: [] as string[] };
      sections.push(section);
      here = section;
    }
    for (const k of ["entries", "items", "rows", "entry"]) if (o[k] !== undefined) walk(o[k], here);
  };
  walk(chapter, null);
  return sections.map((s) => ({ ch: s.ch, id: s.id, name: s.name, text: s.parts.join(" ").replace(/\s+/g, " ").trim() }));
}

export function ingestBooks(ctx: Context, writer: Writer) {
  const out: Record<"books" | "adventures", BookRow[]> = { books: [], adventures: [] };
  for (const [kind, file, listKey, folder, prefix] of [
    ["books", "books.json", "book", "book", "book-"],
    ["adventures", "adventures.json", "adventure", "adventure", "adventure-"],
  ] as const) {
    const list = (readJson(join(ctx.data, file))[listKey] as Json[]) ?? [];
    for (const b of list) {
      const id = String(b.id);
      const path = join(ctx.data, folder, `${prefix}${id.toLowerCase()}.json`);
      if (!existsSync(path)) {
        ctx.report.problem(`${kind}: no file for ${id}`);
        continue;
      }
      const chapters = (readJson(path).data as Json[]) ?? [];
      const ids: Record<string, number> = {};
      const search: ReturnType<typeof searchOf> = [];
      const base = `reader/${kind}/${keyPart(id)}`;
      chapters.forEach((c, i) => {
        idsOf(c, i, ids);
        search.push(...searchOf(c, i));
        writer.write(`${base}/${i}.json`, c);
      });
      const contents = (b.contents as Json[]) ?? [];
      const toc = chapters.map((c, i) => {
        const listed = contents[i] ?? {};
        const ordinal = listed.ordinal as Json | undefined;
        return {
          name: str(c.name) ?? str(listed.name) ?? `Chapter ${i + 1}`,
          ...(ordinal ? { ordinal: `${String(ordinal.type) === "appendix" ? "Appendix" : String(ordinal.type) === "part" ? "Part" : "Chapter"} ${String(ordinal.identifier)}` } : {}),
          ...(typeof c.id === "string" ? { id: c.id } : {}),
          headers: headersOf(c),
        };
      });
      const source = str(b.source) ?? id;
      writer.write(`${base}/toc.json`, { id, name: b.name, source, kind, toc, ids, cover: (b.cover as Json | undefined)?.path ?? null });
      writer.write(`${base}/search.json`, search);
      const info = ctx.sources[source];
      out[kind].push({
        k: keyPart(id),
        name: String(b.name),
        src: source,
        ed: info?.edition ?? "2014",
        group: str(b.group) ?? "other",
        ...(str(b.published) ? { published: str(b.published) } : {}),
        ...(str(b.storyline) ? { storyline: str(b.storyline) } : {}),
        ...(b.level && typeof b.level === "object" ? { level: `${String((b.level as Json).start)}–${String((b.level as Json).end)}` } : {}),
        ...((b.cover as Json | undefined)?.path ? { cover: String((b.cover as Json).path) } : {}),
        chapters: chapters.length,
      });
      ctx.report.count(kind, source);
    }
    out[kind].sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "") || a.name.localeCompare(b.name));
  }
  return out;
}
