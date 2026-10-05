/** Links from campaign entries into the Compendium of Lore. */
import { chunkUrl, imageUrl } from "./data.ts";
import { monsterSubtitle } from "./monster-text.ts";
import type { LoreMeta } from "./types.ts";

/** A link from a campaign entry into the compendium: an entry, or a section of a book (chapter and section id). */
export interface CompendiumLink {
  category: string;
  key: string;
  name: string;
  ch?: number;
  anchor?: string;
}

const get = async <T>(url: string) => (await (await fetch(url)).json()) as T;

/** A creature's details for a campaign NPC: its type line, picture and link, read from its book's file. */
export async function creatureDetails(meta: LoreMeta, link: CompendiumLink): Promise<{ role: string; imageUrl: string | null }> {
  const source = decodeURIComponent(link.key.slice(link.key.lastIndexOf("_") + 1));
  const chunk = await get<{ entries: Record<string, Record<string, unknown>> }>(chunkUrl(meta, "bestiary", source));
  const m = chunk.entries[link.key];
  if (!m) return { role: "", imageUrl: null };
  const fluff = m._fluff as { images?: { href?: unknown }[] } | undefined;
  const href = fluff?.images?.[0]?.href;
  return { role: monsterSubtitle(m), imageUrl: href ? imageUrl(meta, href) : null };
}
