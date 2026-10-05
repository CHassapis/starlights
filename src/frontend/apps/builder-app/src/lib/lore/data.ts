/**
 * Loading the Compendium of Lore's files: current.json names the build, meta.json describes it, each category has
 * a list (index/<category>.json, loaded when its page opens) and one file of full entries per source
 * (data/<category>/<source>.json, loaded when an entry from that source is opened or previewed).
 */
import { useQuery } from "@tanstack/react-query";
import { entryKey } from "./keys.ts";
import type { CategoryChunk, CategoryIndex, IndexRow, LoreEntry, LoreMeta } from "./types.ts";

export const LORE_BASE: string = import.meta.env.VITE_LORE_BASE ?? "/lore-data";

export class LoreMissingError extends Error {}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 404) throw new LoreMissingError(`Not found: ${url}`);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return (await response.json()) as T;
}

/** The build in use and its description; checked again every few minutes, so a new build shows up by itself. */
export function useLoreMeta() {
  return useQuery({
    queryKey: ["lore", "meta"],
    queryFn: async () => {
      const { version } = await getJson<{ version: string }>(`${LORE_BASE}/current.json`, { cache: "no-cache" });
      return getJson<LoreMeta>(`${LORE_BASE}/${version}/meta.json`);
    },
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof LoreMissingError) && count < 2,
  });
}

export function useCategoryIndex<Row extends IndexRow = IndexRow>(meta: LoreMeta | undefined, category: string) {
  return useQuery({
    queryKey: ["lore", meta?.version, "index", category],
    queryFn: () => getJson<CategoryIndex<Row>>(`${LORE_BASE}/${meta!.version}/index/${category}.json`),
    enabled: !!meta && !!meta.categories[category],
    staleTime: Infinity,
  });
}

/** The source part of a key ("fireball_xphb" → "xphb"), which names the file the entry is in. */
export function sourceOfKey(key: string): string {
  return decodeURIComponent(key.slice(key.lastIndexOf("_") + 1));
}

export function chunkUrl(meta: LoreMeta, category: string, source: string): string {
  return `${LORE_BASE}/${meta.version}/data/${category}/${encodeURIComponent(source.toLowerCase())}.json`;
}

/** One entry, by key. A key that was renamed or reprinted is followed to its current key. */
export function useLoreEntry(meta: LoreMeta | undefined, category: string, key: string | null | undefined) {
  return useQuery({
    queryKey: ["lore", meta?.version, "chunk", category, key ? sourceOfKey(key) : null],
    queryFn: () => getJson<CategoryChunk>(chunkUrl(meta!, category, sourceOfKey(key!))),
    enabled: !!meta && !!key && !!meta.categories[category],
    staleTime: Infinity,
    select: (chunk): { entry: LoreEntry | null; key: string } => ({ entry: key ? (chunk.entries[key] ?? null) : null, key: key ?? "" }),
  });
}

/** Where a key that is not in the data now points, if anywhere. */
export function redirectKey(meta: LoreMeta, category: string, key: string): string | null {
  return meta.redirects[category]?.[key] ?? null;
}

/** The key a {@tag name|source} refers to, with the tag's default book when it names none. */
export function tagKey(meta: LoreMeta, tag: string, name: string, source: string | undefined, third?: string): string {
  // deity tags name the pantheon second: {@deity Lathander|Faerûnian|SCAG}
  if (tag === "deity") return entryKey(`${name.trim()} (${source?.trim() || "Forgotten Realms"})`, third?.trim() || meta.tagDefaults.deity || "");
  return entryKey(name.trim(), source?.trim() || meta.tagDefaults[tag] || "");
}

export function imageUrl(meta: LoreMeta | undefined, href: unknown): string | null {
  const h = href as { type?: string; path?: string; url?: string } | undefined;
  if (!h) return null;
  if (h.type === "external" && h.url) return h.url;
  if (h.path && meta) return meta.imageBase + h.path.split("/").map(encodeURIComponent).join("/");
  return null;
}

export function loreHref(category: string, key: string): string {
  return `/lore/${category}/${key}`;
}
